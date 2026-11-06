/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The explorer's starting network: "devnet1" (the public devnet) on the deployed site, "local" in development. */
  readonly VITE_DEFAULT_DEVNET?: "local" | "devnet1";
}
