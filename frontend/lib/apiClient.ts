// frontend/lib/apiClient.ts
// Client-side fetch wrapper that attaches the caller's Privy access token as a
// Bearer header, so server routes can authenticate the request (see lib/auth.ts).
// Use this instead of raw fetch() for any /api call that is user-scoped.

export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  // Imported lazily so the Privy SDK stays out of the initial page chunk.
  const { getAccessToken } = await import("@privy-io/react-auth");
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
