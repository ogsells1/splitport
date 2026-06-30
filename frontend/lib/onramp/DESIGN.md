# Fiat → USDC on-ramp (design)

## Problem
A card payment via Stripe gives us **fiat in a Stripe account** — it never becomes
on-chain USDC by itself. On testnet we paper over this: a card top-up credits only
a number in the DB (`treasury_deposits`, `1 USD = 1 USDC` hardcoded). The real USDC
that a claim sends comes from the **executor wallet**, which must be funded
separately. So the DB "treasury balance" can show 90 000 USDC while the executor
holds almost none → claims fail.

Moving claims onto a smart contract does **not** fix this — the contract would
still need real USDC deposited into it. The gap is *fiat → on-chain USDC*, not
*where the claim executes*.

## Goal
On mainnet, a card payment must end with **real USDC on-chain in the treasury
wallet**. Then distribute/claim work unchanged.

## Chosen approach: fiat on-ramp with wallet delivery
User pays by card inside a fiat→crypto on-ramp widget (Stripe Crypto Onramp,
Coinbase Onramp, Transak, MoonPay, …). The on-ramp handles KYC + conversion and
**delivers USDC on-chain to our treasury wallet**. We confirm the on-chain Transfer
and credit the DB.

```
card → on-ramp widget (KYC + convert) → USDC on-chain → treasury wallet
     → confirm on-chain transfer → credit treasury_deposits (CONFIRMED)
     → distribute (DB) → claim (real USDC leaves treasury)   ✅ backed
```

This **reuses** `app/api/treasury/deposit-crypto/route.ts`, which already verifies a
USDC Transfer to the treasury by txHash and marks the deposit CONFIRMED. Only the
"how USDC arrives" step changes; payout logic is untouched.

### Arc caveat
Arc is a new Circle chain; on-ramps may not deliver to Arc mainnet directly. Then:
deliver USDC on a supported chain (Base/Ethereum) → bridge to Arc via **Circle
CCTP** → credit. The bridge slots between delivery and confirm.

## Alternative: Stripe fiat + Circle Mint settlement
Card → Stripe (fiat) → backend converts collected fiat to USDC via **Circle Mint**
and tops up the treasury in batches. User sees instant DB credit; real USDC settles
later (platform carries float + custody/compliance burden). More regulatory weight.

## Abstraction (this folder)
- `types.ts` — `OnrampProvider` interface, `TopUpSession`, `SettlementResult`.
  `backedOnChain` flags whether credits are real USDC.
- `simulated.ts` — testnet provider (DB-only, `backedOnChain: false`). Current
  behavior; the live Stripe routes implement it.
- `walletDelivery.ts` — mainnet provider **stub** (`backedOnChain: true`). Throws
  `OnrampNotConfiguredError` until a concrete provider + config are filled in.
- `index.ts` — `getOnramp()` selects by `ONRAMP_MODE` (default `simulated`).

Nothing here is wired into the live routes yet — current testnet flow is unchanged.

## To make it real (checklist)
1. Pick a provider (account, API keys, supported chains/countries).
2. Implement `walletDelivery.createTopUp` (widget/session, destination = treasury).
3. Implement `walletDelivery.confirm` (verify delivered/bridged USDC → amount, txHash),
   reusing the `deposit-crypto` verification.
4. Add CCTP bridge step if Arc isn't a direct delivery target.
5. Mainnet config: chain id, USDC address, RPC, treasury key; set
   `ONRAMP_MODE=wallet-delivery` + `ONRAMP_*` env.
6. Point `/api/treasury/checkout` + confirmation at `getOnramp()`.
7. Compliance: KYC is provider-side; review money-transmitter exposure if the
   platform custodies fiat or funds.
```
