# SplitPort

Split-payout platform for global teams, paid in USDC on **Arc Testnet** (Circle).
Fund a shared treasury by card or crypto, set each person's share, and distribute —
by percentage, fixed salary, schedule, or a live stream. Recipients need only a
Google login; gas is paid by the executor in USDC, so no crypto skills are required.

**Live:** https://splitport.vercel.app

## How it works

1. **Fund** — top up a project treasury via Stripe (card, testnet 1:1) or an on-chain USDC transfer.
2. **Split** — add contributors by wallet address or invite link; set shares (%, fixed, scheduled, streaming).
3. **Distribute** — the executor settles payouts on-chain; recipients claim to their embedded wallet, fee deducted at claim.

## Stack

- **Frontend:** Next.js (App Router), Tailwind, TypeScript — `frontend/`
- **Auth & wallets:** Privy (embedded wallets, Google/email/wallet login)
- **Chain:** Arc Testnet, USDC settlement; `SplitVault.sol` (Solidity, Hardhat, 19 tests) — `contracts/`
- **Onramp:** Stripe (card → USDC, testnet)
- **DB:** Prisma / Postgres (distribution accounting)

## Run locally

```bash
# Frontend
cd frontend
npm install
cp .env.example .env.local   # set Privy, Stripe, DATABASE_URL, EXECUTOR_PRIVATE_KEY, etc.
npm run dev

# Contracts
cd contracts
npm install
npx hardhat test
```

See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for architecture and
[NONCUSTODIAL.md](NONCUSTODIAL.md) for the on-chain custody roadmap.
