// frontend/lib/circleUserWallet.ts
// Circle User-Controlled Wallets (PIN-secured, client SDK). Additive alternative
// payout destination for contributors, alongside their Privy embedded wallet.
// Uses the raw REST API directly - the Developer-Controlled Wallets SDK
// (@circle-fin/developer-controlled-wallets) doesn't cover the /users/* resources.

import { randomUUID } from "crypto";

const BASE_URL = "https://api.circle.com/v1/w3s";

function apiKey() {
  const key = process.env.CIRCLE_API_KEY;
  if (!key) throw new Error("Circle is not configured (missing CIRCLE_API_KEY)");
  return key;
}

async function circleFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.message ?? `Circle API error ${res.status} on ${path}`);
  }
  return body;
}

/** Registers a Circle user for `userId` if one doesn't already exist. Idempotent. */
export async function ensureCircleUser(userId: string): Promise<void> {
  try {
    await circleFetch("/users", { method: "POST", body: JSON.stringify({ userId }) });
  } catch (e) {
    // Circle returns 4xx if the user already exists - treat as success.
    if (!(e instanceof Error && /exist/i.test(e.message))) throw e;
  }
}

export async function getCircleUserToken(userId: string): Promise<{ userToken: string; encryptionKey: string }> {
  const body = await circleFetch("/users/token", { method: "POST", body: JSON.stringify({ userId }) });
  return { userToken: body.data.userToken, encryptionKey: body.data.encryptionKey };
}

/** Kicks off wallet creation for the user; returns a challengeId for the client SDK. */
export async function initializeCircleUserWallet(userToken: string): Promise<{ challengeId: string }> {
  const body = await circleFetch("/user/initialize", {
    method: "POST",
    headers: { "X-User-Token": userToken },
    body: JSON.stringify({ idempotencyKey: randomUUID(), blockchains: ["ARC-TESTNET"] }),
  });
  return { challengeId: body.data.challengeId };
}

/** Lists the user's wallets (call after the client completes the PIN challenge). */
export async function listCircleUserWallets(userToken: string): Promise<Array<{ id: string; address: string; blockchain: string }>> {
  const body = await circleFetch("/wallets", { headers: { "X-User-Token": userToken } });
  return body.data.wallets ?? [];
}
