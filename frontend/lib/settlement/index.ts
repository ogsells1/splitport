import { CustodialSettlement } from "./custodial";
import { VaultSettlement } from "./vault";
import { CircleSettlement } from "./circleSettlement";
import type { SettlementProvider } from "./types";

export type { SettlementProvider, ShareLine } from "./types";

const custodial = new CustodialSettlement();
const circle = new CircleSettlement();
const vault = new VaultSettlement();

// Runtime override for demo purposes: lets an admin flip between the
// custodial (viem executor) and circle (Circle Developer-Controlled Wallet)
// signers without redeploying. Never overrides "onchain" - that's a distinct
// vault-based architecture, not just a different signer.
let _modeOverride: "custodial" | "circle" | null = null;

export function setSettlementModeOverride(mode: "custodial" | "circle" | null) {
  _modeOverride = mode;
}

export function getSettlementModeOverride() {
  return _modeOverride;
}

export function getSettlement(): SettlementProvider {
  const mode = process.env.CUSTODY_MODE ?? "custodial";
  if (mode === "onchain") return vault;
  return (_modeOverride ?? mode) === "circle" ? circle : custodial;
}
