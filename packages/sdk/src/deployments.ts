// The one place the SDK reads the Core build and factory addresses from. When Core changes (a new creation hash),
// re-run scripts/gen-artifacts.ts and point `deployments.<devnet>` at a factory deployed for the new build.
import type { Address } from "viem";
import type { CoreArtifact } from "./artifacts/coreArtifact.ts";
import { CORE } from "./artifacts/core.generated.ts";
import { FACTORY_CORE_CREATION_CODE_HASH, ruleFactoryAbi, ruleFactoryBytecode } from "./artifacts/factory.generated.ts";
import { PopcornError } from "./errors.ts";
import type { DevnetName } from "./transport.ts";

export { CORE, FACTORY_CORE_CREATION_CODE_HASH, ruleFactoryAbi, ruleFactoryBytecode, type CoreArtifact };

/** Every Core build the SDK recognises in a rule contract's code. */
export const CORE_BUILDS: readonly CoreArtifact[] = [CORE];

/** The Core build new rule contracts are deployed with (must equal the factory's pinned hash). */
export const DEFAULT_CORE: CoreArtifact = CORE;

/** The staking registry the sidecar and RuleStake use: preloaded at the same address on the public and the local devnet. */
export const STAKING_REGISTRY: Address = "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f";

export interface PopcornDeployment {
  /** RuleFactory deployed with `core.creation`; its coreCreationCodeHash() == core.creationHash. */
  factory: Address;
  core: CoreArtifact;
  /** Staking registry of this devnet (default STAKING_REGISTRY). */
  stakingRegistry?: Address;
  /** Transaction that deployed the factory. */
  factoryTx?: `0x${string}`;
}

/** Factories deployed per devnet. A devnet without an entry needs `{ factory, core }` passed to popcorn(). */
export const deployments: Partial<Record<DevnetName, PopcornDeployment>> = {
  devnet1: {
    // packages/sdk/scripts/deploy-factory.ts: CREATE2 via 0x4e59b44847b379578588920ca78fbf26c0b4956c, salt 0
    factory: "0x1edd695a30f001b270e7a0f3a2781628a69e8380",
    core: CORE,
    factoryTx: "0xd94304f43d1c89b8a6196bfdb17ecfe361dbb588d739034047c01b368efebb04",
  },
  local: {
    // packages/sdk/scripts/deploy-factory.ts: CREATE2 via 0x4e59b44847b379578588920ca78fbf26c0b4956c, salt 0
    factory: "0x1edd695a30f001b270e7a0f3a2781628a69e8380",
    core: CORE,
    factoryTx: "0x9f3b7ed1a0bb63bcfbc8002c8518f94602bd8b5ee464831e42dbc23fbe16fc42",
  },
};

export function getDeployment(devnet: string): PopcornDeployment {
  const d = (deployments as Record<string, PopcornDeployment | undefined>)[devnet];
  if (!d) throw new PopcornError(`no Popcorn deployment for "${devnet}"; pass { factory, core } to popcorn()`);
  return d;
}

if (DEFAULT_CORE.creationHash !== FACTORY_CORE_CREATION_CODE_HASH) {
  // gen-artifacts.ts checks this too; this guards hand edits.
  throw new PopcornError(`DEFAULT_CORE ${DEFAULT_CORE.creationHash} != factory pin ${FACTORY_CORE_CREATION_CODE_HASH}`);
}
