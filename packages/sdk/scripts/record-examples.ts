// Runs each example project on the local devnet and writes examples/<group>/<id>/run.json from what actually happened:
// the featured trigger's five stages, a real refusal, and the story of every transaction with its module and role.
//   SIDECAR_UNSTAKED_BUDGET=10000000 devnet (decision 73), then:
//   bun scripts/record-examples.ts [private-payroll open-gas-network quantum-ready-treasury walkaway-exit sovereign-account]
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeDeployData, formatEther, formatUnits, http, keccak256, maxUint256, parseEther, parseGwei, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MerkleTree, findExploit, membershipProof, newIdentity, newNote, poseidon, proveExploit, randomField, stealthCommitment, stealthProof, withdrawProof } from "@popcorn/zk";
import {
  ACCOUNT_RULE, CONTEST_PREIMAGE, PROPOSAL_QUANTUM, accountBinding, contestRecovery, deployOpenSponsor, deployPrivatePool, deploySovereignAccount, deployStealthVault,
  devnetChain, ecdsaParams, exitTrigger, finalizeRecovery, guardianScope, guardianSignal, initializeAccount, memoryUsageStore, migrateData, migrateTrigger,
  configureOpenSponsor, openSponsorAbi, poolDeposit, poolWithdrawal, popcorn, prepareStealthPayment, recordRefusal, recordTrigger, rotationProposal, scanStealth, setAssociationRoot,
  signEcdsaIntent, sovereignAccountAbi, spendData, spendTrigger, sponsored, stakeOpenSponsor, stealthAnnouncements, stealthKeys, stealthMetaAddress, stealthPay,
  stealthSpend, storyEntry, voteTrigger, wotsIntentKey, wotsIntentSigner, wotsKeygen, wotsParams, writeRun, deployCode, type RecordedStory,
} from "../src/index.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const chain = devnetChain("local");
const key = (n: number) => (JSON.parse(readFileSync(`${ROOT}devnet/keys/dev-${n}.json`, "utf8")) as { private_key: Hex }[])[0]!.private_key;
const deployerAcct = privateKeyToAccount(key(4));
const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account: deployerAcct, chain, transport: http() }).extend(popcorn({ devnet: "local" }));
const dc = { wallet, pub } as never;
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
const triggerer = () => createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain, transport: http() }).extend(popcorn({ devnet: "local" }));
const eth = async (a: Address) => `${formatEther(await pub.getBalance({ address: a }))} ETH`;
const CHAIN = 1338n;
const NETWORK = { name: "local", chainId: 1338 };
const SOURCES = { simulation: "ethrex_simulateFrameTransaction", admission: "ERC-8421 sidecar (eth_sendFrameTransaction)", receipt: "eth_getTransactionReceipt" };
const out = (p: string) => `${ROOT}examples/${p}/run.json`;
// trigger + watch with the SDK's bounded resend of a dropped-but-still-valid trigger
const sent = async (c: ReturnType<typeof triggerer>, k: Address, t: Parameters<typeof c.trigger>[1]) => (await c.triggerAndWait(k, t)).hash;

