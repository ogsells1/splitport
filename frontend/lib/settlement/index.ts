import { CustodialSettlement } from "./custodial";
import { VaultSettlement } from "./vault";
import type { SettlementProvider } from "./types";

export type { SettlementProvider, ShareLine } from "./types";

let _settlement: SettlementProvider | null = null;

export function getSettlement(): SettlementProvider {
  if (!_settlement) {
    const mode = process.env.CUSTODY_MODE ?? "custodial";
    _settlement = mode === "onchain"
      ? new VaultSettlement()
      : new CustodialSettlement();
  }
  return _settlement;
}
