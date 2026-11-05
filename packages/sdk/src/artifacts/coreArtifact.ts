// The shape of a Core build artifact (core-<version>.generated.ts files). Hand-written: generated files import it.
import type { Hex } from "viem";

export interface CoreArtifact {
  /** Core version label from contracts/core/build.sh. */
  version: string;
  compiler: string;
  evmVersion: string;
  /** Creation code; initcode = creation ++ 101 args bytes. */
  creation: Hex;
  /** Runtime code; a rule contract's deployed code = runtime ++ 101 args bytes. */
  runtime: Hex;
  creationHash: Hex;
  runtimeHash: Hex;
  argsLength: number;
  /** Bytes of the initcode after the creation code: 101 args, plus the 84 owner bytes from Core (older builds: 101). */
  initArgsLength?: number;
  constants: { nonceKeyGas: bigint; verifyFixedGas: bigint; mandatoryGas: bigint; floorPerByte: bigint; nonceRlpBytes: bigint; lockSlot: Hex };
  selectors: { pop: Hex; nonceKey: Hex; condition: Hex; action: Hex; owner?: Hex; ownerBump?: Hex };
}