const forge = (name: string) => {
  const j = JSON.parse(readFileSync(`${ROOT}contracts/out/${name}.sol/${name}.json`, "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
};
const write = async (address: Address, abi: Abi, functionName: string, args: unknown[], gas = 1_500_000n) => {
  const h = await wallet.writeContract({ address, abi, functionName, args, gas } as never);
  const r = await pub.waitForTransactionReceipt({ hash: h });
  if (r.status !== "success") throw new Error(`${functionName} reverted: ${h}`);
  return h;
};

async function proofOfExploit() {
  const token = forge("DemoToken");
  const vaultArt = forge("GuardedVault");
  const E = 10n ** 18n;
  const story: RecordedStory[] = [];
  const dusd = (await deployCode(dc, encodeDeployData({ abi: token.abi, bytecode: token.bytecode, args: ["Demo USD", "dUSD"] }), 8_000_000n)).address;
  const verifier = (await deployCode(dc, forge("ExploitVerifier").bytecode, 8_000_000n)).address;
  const stakeAmount = parseEther("0.1");
  const logic = await deployCode(dc, encodeDeployData({ abi: vaultArt.abi, bytecode: vaultArt.bytecode, args: [deployerAcct.address, dusd, E, 0n, 100n * E, verifier, stakeAmount, 0n] }), 30_000_000n);
  const caps = { conditionGas: 240_000, maxVerifyDataLength: 256, maxTriggerDataLength: 64, maxGasPerFrame: 400_000n, maxStateGasPerFrame: 6n * 97_920n, maxFeePerGas: parseGwei("10"), maxPriorityFeePerGas: parseGwei("2") };
  const d = await wallet.deployRule({ logic: logic.address, caps, fund: stakeAmount + parseEther("0.2"), stake: true } as never);
  const V = d.ruleContract;
  await write(V, vaultArt.abi, "initialize", []);
  await write(dusd, token.abi, "mint", [deployerAcct.address, 2_000n * E]);
  await write(dusd, token.abi, "approve", [V, maxUint256]);
  story.push(await storyEntry(pub, await write(V, vaultArt.abi, "deposit", [800n * E]), "guarded-vault", "deposit", "Depositors put 800 dUSD into the vault"));
  story.push(await storyEntry(pub, await write(V, vaultArt.abi, "deposit", [200n * E]), "guarded-vault", "deposit", "Another 200 dUSD: 1,000 shares for 1,000 dUSD"));
  story.push(await storyEntry(pub, await write(V, vaultArt.abi, "harvest", [100n * E]), "guarded-vault", "yield", "Yield of 100 dUSD arrives: 1,100 assets now back 1,000 shares, and the rounding bug becomes exploitable"));
  story.push(await storyEntry(pub, await write(V, vaultArt.abi, "fundRewards", [100n * E]), "proof-of-exploit-bounty", "fund", "The team funds a 100 dUSD bounty pool, public and on chain"));
  const T = (await pub.readContract({ address: V, abi: vaultArt.abi, functionName: "totalAssets" })) as bigint;
  const S = (await pub.readContract({ address: V, abi: vaultArt.abi, functionName: "totalSupply" })) as bigint;
  const state = { totalAssets: T, totalSupply: S, minAssetsPerShare: E, vault: BigInt(V) };
  const w = findExploit(state);
  if (!w) throw new Error("no exploit at this state");
  const whitehat = fresh();
  const p = await proveExploit(state, w, BigInt(whitehat), 1n);
  const args = (to: Address) => encodeAbiParameters([{ type: "address" }, { type: "uint64" }], [to, 1n]);
  const t = triggerer();
  const labels = { [V.toLowerCase()]: "guarded vault", sender: "guarded vault" };
  const bal = async (a: Address) => `${formatUnits((await pub.readContract({ address: dusd, abi: token.abi, functionName: "balanceOf", args: [a] })) as bigint, 18)} dUSD`;
  const world = async () => ({
    "whitehat's fresh address": await bal(whitehat),
    "vault paused": String(await pub.readContract({ address: V, abi: vaultArt.abi, functionName: "paused" })),
    "bounty pool": `${formatUnits((await pub.readContract({ address: V, abi: vaultArt.abi, functionName: "rewardPool" })) as bigint, 18)} dUSD`,
  });
  // a mempool watcher copies the proof and puts its own address in: the proof is bound to the whitehat's
  const refusal = await recordRefusal({ client: t as never, ruleContract: V, labels, trigger: { triggerData: args(fresh()), verifyData: p.proof }, world });
  const featured = await recordTrigger({
    client: t as never, pub: pub as never, devnet: "local", ruleContract: V, labels,
    trigger: { triggerData: args(whitehat), verifyData: p.proof },
    explain: ["the vault checks the Groth16 proof against its own live state, its address and the recipient in the trigger, then approves execution and payment", "pays the bounty to the recipient bound in the proof, pauses the vault and opens a new epoch"],
    world,
  });
  story.push(await storyEntry(pub, featured.hash, "proof-of-exploit-bounty", "claim", "The whitehat proves the bug in zero knowledge from a key with no ETH: paid to a fresh address, vault paused, one transaction"));
  writeRun(out("protect/proof-of-exploit"), {
    module: "proof-of-exploit", network: NETWORK, title: "A whitehat proves the bug, gets paid, and the vault pauses, in one transaction",
    actors: { caller: "a key with no ETH", ruleContract: "guarded vault", payer: "the vault" },
    contracts: { vault: V, token: dusd, verifier },
    exploit: { holding: w.holding, withdrawals: w.amounts, state: { totalAssets: T, totalSupply: S } },
    steps: featured.steps, failing: refusal, story, sources: SOURCES,
  });
}

async function privatePayroll() {
  const vault = await deployStealthVault(dc, wallet as never);
  const pool = await deployPrivatePool(dc, wallet as never, { denomination: parseEther("1"), associationProvider: deployerAcct.address });
  const spendSecret = randomField();
  const keys = stealthKeys(spendSecret, await poseidon(spendSecret));
  const story: RecordedStory[] = [];
  // the employer pays the salary to the employee's stealth meta-address
  const p = await prepareStealthPayment(stealthMetaAddress(keys), stealthCommitment);
  const payHash = await stealthPay(dc, vault.vault, p, parseEther("1.2"));
  story.push(await storyEntry(pub, payHash, "stealth-address", "receive", "The employer pays the salary to a stealth address only the employee can recognise (ML-KEM announcement)"));
  const [mine] = await scanStealth(keys, await stealthAnnouncements(pub as never, vault.vault), stealthCommitment);
  // the employee sweeps it to a fresh address with no ETH; the vault pays the gas
  const hot = fresh();
  const sp = await stealthProof({ spendSecret, shared: mine!.shared, recipient: BigInt(hot), fee: vault.minFee });
  const t = triggerer();
  const labels = { [vault.vault.toLowerCase()]: "stealth vault", sender: "stealth vault" };
  const featured = await recordTrigger({
    client: t as never, pub: pub as never, devnet: "local", ruleContract: vault.vault, labels,
    trigger: stealthSpend({ commitment: mine!.commitment, recipient: hot, fee: vault.minFee, proof: sp.proof as Hex }),
    explain: ["the vault checks the spend proof for this commitment, recipient and fee, then approves execution and payment", "pays balance - fee to the recipient"],
    world: async () => ({ "employee address balance": await eth(hot), "stealth vault balance": await eth(vault.vault) }),
  });
  story.push(await storyEntry(pub, featured.hash, "stealth-address", "spend", "The employee moves it to a fresh address with no ETH; the vault pays the gas"));
  const refusal = await recordRefusal({
    client: t as never, ruleContract: vault.vault, labels,
    trigger: stealthSpend({ commitment: mine!.commitment, recipient: fresh(), fee: vault.minFee, proof: sp.proof as Hex }),
    world: async () => ({ "stealth vault balance": await eth(vault.vault) }),
  });
  // the employee keeps savings in the private pool and withdraws later to another fresh address
  const note = await newNote();
  const dep = await poolDeposit(dc, pool.pool, note.commitment, pool.denomination);
  story.push(await storyEntry(pub, dep, "private-pool", "hold", "Savings go into the private pool as a note"));
  const tree = await MerkleTree.create(20, [note.commitment]);
  const assoc = await MerkleTree.create(20, [note.commitment]);
  const ar = await setAssociationRoot(dc, pool.pool, await assoc.root(), true);
  story.push(await storyEntry(pub, ar, "association-set", "vouch", "The association-set provider accepts the deposit"));
  const later = fresh();
  const w = await withdrawProof({ note, pool: tree, poolIndex: 0, assoc, assocIndex: 0, recipient: BigInt(later), fee: pool.minFee, scope: BigInt(pool.pool) });
  const wh = await sent(t, pool.pool, poolWithdrawal({ ...w, recipient: later, fee: pool.minFee }));
  story.push(await storyEntry(pub, wh, "private-pool", "withdraw", "A withdrawal to a fresh address, paid by the pool, sent by a key with no ETH"));
  writeRun(out("private/private-payroll"), {
    module: "private-payroll", network: NETWORK, title: "Salary that nobody can trace to the employee",
    actors: { caller: "a key with no ETH", ruleContract: "stealth vault", payer: "the stealth vault" },
    contracts: { stealthVault: vault.vault, privatePool: pool.pool },
    steps: featured.steps, failing: refusal, story, sources: SOURCES,
  });
}

async function openGasNetwork() {
  const sponsor = (await deployOpenSponsor(dc, { owner: deployerAcct.address, period: 3600n, maxFee: parseGwei("500"), defaultLimit: parseEther("3") })).address;
  const story: RecordedStory[] = [];
  const fund = await wallet.sendTransaction({ to: sponsor, value: parseEther("10"), gas: 100_000n });
  await pub.waitForTransactionReceipt({ hash: fund });
  await stakeOpenSponsor(dc, sponsor, { amount: parseEther("0.1") });
  const mv = JSON.parse(readFileSync(`${ROOT}contracts/out/MembershipVerifier.sol/MembershipVerifier.json`, "utf8")).bytecode.object as Hex;
  const verifier = (await deployCode(dc, mv, 8_000_000n)).address;
  const members = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
  const tree = await MerkleTree.create(20, members.map((m) => m.commitment));
  const [g] = (await configureOpenSponsor(dc, sponsor, { gate: { verifier, root: await tree.root() } })) as [Hex];
  story.push(await storyEntry(pub, g, "open-sponsor", "policy", "The community funds a sponsor and publishes its member set's root; no server signs anything"));
  const paid = JSON.parse(readFileSync(`${ROOT}contracts/out/PaidCounter.sol/PaidCounter.json`, "utf8"));
  const app = await wallet.deployRule({ logic: { abi: paid.abi, bytecode: paid.bytecode.object, args: [0n] }, mode: "callerPays", fund: 0n, allowUnderfunded: true });
  const arm = await wallet.writeContract({ address: app.ruleContract, abi: paid.abi, functionName: "arm", gas: 300_000n });
  if ((await pub.waitForTransactionReceipt({ hash: arm })).status !== "success") throw new Error(`arm reverted: ${arm}`);
  const ext = (await pub.readContract({ address: sponsor, abi: openSponsorAbi, functionName: "externalNullifier" })) as bigint;
  const proof = await membershipProof({ secret: members[0]!.secret, tree, index: 0, signalHash: BigInt(app.ruleContract), externalNullifier: ext });
  const t = triggerer();
  const labels = { [sponsor.toLowerCase()]: "open sponsor", [app.ruleContract.toLowerCase()]: "member's app account", sender: "member's app account" };
  const featured = await recordTrigger({
    client: t as never, pub: pub as never, devnet: "local", ruleContract: app.ruleContract, labels,
    trigger: sponsored(sponsor, { proof: proof.proof as Hex, nullifierHash: proof.nullifierHash }),
    explain: ["the app account approves its own action", "the sponsor checks the membership proof and its budget, then approves payment", "the app's action", "the sponsor records the spend and admits the account"],
    world: async () => ({ "sponsor balance": await eth(sponsor), "account admitted": String(await pub.readContract({ address: sponsor, abi: openSponsorAbi, functionName: "admitted", args: [app.ruleContract] })) }),
  });
  story.push(await storyEntry(pub, featured.hash, "membership-proof", "admit", "A member proves they belong, without saying who, and the account is sponsored from then on"));
  const second = await wallet.deployRule({ logic: app.logic, mode: "callerPays", fund: 0n, allowUnderfunded: true });
  const arm2 = await wallet.writeContract({ address: second.ruleContract, abi: paid.abi, functionName: "arm", gas: 300_000n });
  if ((await pub.waitForTransactionReceipt({ hash: arm2 })).status !== "success") throw new Error(`arm reverted: ${arm2}`);
  const p2 = await membershipProof({ secret: members[0]!.secret, tree, index: 0, signalHash: BigInt(second.ruleContract), externalNullifier: ext });
  const refusal = await recordRefusal({ client: t as never, ruleContract: second.ruleContract, labels: { ...labels, [second.ruleContract.toLowerCase()]: "a second account, same member", sender: "a second account, same member" }, trigger: sponsored(sponsor, { proof: p2.proof as Hex, nullifierHash: p2.nullifierHash }), world: async () => ({ "sponsor balance": await eth(sponsor) }) });
  writeRun(out("gas/open-gas-network"), {
    module: "open-gas-network", network: NETWORK, title: "Free transactions for members, with no server to switch off",
    actors: { caller: "a key with no ETH", ruleContract: "member's app account", payer: "the open sponsor" },
    contracts: { sponsor, verifier, app: app.ruleContract }, steps: featured.steps, failing: refusal, story, sources: SOURCES,
  });
}

async function accountSetup(recoveryDelaySec = 15n) {
  const guardians = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
  const tree = await MerkleTree.create(20, guardians.map((g) => g.commitment));
  const backupTree = wotsKeygen(generatePrivateKey(), generatePrivateKey());
  const owner = privateKeyToAccount(generatePrivateKey());
  const d = await deploySovereignAccount(dc, wallet as never, { owner: "ecdsa", recoveryDelaySec });
  const backupParams = wotsParams(wotsIntentKey(backupTree, 0, CHAIN, ACCOUNT_RULE.MIGRATE));
  const exitAddress = fresh();
  const init = await initializeAccount(dc, d.account, { ownerParams: ecdsaParams(owner.address), exitAddress, backupParams, guardiansRoot: await tree.root(), threshold: 2n });
  const fund = await wallet.sendTransaction({ to: d.account, value: parseEther("3"), gas: 100_000n });
  await pub.waitForTransactionReceipt({ hash: fund });
  const vote = async (i: number, proposal: Hex) => {
    const round = (await pub.readContract({ address: d.account, abi: sovereignAccountAbi, functionName: "guardianRound" })) as bigint;
    const p = await membershipProof({ secret: guardians[i]!.secret, tree, index: i, signalHash: guardianSignal(proposal, round), externalNullifier: guardianScope(d.account, round) });
    return voteTrigger(proposal, p.nullifierHash, p.proof as Hex);
  };
  return { d, owner, backupTree, backupParams, exitAddress, init, vote };
}

async function quantumReadyTreasury() {
  const s = await accountSetup();
  const A = s.d.account;
  const story: RecordedStory[] = [await storyEntry(pub, s.init, "hybrid-owner-key", "set up", "The treasury commits its owner key, a hidden post-quantum backup key and its guardians")];
  const t = triggerer();
  const td = spendData(fresh(), parseEther("0.1"));
  story.push(await storyEntry(pub, await sent(t, A, spendTrigger(td, ecdsaParams(s.owner.address), await signEcdsaIntent(s.owner, accountBinding(CHAIN, A, ACCOUNT_RULE.SPEND, 0n, td)))), "signed-intent", "spend", "A normal payment signed by the owner"));
  story.push(await storyEntry(pub, await sent(t, A, await s.vote(1, PROPOSAL_QUANTUM)), "hidden-guardians", "vote", "A guardian votes to flip the quantum switch, without revealing who"));
  story.push(await storyEntry(pub, await sent(t, A, await s.vote(2, PROPOSAL_QUANTUM)), "quantum-switch", "switch", "The second vote reaches the quorum: from now on ECDSA alone moves nothing"));
  const td2 = spendData(fresh(), parseEther("0.1"));
  const labels = { [A.toLowerCase()]: "treasury", sender: "treasury" };
  const refusal = await recordRefusal({ client: t as never, ruleContract: A, labels, trigger: spendTrigger(td2, ecdsaParams(s.owner.address), await signEcdsaIntent(s.owner, accountBinding(CHAIN, A, ACCOUNT_RULE.SPEND, 1n, td2))), world: async () => ({ "treasury balance": await eth(A), "quantum switch": "on" }) });
  const target = fresh();
  const signer = wotsIntentSigner({ tree: s.backupTree, firstEpoch: 0, binding: { chainId: CHAIN, ruleContract: A, ruleId: ACCOUNT_RULE.MIGRATE }, store: memoryUsageStore(), budget: { maxSteps: 900, maxTries: 400_000 } });
  const featured = await recordTrigger({
    client: t as never, pub: pub as never, devnet: "local", ruleContract: A, labels,
    trigger: migrateTrigger(target, s.backupParams, signer.sign(accountBinding(CHAIN, A, ACCOUNT_RULE.MIGRATE, 0n, migrateData(target)))),
    explain: ["the treasury checks the WOTS+ signature against the backup key it committed to, then approves", "moves every wei to the post-quantum target"],
    world: async () => ({ "treasury balance": await eth(A), "post-quantum target": await eth(target) }),
  });
  story.push(await storyEntry(pub, featured.hash, "post-quantum-signer", "migrate", "The committed WOTS+ backup key moves everything to a post-quantum account"));
  writeRun(out("sign/quantum-ready-treasury"), {
    module: "quantum-ready-treasury", network: NETWORK, title: "A treasury that survives the day ECDSA breaks",
    actors: { caller: "a key with no ETH", ruleContract: "treasury", payer: "the treasury" }, contracts: { treasury: A },
    steps: featured.steps, failing: refusal, story, sources: SOURCES,
  });
}

async function walkawayExit() {
  const s = await accountSetup();
  const A = s.d.account;
  const t = triggerer();
  const labels = { [A.toLowerCase()]: "account", sender: "account" };
  const story: RecordedStory[] = [await storyEntry(pub, s.init, "forced-exit", "commit", "The owner commits an exit address when the account is created")];
  const refusal = await recordRefusal({ client: t as never, ruleContract: A, labels, trigger: exitTrigger(), world: async () => ({ "account balance": await eth(A), contested: "false" }) });
  const attacker = privateKeyToAccount(generatePrivateKey());
  const proposal = rotationProposal(ecdsaParams(attacker.address));
  story.push(await storyEntry(pub, await sent(t, A, await s.vote(0, proposal)), "hidden-guardians", "vote", "A guardian votes to hand the account to a new key"));
  story.push(await storyEntry(pub, await sent(t, A, await s.vote(1, proposal)), "hidden-guardians", "quorum", "A second vote reaches the quorum: the takeover waits out its delay"));
  const round = (await pub.readContract({ address: A, abi: sovereignAccountAbi, functionName: "guardianRound" })) as bigint;
  const ch = await contestRecovery(dc, A, ecdsaParams(s.owner.address), await signEcdsaIntent(s.owner, accountBinding(CHAIN, A, ACCOUNT_RULE.CONTEST, round, CONTEST_PREIMAGE)));
  story.push(await storyEntry(pub, ch, "forced-exit", "contest", "The real owner signs that this was not them: the account is contested"));
  const featured = await recordTrigger({
    client: t as never, pub: pub as never, devnet: "local", ruleContract: A, labels, trigger: exitTrigger(),
    explain: ["the account sees it is contested and approves; no signature needed", "sends every wei to the committed exit address"],
    world: async () => ({ "account balance": await eth(A), "exit address": await eth(s.exitAddress) }),
  });
  story.push(await storyEntry(pub, featured.hash, "forced-exit", "exit", "Anyone, here a key with no ETH, sends the funds to the owner's committed exit address"));
  writeRun(out("protect/walkaway-exit"), {
    module: "walkaway-exit", network: NETWORK, title: "When control is contested, the money walks away to the owner",
    actors: { caller: "a key with no ETH", ruleContract: "account", payer: "the account" }, contracts: { account: A },
    steps: featured.steps, failing: refusal, story, sources: SOURCES,
  });
}

async function sovereignAccount() {
  const s = await accountSetup(15n);
  const A = s.d.account;
  const t = triggerer();
  const labels = { [A.toLowerCase()]: "sovereign account", sender: "sovereign account" };
  const story: RecordedStory[] = [await storyEntry(pub, s.init, "sovereign-account", "set up", "Owner key, post-quantum backup, hidden guardians and an exit address, committed once")];
  // receive privately
  const vault = await deployStealthVault(dc, wallet as never);
  const spendSecret = randomField();
  const keys = stealthKeys(spendSecret, await poseidon(spendSecret));
  const pay = await stealthPay(dc, vault.vault, await prepareStealthPayment(stealthMetaAddress(keys), stealthCommitment), parseEther("0.5"));
  story.push(await storyEntry(pub, pay, "stealth-address", "receive", "Someone pays the account's stealth meta-address (ML-KEM)"));
  const [mine] = await scanStealth(keys, await stealthAnnouncements(pub as never, vault.vault), stealthCommitment);
  const sp = await stealthProof({ spendSecret, shared: mine!.shared, recipient: BigInt(A), fee: vault.minFee });
  story.push(await storyEntry(pub, await sent(t, vault.vault, stealthSpend({ commitment: mine!.commitment, recipient: A, fee: vault.minFee, proof: sp.proof as Hex })), "stealth-address", "sweep", "The account sweeps it in; the vault pays the gas"));
  // spend
  const td = spendData(fresh(), parseEther("0.1"));
  const featured = await recordTrigger({
    client: t as never, pub: pub as never, devnet: "local", ruleContract: A, labels,
    trigger: spendTrigger(td, ecdsaParams(s.owner.address), await signEcdsaIntent(s.owner, accountBinding(CHAIN, A, ACCOUNT_RULE.SPEND, 0n, td))),
    explain: ["the account checks the owner's signature over this exact spend and its epoch, then approves and pays", "makes the payment"],
    world: async () => ({ "account balance": await eth(A) }),
  });
  story.push(await storyEntry(pub, featured.hash, "signed-intent", "spend", "The owner spends; the account pays its own gas and the sender holds no ETH"));
  const refusal = await recordRefusal({ client: t as never, ruleContract: A, labels, trigger: spendTrigger(td, ecdsaParams(s.owner.address), await signEcdsaIntent(s.owner, accountBinding(CHAIN, A, ACCOUNT_RULE.SPEND, 0n, td))), world: async () => ({ "account balance": await eth(A) }) });
  // guardians flip the quantum switch, the backup key migrates
  story.push(await storyEntry(pub, await sent(t, A, await s.vote(0, PROPOSAL_QUANTUM)), "hidden-guardians", "vote", "Guardians, unnamed, vote to flip the quantum switch"));
  story.push(await storyEntry(pub, await sent(t, A, await s.vote(2, PROPOSAL_QUANTUM)), "quantum-switch", "switch", "Quorum: owner signatures stop working"));
  const target = fresh();
  const signer = wotsIntentSigner({ tree: s.backupTree, firstEpoch: 0, binding: { chainId: CHAIN, ruleContract: A, ruleId: ACCOUNT_RULE.MIGRATE }, store: memoryUsageStore(), budget: { maxSteps: 900, maxTries: 400_000 } });
  story.push(await storyEntry(pub, await sent(t, A, migrateTrigger(target, s.backupParams, signer.sign(accountBinding(CHAIN, A, ACCOUNT_RULE.MIGRATE, 0n, migrateData(target))))), "post-quantum-signer", "migrate", "The committed post-quantum key moves everything to its new home"));
  writeRun(out("sign/sovereign-account"), {
    module: "sovereign-account", network: NETWORK, title: "One account that keeps working when everything around it fails",
    actors: { caller: "a key with no ETH", ruleContract: "sovereign account", payer: "the account" }, contracts: { account: A, stealthVault: vault.vault },
    owner: "ECDSA in this run; the flagship owner is ECDSA + Falcon-512 (recorded when the Falcon signer is installed)",
    steps: featured.steps, failing: refusal, story, sources: SOURCES,
  });
}

const ALL: Record<string, () => Promise<void>> = { "proof-of-exploit": proofOfExploit, "private-payroll": privatePayroll, "open-gas-network": openGasNetwork, "quantum-ready-treasury": quantumReadyTreasury, "walkaway-exit": walkawayExit, "sovereign-account": sovereignAccount };
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ALL)) {
  const t0 = Date.now();
  await ALL[id]!();
  console.log(`recorded ${id} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
process.exit(0);
