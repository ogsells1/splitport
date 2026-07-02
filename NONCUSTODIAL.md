# Non-custodial migration plan (custodial → on-chain custody)

Goal: move **custody of funds on-chain** (into per-project SplitVault contracts) to
shed the money-transmitter/custodian profile, **while preserving the current
product** — all features, UI, DB models and flows stay; only *where money lives*
and *how the final transfer executes* change.

This is written so implementation can start cold in the next session.

---

## 0. Guiding principles

1. **Non-custodial ≠ no automation.** Non-custodial means *no single party
   (including the platform) can divert funds* — the contract enforces who gets
   what. A cron/keeper may still **trigger** a distribution; it just can't change
   recipients or amounts. This is what lets us keep scheduled/auto payouts.
   - The existing `SplitVault.distribute()` is already callable by *anyone* and
     always pays the configured recipients by basis points → perfect fit.
2. **Preserve the DB orchestration layer.** `projects`, `contributors`,
   `distributions`, `payouts`, `payout_schedules`, `scheduled_payouts`,
   `payout_streams`, invites, cabinet — all stay. The DB becomes the
   *intent/index* layer; the chain becomes the *custody/settlement* layer.
3. **Dual-mode, flag-gated.** Add a `CUSTODY_MODE` switch (`custodial` |
   `onchain`) so testnet keeps working untouched while on-chain is built — exactly
   how `lib/onramp` was introduced.

---

## 1. What is preserved vs. what changes

| Area | Today (custodial) | Non-custodial | Change size |
|---|---|---|---|
| DB models & APIs | source of truth + custody | source of **intent/index** | small |
| Custody of USDC | executor EOA + DB number | **SplitVault contract per project** | core |
| Final transfer | `executor.transfer()` | **contract call** (`distribute`/pull) | medium |
| Auto/one-off payouts | cron → executor | cron **keeper triggers** `distribute()` | small |
| Treasury balance | `treasury_deposits` sum (DB) | **read on-chain** vault balance (DB mirrors) | medium |
| Deposit (on-ramp) | Stripe → DB credit | on-ramp delivers USDC **into the vault** | medium (uses `lib/onramp`) |
| Cabinet claim | executor sends | participant **claims from vault** (their Privy wallet) | medium |
| Invites (pending, no wallet) | reserve share in DB | DB intent until wallet linked, then on-chain | small |
| Fixed-amount mode | DB | needs **contract support** (see §4) | contract work |
| Streaming | DB accrual on read | on-chain primitive (Sablier/Superfluid) **or** phase later | large → defer |
| Gas for participants | executor pays | **paymaster (ERC-4337)** or recipient-pays | medium |

The big wins preserved: every screen, schedules, one-off queue, invites, fixed
mode UI, cabinet. The hard parts to keep identical: **streaming** (defer) and
**pending-invite pre-distribution** (becomes deferred settlement).

---

## 2. Target architecture

```
on-ramp (KYC by provider) ── delivers USDC ──▶ SplitVault[project]  (holds funds)
                                                   ▲        │
 owner sets split config (wallets, %, or fixed) ───┘        │
 cron keeper / owner / contributor ── triggers ── distribute()  ── pays recipients
 contributor ── claim() ── pulls own share ───────────────┘  (gas via paymaster)

DB (projects, payouts, schedules, streams, invites)  ── mirrors/indexes on-chain
   via /api/transactions/sync (already exists)
```

- **Factory**: platform deploys a `SplitVault` per project via a factory (platform
  pays deploy gas; **owner is the contract owner**, platform holds no fund keys).
- **DB ↔ chain**: `contractAddress` already keys every project. Today it's a
  synthetic `db_…`; in on-chain mode it's the real `0x…` vault. Routing already
  branches on `isAddress(...)`, so both coexist.

---

## 3. The `lib/settlement` abstraction (key to preserving logic)

Mirror of `lib/onramp`. A single interface that the payout code calls; two
implementations selected by `CUSTODY_MODE`.

```ts
// lib/settlement/types.ts
export interface SettlementProvider {
  readonly mode: "custodial" | "onchain";
  /** Available balance to pay out for a project (USDC 6dec). */
  availableBalance(project): Promise<bigint>;
  /** Execute a distribution of computed shares (see computeShares()). */
  settleDistribution(project, shares: ShareLine[]): Promise<{ txHash?: string }>;
  /** A participant claims what they're owed. */
  settleClaim(project, wallet): Promise<{ txHash?: string; net: bigint }>;
}
```

