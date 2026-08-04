import { prisma } from "@/lib/prisma";
import { CustodialSettlement } from "./custodial";
import { VaultSettlement } from "./vault";
import { CircleSettlement } from "./circleSettlement";
import type { SettlementProvider } from "./types";

export type { SettlementProvider, ShareLine } from "./types";

const custodial = new CustodialSettlement();
const circle = new CircleSettlement();
const vault = new VaultSettlement();

export type SettlementMode = "custodial" | "circle";

// Runtime override for demo purposes: lets an admin flip between the custodial
// (viem executor) and circle (Circle Developer-Controlled Wallet) signers
// without redeploying. Never overrides "onchain" - that's a distinct
// vault-based architecture, not just a different signer.
//
// Stored in the database, not in a module variable. On Vercel every serverless
// instance has its own memory: an override written by the instance that served
// the POST would be invisible to the instance that serves the next claim, so
// requests would flip between signers depending on which instance answered.
const OVERRIDE_KEY = "settlement_mode_override";

export async function setSettlementModeOverride(mode: SettlementMode | null): Promise<void> {
  if (mode === null) {
    await prisma.appSetting.deleteMany({ where: { key: OVERRIDE_KEY } });
    return;
  }
  await prisma.appSetting.upsert({
    where: { key: OVERRIDE_KEY },
    create: { key: OVERRIDE_KEY, value: mode },
    update: { value: mode },
  });
}

export async function getSettlementModeOverride(): Promise<SettlementMode | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: OVERRIDE_KEY } });
  return row?.value === "circle" || row?.value === "custodial" ? row.value : null;
}

/**
 * Resolve the active provider. Async because the override lives in the DB.
 *
 * A lookup failure falls back to the env-configured mode rather than throwing:
 * a settlement must not be blocked by the demo toggle being unreadable.
 */
export async function getSettlement(): Promise<SettlementProvider> {
  const mode = process.env.CUSTODY_MODE ?? "custodial";
  if (mode === "onchain") return vault;

  let override: SettlementMode | null = null;
  try {
    override = await getSettlementModeOverride();
  } catch {
    override = null;
  }
  return (override ?? mode) === "circle" ? circle : custodial;
}
