// Deploys RuleFactory for the Core build in contracts/core/out on a devnet and records it in packages/sdk/src/deployments.ts.
//
//   bash contracts/core/build.sh && (cd contracts && forge build)
//   bun packages/sdk/scripts/deploy-factory.ts                          local devnet (key devnet/keys/dev-8.json)
//   bun packages/sdk/scripts/deploy-factory.ts --devnet devnet1         public devnet (key from POPCORN_KEY, funded from the faucet)
//   bun packages/sdk/scripts/deploy-factory.ts --ensure                 quieter (devnet/up.sh runs this)
//   bun packages/sdk/scripts/deploy-factory.ts --no-write               never touch deployments.ts; print the entry instead
//
// The factory pins CORE_CREATION_CODE_HASH, so the Core build and the factory must match; the script checks that
// before sending. If neither build output exists it falls back to the SDK's generated artifacts.
//
// Deterministic address: CREATE2 through the deterministic-deployment proxy
// (0x4e59b44847b379578588920ca78fbf26c0b4956c, in the genesis of both devnets) with salt 0, so the address depends only
// on the factory init code (factory bytecode ++ Core creation code): the same after every devnet/reset.sh.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { concat, createPublicClient, createWalletClient, encodeDeployData, getAddress, getContractAddress, http, keccak256, pad, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEFAULT_CORE, deployments, devnetChain, devnets, ruleFactoryAbi, ruleFactoryBytecode } from "../src/index.ts";

const ROOT = new URL("../../../", import.meta.url).pathname;
const argv = process.argv.slice(2);
const args = new Set(argv);
const name = (argv.includes("--devnet") ? argv[argv.indexOf("--devnet") + 1] : "local") as "local" | "devnet1";
const quiet = args.has("--ensure");
const write = !args.has("--no-write");
const say = (s: string) => console.log(quiet ? `  ${s}` : s);
const devnet = devnets[name];
const chain = devnetChain(name);
const pub = createPublicClient({ chain, transport: http(devnet.rpcUrl) });
const PROXY: Address = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
const SALT: Hex = pad("0x0", { size: 32 });
const FACTORY_VIEW = parseAbi(["function coreCreationCodeHash() view returns (bytes32)"]);

const id = await pub.getChainId();
if (id !== devnet.chainId) throw new Error(`${devnet.rpcUrl} is chain ${id}, not ${devnet.chainId}; refusing to deploy`);

// ------------------------------------------------------------ the build to deploy
const coreJson = `${ROOT}contracts/core/out/PopcornCore.json`;
const factoryJson = `${ROOT}contracts/out/RuleFactory.sol/RuleFactory.json`;
let coreCreation: Hex;
let factoryBytecode: Hex;
let source: string;
if (existsSync(coreJson) && existsSync(factoryJson)) {
  coreCreation = (JSON.parse(readFileSync(coreJson, "utf8")) as { creation: Hex }).creation;
  factoryBytecode = (JSON.parse(readFileSync(factoryJson, "utf8")) as { bytecode: { object: Hex } }).bytecode.object;
  source = "build output";
} else if (!existsSync(coreJson) && !existsSync(factoryJson)) {
  coreCreation = DEFAULT_CORE.creation;
  factoryBytecode = ruleFactoryBytecode;
  source = "SDK artifacts";
} else {
  throw new Error("build both: bash contracts/core/build.sh && (cd contracts && forge build)");
}
const coreHash = keccak256(coreCreation);
// the factory constructor reverts unless keccak(core) == its pinned CORE_CREATION_CODE_HASH: check before paying
const pinned = (factoryBytecode.toLowerCase().match(/7f([0-9a-f]{64})/g) ?? []).map((m) => `0x${m.slice(2)}`);
if (!pinned.includes(coreHash.toLowerCase())) {
  throw new Error(`RuleFactory bytecode does not pin Core ${coreHash}: rebuild the contracts (forge build) for this Core build`);
}