- `custodialSettlement` — wraps **today's** logic (executor transfer, DB balance).
  Nothing changes on testnet.
- `vaultSettlement` — calls the SplitVault: `availableBalance` = on-chain USDC
  balance; `settleDistribution` = `distribute()`/`distributePartial(amount)` (or
  `payEach` for fixed); `settleClaim` = vault pull-claim.

Then refactor these call sites to go through `getSettlement()`:
- `lib/distribute.ts` `runDistribution` (manual + cron use it already)
- `app/api/cabinet/claim/route.ts`
- `lib/treasuryBalance.ts` (`getAvailableBalance`)
- `app/api/treasury/schedule/run/route.ts` (cron keeper) — unchanged; it calls
  `runDistribution`, which now routes through settlement.

This is the crux: **payout business logic stays; only the settlement backend
swaps.** `computeShares()` (already extracted) keeps producing the share lines for
both modes.

---

## 4. Smart-contract changes (`contracts/`)

Current `SplitVault.sol` (basis points, push `distribute()`) covers %-mode. Needed:

1. **Factory** `SplitVaultFactory.sol` — `createVault(owner, usdc) → address`;
   emits event for indexing. Platform pays deploy gas.
2. **Fixed-amount support** — either:
   - a generic `payEach(address[] recipients, uint256[] amounts)` (onlyOwner or
     keeper) the backend calls with `computeShares()` output, **or**
   - a `FixedSplitVault` variant storing per-recipient fixed amounts.
   `payEach` is simpler and serves both modes (pass %-computed or fixed amounts).
3. **Pull-claim** `claim()` — per-recipient withdrawable balance so the cabinet
   "Claim" maps to a contract call by the participant. Keep push `distribute()`
   too (owner/keeper batch). Decide push vs pull as default (see §8).
