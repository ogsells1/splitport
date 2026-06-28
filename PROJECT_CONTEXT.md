# BYN Split Pay — Project Context

## Что строим
Платформа автоматического распределения доходов между участниками
музыкального проекта через USDC и smart contracts на Arc blockchain.
Поддерживает множество проектов на одного пользователя: каждый проект —
отдельный задеплоенный SplitVault-контракт.

## Стек
- Frontend: Next.js 14 + TypeScript + TailwindCSS
- Backend: Next.js API routes + Prisma 7.8.0 + PostgreSQL (Supabase) ✅ прод
- Blockchain: Arc Testnet (Chain ID: 5042002, RPC: https://rpc.testnet.arc.network)
- Contracts: Solidity + Hardhat + OpenZeppelin
- Auth: Privy (Google login + embedded wallets)
- Deploy: Vercel (frontend + backend) ✅

## Arc Testnet
- RPC: https://rpc.testnet.arc.network
- Chain ID: 5042002
- Gas token: USDC (не ETH)
- Explorer: https://testnet.arcscan.app
- Faucet: https://faucet.circle.com

## GitHub
https://github.com/ogsells1/byn-split-pay

## Production URLs
- App: https://byn-split-pay.vercel.app
- Vercel project: https://vercel.com/ofi-s-projects/byn-split-pay
- Supabase project: lwvyknrmowbcnrzdcyqd (eu-west-1, через pooler — direct connection IPv6-only и не работает на этой сети)

## DB-first проекты (без контракта) ✅ задеплоено
Новые проекты создаются БЕЗ on-chain контракта — ни owner, ни участник не нуждаются в web3/газе/подписи. `/create` (переписан, без деплоя): имя + контрибьюторы, каждый либо по кошельку (CLAIMED), либо по инвайт-ссылке (PENDING+token). `POST /api/project/create` генерит синтетический `contractAddress` вида `db_<hex>` (чтобы вся маршрутизация по contractAddress продолжала работать) и возвращает инвайт-ссылки. Дашборд `/dashboard/[address]` ветвится: `isAddress` → старый on-chain вид (`VaultInfo` и т.д.); `db_…` → `components/DbProjectDashboard.tsx` (контрибьюторы/инвайты из БД, генерация/отзыв инвайтов, статусы, ссылка на Treasury для distribute). Выплаты — кастодиальные (трежери → distribute по % → claim в кабинете). Старые контракт-проекты (0x…) работают как раньше.

## Core Flow (multi-project)
Sign in → `/dashboard` редиректит на первый проект пользователя или на `/create`,
если проектов нет → `/create` деплоит новый SplitVault из браузера (useDeployContract),
инициализирует участников, сохраняет проект в БД за текущим Privy user →
`/dashboard/[address]` — управление конкретным проектом (deposit, distribute,
edit contributors) → `/balance` — единый баланс кошелька, можно задепозитить
сразу в любой из проектов → `/history` — единая лента по всем проектам или
фильтр на один.

## Структура репозитория

```
byn-split-pay/
├── contracts/
│   ├── contracts/
│   │   ├── SplitVault.sol       — основной контракт
│   │   └── MockERC20.sol
│   ├── scripts/
│   │   ├── deploy.ts            — деплой нового SplitVault (CLI, для тестов)
│   │   ├── initialize.ts        — инициализация (хардкод CONTRIBUTORS в файле)
│   │   ├── replace_contributors.ts
│   │   ├── deposit.ts / distribute.ts / check.ts / debug.ts
│   │   └── lib/syncDb.ts        — POST /api/project после deploy/initialize (ownerPrivyId="cli-admin")
│   ├── test/SplitVault.test.ts  — 19 тестов, все проходят
│   ├── hardhat.config.ts
│   └── .env                     — PRIVATE_KEY, USDC_ADDRESS, API_URL
└── frontend/
    ├── app/
    │   ├── page.tsx              — лендинг + Privy login
    │   ├── create/page.tsx       — мастер создания проекта (deploy+initialize+sync)
    │   ├── balance/page.tsx      — unified balance + allocate в любой проект
    │   ├── dashboard/
    │   │   ├── page.tsx          — редиректор (на первый проект или /create)
    │   │   └── [address]/page.tsx — дашборд конкретного проекта
    │   ├── history/page.tsx      — БД-based история, unified или per-project
    │   └── api/
    │       ├── project/route.ts       — GET ?contractAddress=, POST (create/update)
    │       ├── projects/route.ts      — GET ?ownerPrivyId= (список проектов юзера)
    │       └── transactions/
    │           ├── route.ts           — GET ?contractAddress= | ?ownerPrivyId=
    │           └── sync/route.ts      — POST ?contractAddress= (ручной), GET (cron, все проекты)
    ├── components/
    │   ├── VaultInfo.tsx           — getProjectInfo/getContributors, poll 8s
    │   ├── DepositModal.tsx        — approve + depositRevenue, инвалидация кэша после tx
    │   ├── DistributeButton.tsx    — distribute() ИЛИ distributePartial(amount) — выбор в UI
    │   ├── ContributorsEditor.tsx  — replaceContributors(), owner-only
    │   ├── ProjectSwitcher.tsx     — дропдаун проектов в шапке дашборда
    │   └── ProjectAllocationRow.tsx — строка на /balance (deposit в конкретный проект)
    ├── lib/
    │   ├── contract.ts            — VAULT_ABI, USDC_ABI, SPLIT_VAULT_DEPLOY_ABI, SPLIT_VAULT_BYTECODE
    │   ├── SplitVaultArtifact.json — скопирован из contracts/artifacts (abi+bytecode), руками синкать после изменений .sol
    │   ├── wagmi.ts                — Arc Testnet defineChain
    │   └── prisma.ts               — PrismaPg adapter
    ├── prisma/schema.prisma
    ├── prisma.config.ts
    ├── vercel.json                 — cron: GET /api/transactions/sync раз в сутки
    ├── .env.local                  — DATABASE_URL/DIRECT_URL (Supabase pooler), NEXT_PUBLIC_PRIVY_APP_ID
    └── package.json                — postinstall: prisma generate
```

## Smart Contract — SplitVault.sol
Конструктор: `constructor(address _owner)`.

Функции:
- `initialize(name, usdcToken, wallets[], percentages[], roles[])` — onlyOwner, один раз
- `depositRevenue(amount)` — принимает USDC (требует approve)
- `distribute()` — раздаёт **весь** pending-баланс по basis points
- `distributePartial(amount)` — раздаёт **указанную** сумму (≤ pending), остаток остаётся в vault. ⚠️ Есть только у проектов, задеплоенных ПОСЛЕ этого изменения — старые контракты иммутабельны, у них только `distribute()`.
- `replaceContributors(wallets[], percentages[], roles[])` — атомарная замена, onlyOwner. Если есть pending balance — сначала вызвать distribute()
- `getProjectInfo()` / `getContributors()` — view
- `emergencyWithdraw()` — onlyOwner, только когда paused

И `distribute()`, и `distributePartial()` может вызвать owner ИЛИ любой контрибьютор (нет `onlyOwner`). Dust (остаток деления basis points в пределах распределяемой суммы) уходит owner'у.

Security: ReentrancyGuard, Ownable, Pausable, SafeERC20.

## База данных (Prisma + Supabase, применена ✅)
- `users` — id, privyId (уникальный, реальный Privy user.id или "cli-admin"/"system" для легаси), email, wallet
- `projects` — id, name, contractAddress (уникальный), usdcAddress, chainId, deployBlock, ownerId → users
- `contributors` — id, projectId, wallet (nullable — pending-инвайт без кошелька), percentage (basis points), role, active, totalPaid, status (PENDING/CLAIMED), inviteToken (uniq), claimedByPrivyId (никогда не отдаётся в owner-facing API)
- `transactions` — id, projectId, type (DEPOSIT/PAYMENT/DISTRIBUTION), amount, txHash, blockNumber, timestamp, fromAddress, toAddress, role
- `treasury_deposits` — id, userId, source (CARD/CRYPTO), amount (USDC 6 dec), status (PENDING/CONFIRMED/FAILED), stripeSessionId (uniq), txHash (uniq), confirmedAt. Баланс трежери = сумма CONFIRMED.

## Invite-link flow (контрибьюторы) ✅
Owner на дашборде («Edit Contributors» → «Invite by Link») создаёт слот роль+% без кошелька → `POST /api/invite` отдаёт `inviteToken` → ссылка `/invite/[token]`. Участник логинится через Privy и привязывает свой кошелёк (`POST /api/invite/[token]`). Owner видит подтверждение (бейдж + баннер), добавляет в список и пересчитывает % до 100, затем `replaceContributors` (on-chain). Owner НЕ видит связку личность↔адрес (адрес on-chain публичен всегда, скрыта именно личность). `DELETE /api/invite/[token]` — отзыв неклеймнутого. API: `frontend/app/api/invite/`, UI: `app/invite/[token]/page.tsx` + `components/ContributorsEditor.tsx`.

## Treasury + кабинет участника (полностью кастодиальная модель) ✅ задеплоено
Цель: и owner, и участник могут НЕ знать web3. Поток: **owner пополняет трежери (карта/крипта) → распределяет по % → участник в своём кабинете жмёт Claim → executor шлёт USDC на его кошелёк**. Тестнет: 1 USD = 1 USDC. Баланс трежери = sum(CONFIRMED deposits) − sum(Distribution.total).
- **Пополнение** (`/treasury`): `api/treasury/route`=GET баланс/депозиты/distributions, `checkout`=Stripe session, `webhook`=Stripe confirm (idempotent), `deposit-crypto`=верификация Transfer on-chain по txHash.
- **Distribute** (`POST /api/treasury/distribute`): owner делит сумму из трежери по basis points контрибьюторов → создаёт `Distribution` + по одному `Payout` на участника (status PENDING). Без on-chain, owner ничего не подписывает. Требует: все контрибьюторы с кошельками (claimed) и сумма % = 100. Dust остаётся в трежери. UI: `components/TreasuryDistributeRow.tsx`.
- **Кабинет** (`/cabinet`, участник-facing): `GET /api/cabinet?wallet=` — claimable (PENDING payouts по кошельку) + история. `POST /api/cabinet/claim` — executor (`lib/executor.ts`) одним transfer шлёт (gross − fee) USDC на кошелёк, газ платит executor, **комиссия вычитается из доли участника** (fee оценивается estimateContractGas×gasPrice×1.2). Помечает payouts CLAIMED. Privy embedded wallet создаётся автоматически для тех, у кого нет кошелька.
- Invite-флоу после привязки кошелька ведёт в `/cabinet`.
- Env (в Vercel Production ✅): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_TREASURY_ADDRESS`, `EXECUTOR_PRIVATE_KEY`. Без ключей — 503, UI не падает.
- ⚠️ Executor-кошелёк (`0xf89f…7A56`, см. memory) должен реально держать USDC (фаусет): card-пополнение кредитит только БД, on-chain USDC туда не поступает. Распределение — чисто БД; реальный USDC уходит только при claim.
- 🗑️ Старый on-chain allocate в SplitVault (`/api/treasury/allocate`, `Allocation` модель, `TreasuryAllocateRow`) удалён — заменён кастодиальным distribute. Старый `/balance` редиректит на `/treasury`.

⚠️ Demo-проект (`0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774`) принадлежит технической учётке `ownerId="system"` — он НЕ появится в списке проектов реального пользователя. Реальные проекты создаются через `/create`.

## Известные ограничения / решения
1. Gas token на Arc = USDC, не ETH
2. Supabase: direct connection (`db.<ref>.supabase.co`) — IPv6-only, использовать pooler (`aws-0-eu-west-1.pooler.supabase.com`)
3. Prisma 7.8.0: `prisma.config.ts` нужен явный `dotenv.config({path: ".env.local"})`, `datasource.url` — строка, без `migrate.adapter()`/`db.url()`
4. Vercel: нужен `"postinstall": "prisma generate"` в package.json
5. Vercel Hobby план: cron — максимум раз в сутки
6. `distributePartial()` — только у новых контрактов, старые не получат (immutable)
7. После изменения `SplitVault.sol` — обязательно пересобрать `frontend/lib/SplitVaultArtifact.json`:
   ```bash
   cd contracts && npx hardhat compile
   python3 -c "import json; d=json.load(open('artifacts/contracts/SplitVault.sol/SplitVault.json')); json.dump({'abi':d['abi'],'bytecode':d['bytecode']}, open('../frontend/lib/SplitVaultArtifact.json','w'), indent=2)"
   ```

## Текущий прогресс
- [x] SplitVault.sol — deploy, initialize, deposit, distribute, distributePartial, replaceContributors — всё протестировано (19/19 тестов)
- [x] Frontend на Vercel, Privy login (Google), Arc Testnet
- [x] Backend: Prisma + Supabase, API routes, cron sync
- [x] Мобильная адаптация (/history карточный вид)
- [x] Multi-project: /create (деплой из браузера), ProjectSwitcher, /dashboard/[address]
- [x] /history — унифицированная по всем проектам + фильтр на конкретный, читает из БД
- [x] /balance — unified balance кошелька + allocate в любой проект с одного экрана
- [x] Auto-refresh баланса (poll 8s + invalidate после своих транзакций)
- [x] Partial distribution с выбором суммы в UI

## Следующие шаги (на обсуждение в новом чате)
1. **Запланированные выплаты** — обсуждали, но не начали. Ключевая развилка:
   - (a) Автоисполнение по cron — нужен серверный кошелёк с приватным ключом в Vercel env + свои USDC на газ (gas token = USDC на Arc). `distribute()`/`distributePartial()` можно звать от любого адреса (нет onlyOwner), так что технически серверный "executor" кошелёк может это делать.
   - (b) Ручное подтверждение — UI показывает "Due", юзер подтверждает своим кошельком. Без серверных ключей.
   - Нужна новая таблица `ScheduledPayment` (projectId, amount|full, scheduledAt, status, executedAt, txHash).
2. UI создания проекта пока не валидирует баланс кошелька перед деплоем (можно улучшить UX)
3. AI Split — V3, не начато
4. Рассмотреть Vercel Pro, если нужен sync чаще раза в сутки

## Полезные команды
```bash
# Frontend dev
cd frontend && npm run dev

# Контракты: компиляция + тесты
cd contracts && npx hardhat compile && npx hardhat test

# Деплой во прод
cd frontend && vercel --prod

# Ручной sync конкретного проекта
curl -X POST "https://byn-split-pay.vercel.app/api/transactions/sync?contractAddress=0x..."
```
