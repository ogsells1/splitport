// frontend/app/api/cabinet/circle-wallet/route.ts
// Lets a contributor generate a Circle User-Controlled Wallet (PIN-secured) as
// an alternative payout destination, additive to their Privy embedded wallet.
//
// GET  ?wallet=0x...        - current circleWallet status for this contributor.
// POST { wallet, action: "init" }    - starts wallet creation, returns Circle SDK params.
// POST { wallet, action: "confirm" } - after the client completes the PIN challenge,
//                                      fetches the new wallet address and saves it.

import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { prisma } from "@/lib/prisma";
import { requireWallet, authErrorResponse } from "@/lib/auth";
import {
  ensureCircleUser,
  getCircleUserToken,
  initializeCircleUserWallet,
  listCircleUserWallets,
} from "@/lib/circleUserWallet";

// One Circle user per app wallet address, shared across all of that wallet's
// Contributor rows (a wallet can belong to several projects).
function circleUserIdFor(wallet: string) {
  return `splitport-${wallet.toLowerCase()}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "A valid wallet is required" }, { status: 400 });
  }
  try {
    await requireWallet(request, wallet);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  const contributor = await prisma.contributor.findFirst({
    where: { wallet: wallet.toLowerCase(), circleWallet: { not: null } },
    select: { circleWallet: true },
  });

  return NextResponse.json({ circleWallet: contributor?.circleWallet ?? null });
}

export async function POST(request: Request) {
  try {
    const { wallet, action } = await request.json();
    if (!wallet || !isAddress(wallet)) {
      return NextResponse.json({ error: "A valid wallet is required" }, { status: 400 });
    }

    try {
      await requireWallet(request, wallet);
    } catch (e) {
      const { error, status } = authErrorResponse(e);
      return NextResponse.json({ error }, { status });
    }

    const circleUserId = circleUserIdFor(wallet);

    if (action === "init") {
      await ensureCircleUser(circleUserId);
      const { userToken, encryptionKey } = await getCircleUserToken(circleUserId);
      const { challengeId } = await initializeCircleUserWallet(userToken);
      return NextResponse.json({
        appId: process.env.NEXT_PUBLIC_CIRCLE_APP_ID,
        userToken,
        encryptionKey,
        challengeId,
      });
    }

    if (action === "confirm") {
      const { userToken } = await getCircleUserToken(circleUserId);
      const wallets = await listCircleUserWallets(userToken);
      const arcWallet = wallets.find((w) => w.blockchain === "ARC-TESTNET");
      if (!arcWallet) {
        return NextResponse.json({ error: "No Circle wallet found yet - the PIN setup may not have completed." }, { status: 409 });
      }

      const walletLc = wallet.toLowerCase();
      await prisma.contributor.updateMany({
        where: { wallet: walletLc },
        data: { circleUserId, circleWallet: arcWallet.address.toLowerCase() },
      });

      return NextResponse.json({ circleWallet: arcWallet.address.toLowerCase() });
    }

    return NextResponse.json({ error: "action must be 'init' or 'confirm'" }, { status: 400 });
  } catch (error: any) {
    console.error("[POST /api/cabinet/circle-wallet]", error);
    return NextResponse.json({ error: error?.message ?? "Internal server error" }, { status: 500 });
  }
}