4. **Reentrancy/Pausable/SafeERC20** — already in SplitVault; keep.
5. After editing `.sol`: recompile + refresh `frontend/lib/SplitVaultArtifact.json`
   (procedure already in PROJECT_CONTEXT §"Известные ограничения" #7).

Streaming on-chain (if/when): integrate **Sablier** or **Superfluid** if available
on Arc; otherwise keep streaming custodial-only behind the flag and defer.

---

## 5. Per-feature mapping (what each existing feature becomes)

- **Manual distribute** (`/api/treasury/distribute`): `computeShares()` →
  `settlement.settleDistribution()`. On-chain = `payEach`/`distribute`. FIXED
  `contributorIds` subset → `payEach` with that subset. **No UI change.**
- **Auto payouts** (`payout_schedules`, cron): keeper calls `runDistribution` on
  due schedules → settlement. **No schema/UI change.** Non-custodial because the
  vault enforces recipients.
- **One-off payouts** (`scheduled_payouts`): same as above.
- **Fixed mode**: `payEach` with the fixed amounts. Treasury balance read from
  vault. **UI unchanged.**
- **Streaming**: *defer.* Phase 1 keeps it custodial-only (flag), or maps to
  Sablier in a later phase. Document as known limitation.
- **Invites / pending (no wallet)**: keep DB reservation. On-chain config
  (`replaceContributors`) only includes wallet-linked contributors. A
  distribution to a still-pending contributor stays **DB-deferred** until the
  invite is claimed and the wallet is added on-chain; then it settles. Preserves
  the current "distribute before invite accepted" UX as a pending settlement.
- **Cabinet claim**: `settlement.settleClaim()` → on-chain pull by the
  participant's Privy wallet (gas via paymaster). The "Available to claim" number
  comes from the vault. **UI unchanged.**
- **Deposit / top-up**: `lib/onramp` `wallet-delivery` provider delivers USDC to
  the **vault address**; reuse `deposit-crypto` verification to confirm + mirror
  in DB. Balance reads come from chain.

---

## 6. Gas strategy

Arc gas = USDC, and non-custodial means participants transact.
- **Primary: ERC-4337 paymaster** sponsors participant gas (still non-custodial of
  *funds* — only gas is sponsored). Needs a bundler/paymaster on Arc.
- **Fallback: recipient-pays** — they hold a little of the USDC they receive.
- **Owner batch**: `distribute()` push paid by the owner for the whole batch
  (no per-participant gas).
Pick per flow; paymaster gives the closest-to-today UX.

---

## 7. Backend/file change list (concrete starting points)

Contracts:
- `contracts/contracts/SplitVaultFactory.sol` — new.
- `contracts/contracts/SplitVault.sol` — add `payEach`, optional `claim` pull.
- `contracts/scripts/` — factory deploy + a `createVault` helper.
- refresh `frontend/lib/SplitVaultArtifact.json` + factory ABI in `lib/contract.ts`.

Backend (frontend/):
- `lib/settlement/{types,custodial,vault,index}.ts` — new abstraction.
- `lib/distribute.ts` — route settlement through `getSettlement()`.
- `lib/treasuryBalance.ts` — on-chain balance in `onchain` mode.
- `app/api/cabinet/claim/route.ts` — `settleClaim()`.
- `app/api/project/create/route.ts` — in `onchain` mode, deploy a vault via
  factory and store the real `0x…` as `contractAddress` (custodial mode keeps
  `db_…`). Invite/share logic unchanged.
- `app/api/treasury/onramp/*` — wire `lib/onramp` `wallet-delivery` to deliver to
  the vault; reuse `deposit-crypto`.
- `app/api/treasury/schedule/run/route.ts` — unchanged (keeper triggers).
- Env: `CUSTODY_MODE`, factory address, paymaster config, mainnet chain/USDC/RPC.

Frontend UI: **mostly unchanged** — components read the same API shapes. Cabinet
claim may need to send a tx via the Privy wallet (instead of a server call) if we
choose participant-signed pull; abstract behind the existing claim button.

---

## 8. Open decisions (resolve at start of implementation)

1. **Push vs pull payout** — `distribute()` push (owner/keeper pays gas, simplest)
   vs `claim()` pull (participant-signed, most non-custodial). Recommendation:
   **pull + paymaster** to keep today's cabinet "Claim" UX and full non-custody.
2. **One vault per project vs one shared vault with sub-accounts** — per-project is
   cleaner/isolated but costs a deploy each; shared is cheaper but more contract
   logic and a weaker custody story. Recommendation: **per-project via factory**.
3. **Streaming** — defer (flag-gated custodial) vs Sablier/Superfluid now.
   Recommendation: **defer to a later phase.**
4. **Arc on-ramp support** — direct delivery to Arc vs deliver elsewhere + **CCTP**
   bridge. Verify provider support first (see `lib/onramp/DESIGN.md`).
5. **Paymaster availability on Arc** — confirm a bundler/paymaster exists; else
   recipient-pays gas for MVP.

---

## 9. Phased rollout (keeps testnet alive throughout)

- **Phase 0** — add `CUSTODY_MODE` flag + `lib/settlement` with `custodial` impl
  wrapping today's code. Behavior identical. (Pure refactor, safe.)
- **Phase 1** — contracts: factory + `payEach` (+ pull `claim`); deploy on
  testnet; `vault` settlement impl; create projects in `onchain` mode behind flag.
- **Phase 2** — wire `lib/onramp` `wallet-delivery` → vault; on-chain balance
  reads; cabinet claim via vault (+ paymaster).
- **Phase 3** — auto/one-off keeper triggers `distribute()` on-chain; pending-invite
  deferred settlement.
- **Phase 4** — streaming decision (Sablier/Superfluid or keep deferred).
- **Phase 5** — mainnet config, real on-ramp provider, audit, compliance review
  (ToS/privacy, sanctions screening), legal sign-off.

---

## 10. Compliance note (carry into mainnet)

Non-custodial materially lowers (does not auto-erase) regulatory burden. Still
required: sanctions/OFAC screening, ToS/Privacy, and **legal counsel sign-off per
jurisdiction** before mainnet. KYC sits with the on-ramp (buyer) and off-ramp
(payee). Keep the platform genuinely keyless over user funds — that is the whole
basis of the lighter profile. See compliance discussion in chat history /
`lib/onramp/DESIGN.md`.
