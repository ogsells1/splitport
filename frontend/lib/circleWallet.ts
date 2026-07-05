// frontend/lib/circleWallet.ts
// Circle Developer-Controlled Wallets client. Alternative treasury/executor
// signer for USDC payouts on Arc Testnet, alongside the viem-based executor
// in lib/executor.ts. Requires CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET,
// CIRCLE_WALLET_ID (see setup notes in .env.local).

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const USDC_TOKEN_ADDRESS = "0x3600000000000000000000000000000000000000";
// Circle's system-generated id for the ERC-20 USDC token on ARC-TESTNET.
// walletId-based calls require tokenId instead of tokenAddress+blockchain.
const USDC_TOKEN_ID = "ef87c8c3-85de-598a-af50-c5135eecfa74";

let _client: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;

function getClient() {
  if (!_client) {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    if (!apiKey || !entitySecret) return null;
    _client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  }
  return _client;
}

export function getCircleWallet() {
  const client = getClient();
  const walletId = process.env.CIRCLE_WALLET_ID;
  const address = process.env.CIRCLE_WALLET_ADDRESS;
  if (!client || !walletId || !address) return null;
  return { client, walletId, address };
}

/** USDC balance (6 decimals, as bigint) of the Circle-controlled wallet. */
export async function getCircleUsdcBalance(): Promise<bigint> {
  const wallet = getCircleWallet();
  if (!wallet) throw new Error("Circle wallet is not configured");

  const res = await wallet.client.getWalletTokenBalance({ id: wallet.walletId });
  const erc20 = res.data?.tokenBalances?.find(
    (t) => t.token.tokenAddress?.toLowerCase() === USDC_TOKEN_ADDRESS.toLowerCase()
  );
  if (!erc20) return 0n;
  // Circle returns decimal amounts (e.g. "5"); convert to 6-decimal bigint.
  return BigInt(Math.round(parseFloat(erc20.amount) * 1_000_000));
}

/** Estimated network fee (6-decimal USDC, as bigint) for transferring `amount` to `to`. */
export async function estimateCircleFee(to: string, amount: bigint): Promise<bigint> {
  const wallet = getCircleWallet();
  if (!wallet) throw new Error("Circle wallet is not configured");

  const decimalAmount = (Number(amount) / 1_000_000).toString();
  const res = await wallet.client.estimateTransferFee({
    walletId: wallet.walletId,
    tokenId: USDC_TOKEN_ID,
    destinationAddress: to,
    amount: [decimalAmount],
  });
  const networkFee = res.data?.medium?.networkFee;
  if (!networkFee) throw new Error("Could not estimate the Circle transfer fee");
  return BigInt(Math.ceil(parseFloat(networkFee) * 1_000_000));
}

/** Transfer USDC from the Circle wallet to `to`, waiting for on-chain confirmation. */
export async function circleTransferUsdc(to: string, amount: bigint): Promise<string> {
  const wallet = getCircleWallet();
  if (!wallet) throw new Error("Circle wallet is not configured");

  const decimalAmount = (Number(amount) / 1_000_000).toString();

  const createRes = await wallet.client.createTransaction({
    walletId: wallet.walletId,
    tokenId: USDC_TOKEN_ID,
    destinationAddress: to,
    amount: [decimalAmount],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  const transactionId = createRes.data?.id;
  if (!transactionId) throw new Error("Circle transfer did not return a transaction id");

  const res = await wallet.client.getTransaction({
    id: transactionId,
    waitForTxHash: true,
    pollingInterval: 2000,
  });
  return res.data.transaction.txHash;
}
