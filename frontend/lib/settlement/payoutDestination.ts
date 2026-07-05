import { prisma } from "@/lib/prisma";

// A contributor authenticates and requests claims via their Privy wallet, but
// may have opted into a Circle User-Controlled Wallet as the actual payout
// destination (see app/api/cabinet/circle-wallet/route.ts). DB lookups for
// pending payouts/streams stay keyed on the Privy wallet; only the final
// on-chain transfer target changes.
export async function resolvePayoutAddress(wallet: string): Promise<string> {
  const contributor = await prisma.contributor.findFirst({
    where: { wallet: wallet.toLowerCase(), circleWallet: { not: null } },
    select: { circleWallet: true },
  });
  return contributor?.circleWallet ?? wallet;
}
