// the rule contract's stake in the devnet's staking registry, for simulate() (the alt mempool's budgets and read rules
// depend on it). Separate file so actions.ts stays small.
import type { Address, PublicClient } from "viem";
import type { StakeStatus } from "@popcorn/simulator";
import { getDeployment, STAKING_REGISTRY } from "./deployments.ts";

const REGISTRY_ABI = [
  { type: "function", name: "getDepositInfo", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }, { type: "uint32" }, { type: "uint64" }] },
] as const;

/** The staking registry of a devnet (its deployment's, else the shared devnet address). */
export function stakingRegistryOf(devnet: string): Address {
  try {
    return getDeployment(devnet).stakingRegistry ?? STAKING_REGISTRY;
  } catch {
    return STAKING_REGISTRY;
  }
}

/**
 * registry.getDepositInfo(rule contract).stake. Returns null when the registry cannot be read (no code or the call fails), so
 * the explainer treats the stake as unknown rather than as "unstaked".
 */
export async function readStakeStatus(client: PublicClient, devnet: string, ruleContract: Address): Promise<StakeStatus | null> {
  const registry = stakingRegistryOf(devnet);
  try {
    const [stake] = await client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getDepositInfo", args: [ruleContract] });
    return { registry, stake, isStaked: stake > 0n };
  } catch {
    return null;
  }
}
