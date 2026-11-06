// Open Sponsor on the local devnet: a caller-pays rule contract whose gas is paid by the sponsor's on-chain policy.
//   POPCORN_NETWORK=1 bun run --cwd packages/sdk vitest run test/sponsor.network.test.ts --reporter verbose
// Keys: dev-0 owns the sponsor and deploys. Triggers are sent by FRESH keys that never hold ETH.
// Results (tx hashes, gas, refusals with their codes) -> test/results/sponsor.json
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { parseEther, parseGwei, type Address, type Hex } from "viem";
import { MerkleTree, membershipProof, newIdentity } from "@popcorn/zk";
import { OPEN_SPONSOR_ERRORS, deployCode, deployOpenSponsor, openSponsorAbi, sponsored, sponsorTail, stakeOpenSponsor } from "../src/index.ts";
import { RESULTS, WANTED, artifact, chainUp, j, keyFile, loadKey, makeClients } from "./intent.helpers.ts";

const ON = WANTED && (await chainUp()) && existsSync(keyFile(0));
const rows: Record<string, unknown>[] = [];

describe.skipIf(!ON)("Open Sponsor on the local devnet", () => {
  const c = ON ? makeClients(loadKey(0)) : (undefined as never);
  const paid = artifact("PaidCounter");
  let sponsor: Address;
  const write = async (functionName: string, args: unknown[]) => {
    const h = await c.deployer.writeContract({ address: sponsor, abi: openSponsorAbi, functionName: functionName as never, args: args as never, gas: 300_000n });
    expect((await c.pub.waitForTransactionReceipt({ hash: h })).status).toBe("success");
  };
  const read = (functionName: string, args: unknown[] = []) => c.pub.readContract({ address: sponsor, abi: openSponsorAbi, functionName: functionName as never, args: args as never }) as Promise<bigint>;
  const counter = async (logic?: Address) => {
    const d = await c.deployer.deployRule({ logic: logic ?? { abi: paid.abi, bytecode: paid.bytecode, args: [0n] }, mode: "callerPays", fund: 0n, allowUnderfunded: true });
    const h = await c.deployer.writeContract({ address: d.ruleContract, abi: paid.abi, functionName: "arm", gas: 300_000n });
    await c.pub.waitForTransactionReceipt({ hash: h });
    return d;
  };
  const sponsorCode = (reason: string): string | undefined => {
    const m = /0x0*(6[0-9a-f]|7[0-4])\b/i.exec(reason);
    return m ? OPEN_SPONSOR_ERRORS[parseInt(m[1]!, 16)] : undefined;
  };
  afterAll(() => {
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(`${RESULTS}sponsor.json`, JSON.stringify(j({ chain: "local (1338)", sponsor, rows }), null, 2));
  });

  it("deploys and funds a sponsor with a public policy", async () => {
    const d = await deployOpenSponsor({ wallet: c.deployer, pub: c.pub }, { owner: c.account.address, period: 3600n, maxFee: parseGwei("500"), defaultLimit: parseEther("3") });
    sponsor = d.address;
    const f = await c.deployer.sendTransaction({ to: sponsor, value: parseEther("20"), gas: 100_000n });
    await c.pub.waitForTransactionReceipt({ hash: f });
    expect(await read("owner")).toBe(c.account.address);
    await stakeOpenSponsor({ wallet: c.deployer, pub: c.pub }, sponsor, { amount: parseEther("0.1") });
    rows.push({ step: "deploy", sponsor, gasUsed: d.gasUsed });
  }, 300_000);

  it("refuses a sender the policy does not cover, then sponsors it once it has a limit", async () => {
    const k = await counter();
    const t = c.freshTriggerer().client;
    const before = await t.canTrigger(k.ruleContract, sponsored(sponsor));
    expect(before).toMatchObject({ ready: false, name: "PAYER_REFUSED", code: 0x6a });
    rows.push({ step: "not covered", ruleContract: k.ruleContract, ready: false, reason: before.reason, sponsorError: sponsorCode(before.reason) });

    await write("setLimit", [k.ruleContract, parseEther("3")]);
    expect((await t.canTrigger(k.ruleContract, sponsored(sponsor))).ready).toBe(true);
    const balance0 = await c.pub.getBalance({ address: sponsor });
    const hash = await t.trigger(k.ruleContract, sponsored(sponsor));
    const st = await t.watch(hash);
    expect(st.state).toBe("included");
    const r = await c.pub.getTransactionReceipt({ hash });
    const spent = await read("spentOf", [k.ruleContract]);
    expect(spent > 0n).toBe(true);
    expect(await c.pub.readContract({ address: k.ruleContract, abi: paid.abi, functionName: "count" })).toBe(1n);
    const paidWei = balance0 - (await c.pub.getBalance({ address: sponsor }));
    expect(paidWei > 0n).toBe(true);
    rows.push({ step: "sponsored trigger", ruleContract: k.ruleContract, hash, gasUsed: r.gasUsed, sponsorPaidWei: paidWei, budgetDebitedWei: spent, triggererEth: 0 });
  }, 400_000);

  it("refuses a trigger without the accounting tail, over the fee cap, or over budget", async () => {
    const k = await counter();
    await write("setLimit", [k.ruleContract, parseEther("3")]);
    const t = c.freshTriggerer().client;
    const noTail = await t.canTrigger(k.ruleContract, { payer: sponsor, payerGasLimit: 60_000n });
    expect(noTail).toMatchObject({ ready: false, name: "PAYER_REFUSED", code: 0x62 });
    const wrongTail = await t.canTrigger(k.ruleContract, { ...sponsored(sponsor), tail: { ...sponsorTail(sponsor), gasLimit: 10_000n } });
    expect(wrongTail).toMatchObject({ ready: false, name: "PAYER_REFUSED", code: 0x68 });
    const feeCap = await t.canTrigger(k.ruleContract, { ...sponsored(sponsor), fees: { maxFeePerGas: parseGwei("600"), maxPriorityFeePerGas: parseGwei("1") } });
    expect(feeCap).toMatchObject({ ready: false, name: "PAYER_REFUSED", code: 0x6b });
    await write("setLimit", [k.ruleContract, 1n]);
    const over = await t.canTrigger(k.ruleContract, sponsored(sponsor));
    expect(over).toMatchObject({ ready: false, name: "PAYER_REFUSED", code: 0x6c });
    rows.push({ step: "refusals", noTail: noTail.reason, shortTail: wrongTail.reason, aboveFeeCap: feeCap.reason, overBudget: over.reason });
  }, 400_000);

  it("sponsors every rule contract built on an allowed logic", async () => {
    const k1 = await counter();
    const k2 = await counter(k1.logic);
    await write("allowLogic", [k1.logic, true]);
    const t = c.freshTriggerer().client;
    const hash = await t.trigger(k2.ruleContract, sponsored(sponsor));
    expect((await t.watch(hash)).state).toBe("included");
    rows.push({ step: "allowed logic", logic: k1.logic, ruleContract: k2.ruleContract, hash });
  }, 400_000);

  it("admits one account per member of a private set, without saying which member", async () => {
    const mv = artifact("MembershipVerifier");
    const verifier = (await deployCode({ wallet: c.deployer, pub: c.pub }, mv.bytecode, 6_000_000n)).address;
    const members = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
    const tree = await MerkleTree.create(20, members.map((m) => m.commitment));
    await write("setGate", [verifier, await tree.root()]);
    const ext = await read("externalNullifier");
    const fresh = await c.deployer.deployRule({ logic: { abi: paid.abi, bytecode: paid.bytecode, args: [0n] }, mode: "callerPays", fund: 0n, allowUnderfunded: true });
    const arm = await c.deployer.writeContract({ address: fresh.ruleContract, abi: paid.abi, functionName: "arm", gas: 300_000n });
    await c.pub.waitForTransactionReceipt({ hash: arm });
    const p = await membershipProof({ secret: members[1].secret, tree, index: 1, signalHash: BigInt(fresh.ruleContract), externalNullifier: ext });
    const t = c.freshTriggerer().client;
    const hash = await t.trigger(fresh.ruleContract, sponsored(sponsor, { proof: p.proof as Hex, nullifierHash: p.nullifierHash }));
    expect((await t.watch(hash)).state).toBe("included");
    expect(await read("admitted", [fresh.ruleContract])).toBe(1n);
    expect(await read("nullifierUsed", [p.nullifierHash])).toBe(1n);
    const r = await c.pub.getTransactionReceipt({ hash });

    // the same member cannot admit a second account: same nullifier
    const other = await counter();
    const p2 = await membershipProof({ secret: members[1].secret, tree, index: 1, signalHash: BigInt(other.ruleContract), externalNullifier: ext });
    const second = await t.canTrigger(other.ruleContract, sponsored(sponsor, { proof: p2.proof as Hex, nullifierHash: p2.nullifierHash }));
    expect(second).toMatchObject({ ready: false, name: "PAYER_REFUSED", code: 0x6d });
    // a proof for one account does not admit another (signal bound)
    const p3 = await membershipProof({ secret: members[2].secret, tree, index: 2, signalHash: BigInt(fresh.ruleContract), externalNullifier: ext });
    const stolen = await t.canTrigger(other.ruleContract, sponsored(sponsor, { proof: p3.proof as Hex, nullifierHash: p3.nullifierHash }));
    expect(stolen).toMatchObject({ ready: false, name: "PAYER_REFUSED", code: 0x6e });
    // the admitted account is sponsored from now on without a proof
    const arm2 = await c.deployer.writeContract({ address: fresh.ruleContract, abi: paid.abi, functionName: "arm", gas: 300_000n });
    await c.pub.waitForTransactionReceipt({ hash: arm2 });
    const again = await t.trigger(fresh.ruleContract, sponsored(sponsor));
    expect((await t.watch(again)).state).toBe("included");
    rows.push({ step: "membership gate", verifier, ruleContract: fresh.ruleContract, admissionHash: hash, admissionGasUsed: r.gasUsed, secondAccountSameMember: second.reason, proofForAnotherAccount: stolen.reason, laterTriggerWithoutProof: again });
  }, 900_000);
});
