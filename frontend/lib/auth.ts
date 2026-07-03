// frontend/lib/auth.ts
// Server-side Privy authentication. Every mutating or user-scoped API route must
// derive the caller's identity from a verified Privy access token – never from a
// privyId/wallet value supplied in the request body or query string.
//
// Client sends the token as `Authorization: Bearer <privy access token>`
// (see lib/apiClient.ts). We verify it with the app secret and, for wallet-scoped
// routes, confirm the requested wallet is actually linked to that user.

import { PrivyClient } from "@privy-io/server-auth";

let _client: PrivyClient | null = null;

function getPrivy(): PrivyClient | null {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) return null;
  if (!_client) _client = new PrivyClient(appId, appSecret);
  return _client;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) throw new AuthError("Missing authentication token");
  return token;
}

/** Read a cookie value from the request's Cookie header. */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Verify the caller's Privy access token and return their Privy DID (the value
 * stored as `User.privyId` in our DB). Throws AuthError on any failure.
 */
export async function requireUser(request: Request): Promise<string> {
  const privy = getPrivy();
  if (!privy) {
    throw new AuthError("Authentication is not configured (missing PRIVY_APP_SECRET).", 503);
  }
  const token = bearerToken(request);
  try {
    const claims = await privy.verifyAuthToken(token);
    return claims.userId;
  } catch {
    throw new AuthError("Invalid or expired authentication token");
  }
}

/**
 * Verify the caller AND that `wallet` is linked to their Privy account. Returns
 * the caller's Privy DID. Use for wallet-scoped routes (cabinet, claim) so a user
 * can only read/act on wallets they actually own.
 */
export async function requireWallet(request: Request, wallet: string): Promise<string> {
  const userId = await requireUser(request);
  const privy = getPrivy()!;
  const target = wallet.toLowerCase();

  // Prefer the identity-token cookie: getUser({idToken}) parses it locally with no
  // API round-trip, so it isn't subject to Privy's getUser(userId) rate limits.
  // Fall back to the (rate-limited) DID lookup if the cookie isn't present.
  const idToken = readCookie(request, "privy-id-token");
  let user;
  try {
    user = idToken ? await privy.getUser({ idToken }) : await privy.getUser(userId);
  } catch {
    throw new AuthError("Could not verify wallet ownership");
  }
  // The identity token must belong to the same user the access token authenticated.
  if (user.id !== userId) {
    throw new AuthError("Authentication token mismatch");
  }

  const owns = user.linkedAccounts.some(
    (a) =>
      (a.type === "wallet" || a.type === "smart_wallet") &&
      "address" in a &&
      typeof a.address === "string" &&
      a.address.toLowerCase() === target
  );
  if (!owns) {
    throw new AuthError("This wallet does not belong to the authenticated user", 403);
  }
  return userId;
}

/**
 * Authorize a cron-triggered request (Vercel Cron sends `Authorization: Bearer
 * <CRON_SECRET>`). In production a missing CRON_SECRET fails closed – we never
 * leave the cron endpoints publicly triggerable on a deployed app. Outside
 * production a missing secret is allowed so local/dev runs work without config.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Map an AuthError (or anything) to a NextResponse-friendly { error, status }. */
export function authErrorResponse(error: unknown): { error: string; status: number } {
  if (error instanceof AuthError) return { error: error.message, status: error.status };
  return { error: "Unauthorized", status: 401 };
}
