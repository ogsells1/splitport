// frontend/lib/treasuryBalance.ts
// Single source of truth for an owner's available treasury balance, used by the
// treasury GET, manual/scheduled distribute, and stream creation.
//
//   available = Σ CONFIRMED deposits
//             − Σ Distribution.total                (lump-sum payouts, reserved at distribute time)
//             − Σ stream commitment                 (streams reserve their buffer upfront)
//
// Stream commitment: an ACTIVE stream reserves its full `total` (Superfluid-style
// buffer). A CANCELED stream only keeps what was actually claimed; the unclaimed
// remainder is released back to available.

import { prisma } from "@/lib/prisma";

export async function getAvailableBalance(ownerId: string): Promise<bigint> {
  const [deposits, distributions, streams] = await Promise.all([
    prisma.treasuryDeposit.findMany({ where: { userId: ownerId, status: "CONFIRMED" } }),
    prisma.distribution.findMany({ where: { project: { ownerId } } }),
    prisma.payoutStream.findMany({
      where: { project: { ownerId } },
      include: { shares: { select: { claimedAmount: true } } },
    }),
  ]);

  const deposited = deposits.reduce((s, d) => s + d.amount, 0n);
  const distributed = distributions.reduce((s, d) => s + d.total, 0n);
  const streamed = streams.reduce((s, st) => {
    if (st.status === "CANCELED") {
      return s + st.shares.reduce((a, sh) => a + sh.claimedAmount, 0n);
    }
    return s + st.total;
  }, 0n);

  return deposited - distributed - streamed;
}
