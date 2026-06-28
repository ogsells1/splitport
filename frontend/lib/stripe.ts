import Stripe from "stripe";

// Server-side Stripe client. Requires STRIPE_SECRET_KEY (test key on testnet).
// Lazily constructed so the app still builds/boots without the key configured
// (card top-up endpoints will return a clear 503 instead of crashing).
let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripe = new Stripe(key, { apiVersion: "2026-06-24.dahlia" });
  return stripe;
}
