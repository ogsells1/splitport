# SplitPort × Arc

**One-liner:** SplitPort lets a global team fund a shared treasury by card or crypto and pay
everyone in USDC on Arc — by percentage, fixed salary, schedule, or a live stream — where
recipients need only a Google login and never touch gas.

Live: https://splitport.vercel.app · Repo: https://github.com/ogsells1/splitport

## What we're showing Arc

- **Gas abstraction.** The executor pays gas in USDC on the recipient's behalf; the platform
  fee is deducted at claim time (18→6 decimal handling), so contributors receive clean USDC
  and never hold a gas token.
- **Embedded wallets (Privy).** Google/email login provisions a wallet automatically —
  no seed phrases, no extension. This is the on-ramp story for non-crypto teams.
- **Card → USDC on-ramp (Stripe).** Treasury top-ups via card, 1:1 on testnet, alongside
  direct on-chain USDC transfers.
- **Four payout modes.** Instant percentage split, fixed amounts, scheduled payouts, and
  streaming — all driven by one split engine.

## Honest architecture position

Today, distribution accounting lives in our database; the **on-chain event is the final
settlement at claim**, when the executor sends USDC on Arc. `SplitVault.sol` (19 passing
Hardhat tests) is the building block for full on-chain custody. The migration path to a
non-custodial model is documented in [NONCUSTODIAL.md](NONCUSTODIAL.md). We are not claiming
trustless custody today — we're showing a working product with a credible on-chain roadmap.

## Metrics

- `SplitVault.sol`: 19/19 tests green.
- End-to-end verified on Arc Testnet: login → funded treasury (Stripe card) →
  distribute by % → contributor claim → USDC settled on-chain, fee deducted.
- Sample settlement tx (5.00 USDC claim): [0x1f74cee2…24cc26](https://testnet.arcscan.app/tx/0x1f74cee2bda1b546d6a5edb61cd5915e84e148f0b0b583facb1772049b24cc26)
- Gas paid by the executor in USDC — recipient receives their share minus fee, nothing upfront.

## Ask

- **Mainnet access** on Arc for a production pilot.
- **Ecosystem / grant program** participation.
- **Intro to Circle's on-ramp** team to move card→USDC from testnet toward production.
