// frontend/app/api/invite/[token]/route.ts
// GET    /api/invite/[token] - public, returns slot info for the invite-claim page
// POST   /api/invite/[token] - participant claims the slot with their own wallet
// DELETE /api/invite/[token] - owner revokes a not-yet-claimed invite

import { NextResponse } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { prisma } from "@/lib/prisma";
import { getExecutor } from "@/lib/executor";
import { VAULT_ABI } from "@/lib/contract";
import { requireUser, requireWallet, authErrorResponse } from "@/lib/auth";
import { enforceRateLimit, RateLimitError, callerIp } from "@/lib/rateLimit";

export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  try {
    // The one public, unauthenticated route here, so the bucket is the caller's
    // IP. Invite tokens carry 24 bytes of entropy and are not guessable, but a
    // ceiling keeps enumeration attempts from costing us DB traffic.
    try {
      await enforceRateLimit("inviteLookup", callerIp(_request));
    } catch (e) {
      if (e instanceof RateLimitError) {
        return NextResponse.json(
          { error: e.message },
          { status: e.status, headers: { "Retry-After": String(e.retryAfterSeconds) } }
        );
      }
      throw e;
    }

    const { token } = params;

    const contributor = await prisma.contributor.findUnique({
      where: { inviteToken: token },
      include: { project: { select: { name: true, contractAddress: true, splitMode: true } } },
    });

    if (!contributor) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    return NextResponse.json({
      projectName: contributor.project.name,
      name: contributor.name,
      role: contributor.role,
      percentage: contributor.percentage,
      fixedAmount: contributor.fixedAmount != null ? contributor.fixedAmount.toString() : null,
      splitMode: contributor.project.splitMode,
      status: contributor.status,
    });
  } catch (error) {
    console.error("[GET /api/invite/[token]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params;
    const body = await request.json();
    const { wallet } = body;

    if (!wallet || !isAddress(wallet)) {
      return NextResponse.json({ error: "A valid wallet is required" }, { status: 400 });
    }

    let privyId: string;
    try {
      privyId = await requireWallet(request, wallet);
    } catch (e) {
      const { error, status } = authErrorResponse(e);
      return NextResponse.json({ error }, { status });
    }

    const contributor = await prisma.contributor.findUnique({
      where: { inviteToken: token },
    });

    if (!contributor) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    if (contributor.status === "CLAIMED") {
      return NextResponse.json({ error: "Invite already claimed" }, { status: 409 });
    }

    const duplicate = await prisma.contributor.findFirst({
      where: {
        projectId: contributor.projectId,
        wallet: { equals: wallet, mode: "insensitive" },
      },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "This wallet is already a contributor on this project" },
        { status: 409 }
      );
    }

    await prisma.contributor.update({
      where: { id: contributor.id },
      data: {
        wallet,
        status: "CLAIMED",
        claimedByPrivyId: privyId,
      },
    });

    // Reserved payouts and stream shares created before this invite was claimed
    // now become claimable: attach the linked wallet so they show up in the cabinet.
    const deferredPayouts = await prisma.payout.findMany({
      where: { contributorId: contributor.id, wallet: null, status: "PENDING" },
      include: { project: { select: { contractAddress: true } } },
    });
    await prisma.payout.updateMany({
      where: { contributorId: contributor.id, wallet: null, status: "PENDING" },
      data: { wallet: wallet.toLowerCase() },
    });
    await prisma.streamShare.updateMany({
      where: { contributorId: contributor.id, wallet: null },
      data: { wallet: wallet.toLowerCase() },
    });

    // Vault mode: deferred settlement - call accrue() on each vault for the
    // reserved-but-not-yet-accrued amounts. The vault holds the funds; we now
    // tell it who can claim them.
    if (process.env.CUSTODY_MODE === "onchain" && deferredPayouts.length > 0) {
      const executor = getExecutor();
      if (executor) {
        // Group by vault (one project may have multiple deferred payouts).
        const byVault = new Map<string, bigint>();
        for (const p of deferredPayouts) {
          const addr = p.project.contractAddress;
          if (!isAddress(addr)) continue;
          byVault.set(addr, (byVault.get(addr) ?? 0n) + p.amount);
        }
        for (const [contractAddress, total] of byVault) {
          try {
            const txHash = await executor.walletClient.writeContract({
              address: getAddress(contractAddress) as Address,
              abi: VAULT_ABI,
              functionName: "accrue",
              args: [[getAddress(wallet) as Address], [total]],
            });
            await executor.publicClient.waitForTransactionReceipt({ hash: txHash });
          } catch (e) {
            // Log but don't fail the invite claim - the DB payout is already
            // attached to the wallet and can be retried manually or via keeper.
            console.error("[invite claim] deferred accrue failed", contractAddress, e);
          }
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[POST /api/invite/[token]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { token: string } }
) {
  let ownerPrivyId: string;
  try {
    ownerPrivyId = await requireUser(request);
  } catch (e) {
    const { error, status } = authErrorResponse(e);
    return NextResponse.json({ error }, { status });
  }

  try {
    const { token } = params;

    const contributor = await prisma.contributor.findUnique({
      where: { inviteToken: token },
      include: { project: { include: { owner: true } } },
    });

    if (!contributor) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    if (contributor.project.owner.privyId !== ownerPrivyId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (contributor.status === "CLAIMED") {
      return NextResponse.json({ error: "Cannot revoke a claimed invite" }, { status: 409 });
    }

    await prisma.contributor.delete({ where: { id: contributor.id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/invite/[token]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
