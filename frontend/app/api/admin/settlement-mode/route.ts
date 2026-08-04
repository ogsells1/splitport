// Demo-only endpoint: lets an admin flip the settlement signer between the
// custodial viem executor and the Circle Developer-Controlled Wallet at
// runtime, without a redeploy. Gated by ADMIN_TOKEN (testnet convenience,
// not a production auth model) - and refused outright in production unless
// ADMIN_ENDPOINTS_ENABLED is set, so a single static token never guards a
// live money path by accident.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import {
  getSettlementModeOverride,
  setSettlementModeOverride,
} from "@/lib/settlement";
import { getCircleUsdcBalance } from "@/lib/circleWallet";

/** Constant-time compare; `===` on a secret leaks its prefix through timing. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which would itself be a signal,
  // so compare a fixed-size digest-shaped pair: equal lengths or an early false
  // is fine here because the length of ADMIN_TOKEN is not the secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** null when authorized; a NextResponse to return when not. */
function refuse(request: Request): NextResponse | null {
  if (process.env.NODE_ENV === "production" && process.env.ADMIN_ENDPOINTS_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const expected = process.env.ADMIN_TOKEN;
  const provided = request.headers.get("x-admin-token");
  if (!expected || !provided || !tokensMatch(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  const denied = refuse(request);
  if (denied) return denied;

  const envMode = process.env.CUSTODY_MODE ?? "custodial";
  const override = await getSettlementModeOverride();
  let circleBalance: string | null = null;
  try {
    circleBalance = (await getCircleUsdcBalance()).toString();
  } catch {
    circleBalance = null;
  }

  return NextResponse.json({
    envMode,
    override,
    activeMode: envMode === "onchain" ? "onchain" : override ?? envMode,
    circleBalance,
  });
}

export async function POST(request: Request) {
  const denied = refuse(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const mode = body.mode;
  if (mode !== "custodial" && mode !== "circle" && mode !== null) {
    return NextResponse.json({ error: "mode must be 'custodial', 'circle', or null" }, { status: 400 });
  }

  await setSettlementModeOverride(mode);
  return NextResponse.json({ override: await getSettlementModeOverride() });
}