// ------------------------------------------------------------ deploy (idempotent)
const initCode = encodeDeployData({ abi: ruleFactoryAbi, bytecode: factoryBytecode, args: [coreCreation] });
const factory = getContractAddress({ opcode: "CREATE2", from: PROXY, salt: SALT, bytecode: initCode });
const recorded = deployments[name];
let hash: Hex | undefined = recorded && getAddress(recorded.factory) === factory ? recorded.factoryTx : undefined;

const code = await pub.getCode({ address: factory });
if (code && code !== "0x") {
  say(`RuleFactory ${factory} (Core ${coreHash.slice(0, 10)}…, ${source}) already deployed`);
} else {
  const proxyCode = await pub.getCode({ address: PROXY });
  if (!proxyCode || proxyCode === "0x") throw new Error(`no deterministic-deployment proxy at ${PROXY}`);
  const keyFile = name === "local" ? `${ROOT}devnet/keys/dev-8.json` : process.env.POPCORN_KEY;
  if (!keyFile || !existsSync(keyFile)) throw new Error(`no key file: set POPCORN_KEY to a funded key file ([{ address, private_key }]) for ${name}`);
  const key = (JSON.parse(readFileSync(keyFile, "utf8")) as { private_key: Hex }[])[0]!.private_key;
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(devnet.rpcUrl) });
  // explicit gas: the factory deploy uses about 20M, and ethrex's estimateGas wants a large balance
  hash = await wallet.sendTransaction({ to: PROXY, data: concat([SALT, initCode]), gas: 30_000_000n, chain });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`factory deploy failed: ${hash}`);
  say(`RuleFactory deployed at ${factory} (CREATE2 via ${PROXY}, salt 0; ${source}) tx ${hash} block ${receipt.blockNumber} gas ${receipt.gasUsed}`);
}
const onChainPin = await pub.readContract({ address: factory, abi: FACTORY_VIEW, functionName: "coreCreationCodeHash" });
if (onChainPin.toLowerCase() !== coreHash.toLowerCase()) throw new Error(`factory ${factory} pins ${onChainPin}, expected ${coreHash}`);

// ------------------------------------------------------------ record under deployments.<devnet>
if (recorded && getAddress(recorded.factory) === factory && recorded.core.creationHash.toLowerCase() === coreHash.toLowerCase()) {
  say(`deployments.${name} matches (${factory})`);
  process.exit(0);
}
if (coreHash.toLowerCase() !== DEFAULT_CORE.creationHash.toLowerCase()) {
  console.error(`The SDK's Core artifact is for ${DEFAULT_CORE.creationHash}, not ${coreHash}. Run\n  bun packages/sdk/scripts/gen-artifacts.ts\nthen re-run this script to record ${factory}.`);
  process.exit(2);
}
const entry = `  ${name}: {\n    // packages/sdk/scripts/deploy-factory.ts: CREATE2 via ${PROXY}, salt 0\n    factory: "${factory.toLowerCase()}",\n    core: CORE,\n${hash ? `    factoryTx: "${hash}",\n` : ""}  },`;
if (!write) {
  console.log(`deployments.${name} is ${recorded?.factory ?? "missing"}; entry for packages/sdk/src/deployments.ts:\n${entry}`);
  process.exit(0);
}
const p = `${ROOT}packages/sdk/src/deployments.ts`;
let s = readFileSync(p, "utf8");
const re = new RegExp(`  ${name}: \\{\\n[\\s\\S]*?\\n  \\},\\n`);
if (re.test(s)) s = s.replace(re, `${entry}\n`);
else if (/= \{\};/.test(s)) s = s.replace(/= \{\};/, `= {\n${entry}\n};`);
else if (/\n\};\n\n\/\*\* Factories|\n\};\n\nexport function getDeployment/.test(s)) s = s.replace(/\n\};\n\nexport function getDeployment/, `\n${entry}\n};\n\nexport function getDeployment`);
else if (/\n\};\n\nexport function getDeployment/.test(s)) s = s.replace(/\n\};\n\nexport function getDeployment/, `\n${entry}\n};\n\nexport function getDeployment`);
else throw new Error(`cannot place the local entry in ${p}; add it by hand:\n${entry}`);
writeFileSync(p, s);
say(`wrote deployments.${name} = ${factory} to packages/sdk/src/deployments.ts`);
