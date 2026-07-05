// Demo-only endpoint: lets an admin flip the settlement signer between the
// custodial viem executor and the Circle Developer-Controlled Wallet at
// runtime, without a redeploy. Gated by ADMIN_TOKEN (testnet convenience,
// not a production auth model).
import { NextResponse } from "next/server";
import {
  getSettlementModeOverride,
  setSettlementModeOverride,
} from "@/lib/settlement";
import { getCircleUsdcBalance } from "@/lib/circleWallet";

function checkToken(request: Request) {
  const token = request.headers.get("x-admin-token");
  return !!process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN;
}

export async function GET(request: Request) {
  if (!checkToken(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const envMode = process.env.CUSTODY_MODE ?? "custodial";
  const override = getSettlementModeOverride();
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
  if (!checkToken(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const mode = body.mode;
  if (mode !== "custodial" && mode !== "circle" && mode !== null) {
    return NextResponse.json({ error: "mode must be 'custodial', 'circle', or null" }, { status: 400 });
  }

  setSettlementModeOverride(mode);
  return NextResponse.json({ override: getSettlementModeOverride() });
}
