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
Новые проекты создаются БЕЗ on-chain контракта — ни owner, ни участник не нуждаются в web3/газе/подписи. `/create` (переписан, без деплоя): имя + контрибьюторы, каждый либо по кошельку (CLAIMED), либо по инвайт-ссылке (PENDING+token). `POST /api/project/create` генерит синтетический `contractAddress` вида `db_<hex>` (чтобы вся маршрутизация по contractAddress продолжала работать) и возвращает инвайт-ссылки. Дашборд `/dashboard/[address]` ветвится: `isAddress` → старый on-chain вид (`VaultInfo` и т.д.); `db_…` → `components/DbProjectDashboard.tsx`. Старые контракт-проекты (0x…) работают как раньше.

`DbProjectDashboard` показывает: контрибьюторов/инвайты из БД (генерация/копирование/отзыв ссылок, статусы), **баланс трежери + поле суммы и кнопку Distribute прямо на странице проекта** (по %), и сколько уже распределено в проект. Распределять можно ДО подтверждения инвайтов (доля резервируется).

## Core Flow (актуальный, кастодиальный)
Sign in → `/dashboard` — **хаб** (`app/dashboard/page.tsx`, НЕ редирект): карточка «Your cabinet» (claimable + Open cabinet, роль контрибьютора) и «Your projects» (список своих проектов + New, роль создателя). Заголовок «BYN Split Pay» в шапке везде ведёт на `/dashboard`.
- **Создатель:** `/create` (DB-first, без web3) → проект + инвайт-ссылки → `/dashboard/[db_id]` (управление + Distribute) → `/treasury` (пополнение картой/криптой).
- **Контрибьютор:** инвайт-ссылка `/invite/[token]` → логин (Privy создаёт кошелёк сам) → `/cabinet`: claimable, кнопка Claim (executor шлёт USDC, комиссия вычитается из доли), + блок «Add Arc network / Add USDC token» (EIP-1193) чтобы увидеть деньги во внешнем кошельке.
- `/balance` → редирект на `/treasury`. `/history` — лента транзакций (для on-chain проектов).

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
- `payout_schedules` — id, projectId (uniq, 1 расписание/проект), frequency (WEEKLY/MONTHLY/CUSTOM), amount (фикс USDC 6 dec за запуск), nextRunAt, active, lastRunAt. Авто-выплаты (см. ниже).
- `scheduled_payouts` — id, projectId (много на проект), amount (фикс USDC 6 dec), runAt, status (PENDING/DONE/CANCELED), distributionId (после запуска), ranAt. Очередь разовых отложенных выплат.

## Invite-link flow (контрибьюторы) ✅
Owner на дашборде («Edit Contributors» → «Invite by Link») создаёт слот роль+% без кошелька → `POST /api/invite` отдаёт `inviteToken` → ссылка `/invite/[token]`. Участник логинится через Privy и привязывает свой кошелёк (`POST /api/invite/[token]`). Owner видит подтверждение (бейдж + баннер), добавляет в список и пересчитывает % до 100, затем `replaceContributors` (on-chain). Owner НЕ видит связку личность↔адрес (адрес on-chain публичен всегда, скрыта именно личность). `DELETE /api/invite/[token]` — отзыв неклеймнутого. API: `frontend/app/api/invite/`, UI: `app/invite/[token]/page.tsx` + `components/ContributorsEditor.tsx`.

## Treasury + кабинет участника (полностью кастодиальная модель) ✅ задеплоено
Цель: и owner, и участник могут НЕ знать web3. Поток: **owner пополняет трежери (карта/крипта) → распределяет по % → участник в своём кабинете жмёт Claim → executor шлёт USDC на его кошелёк**. Тестнет: 1 USD = 1 USDC. Баланс трежери = sum(CONFIRMED deposits) − sum(Distribution.total).
- **Пополнение** (`/treasury`): `api/treasury/route`=GET баланс/депозиты/distributions, `checkout`=Stripe session, `webhook`=Stripe confirm (idempotent), `deposit-crypto`=верификация Transfer on-chain по txHash.
- **Distribute** (`POST /api/treasury/distribute`): owner делит сумму из трежери по basis points контрибьюторов → создаёт `Distribution` + по одному `Payout` на участника. Можно распределять ДО подтверждения инвайтов: pending-контрибьютору создаётся «зарезервированный» payout с `wallet=null` (+ `contributorId`); при подтверждении инвайта (`POST /api/invite/[token]`) кошелёк проставляется в эти payout'ы (updateMany) и они становятся claimable в кабинете. Требует только сумму % = 100. Dust остаётся в трежери. UI: `components/TreasuryDistributeRow.tsx`.
- **Кабинет** (`/cabinet`, участник-facing): `GET /api/cabinet?wallet=` — claimable (PENDING payouts по кошельку) + история. `POST /api/cabinet/claim` — executor (`lib/executor.ts`) одним transfer шлёт (gross − fee) USDC на кошелёк, газ платит executor, **комиссия вычитается из доли участника**. ⚠️ Газ-токен Arc = 18 знаков (wei), а USDC ERC20 = 6 знаков: fee = `gas×gasPrice×1.2 / 10^12` (конвертация wei→USDC units; без неё claim падал «balance too small»). Помечает payouts CLAIMED. Privy embedded wallet создаётся автоматически. Также в кабинете кнопки «Add Arc network» / «Add USDC token» (EIP-1193 `wallet_addEthereumChain`/`wallet_watchAsset`) — чтобы участник увидел поступление во внешнем кошельке.
- Invite-флоу после привязки кошелька ведёт в `/cabinet`.

## Авто-выплаты (scheduled distribute) ✅
Owner на странице проекта задаёт **фиксированную сумму** + частоту: раз в неделю / раз в месяц / кастомная разовая дата. По расписанию автоматически выполняется тот же кастодиальный distribute (создаёт claimable `Payout`'ы по %); контрибьютор по-прежнему сам жмёт Claim в кабинете.
- Логика distribute вынесена в `lib/distribute.ts` (`runDistribution`, `DistributionError`) — общая для ручного `POST /api/treasury/distribute` и крона. `ownerPrivyId` опционален: задан → проверка владельца (ручной путь), опущен → системный запуск (крон).
- `lib/schedule.ts` — `advanceFrom`/`defaultNextRun` (WEEKLY +7д, MONTHLY +1мес, CUSTOM one-shot).
- API `app/api/treasury/schedule/route.ts`: GET (текущее расписание), POST (upsert: frequency+amount+nextRunAt?, для WEEKLY/MONTHLY дата опциональна = через интервал от now, для CUSTOM обязательна), DELETE (выключить). Все — owner-only.
- Cron-runner `app/api/treasury/schedule/run/route.ts` (GET): берёт active && nextRunAt ≤ now, на каждом запускает `runDistribution`, затем WEEKLY/MONTHLY → продвигает `nextRunAt` (от запланированной даты, перепрыгивая пропущенные интервалы), CUSTOM → `active=false`. Недостаток баланса (`DistributionError`) → расписание не трогаем, ретрай на следующий день. Опц. защита `CRON_SECRET` (Bearer).
- `vercel.json`: добавлен дневной крон `0 4 * * *` (Hobby: 2 крона макс — это второй после sync).
- UI: `components/AutoPayoutRow.tsx`, встроен в `DbProjectDashboard` под блоком Distribute (owner + есть контрибьюторы).

### Разовые отложенные выплаты (one-off queue) ✅
Помимо одного recurring-расписания, owner может поставить **сколько угодно** разовых выплат (сумма + дата). Модель `scheduled_payouts` (много на проект). Тот же cron `…/schedule/run` после recurring проходит по `status=PENDING && runAt ≤ now`, делает `runDistribution`, помечает DONE (+ `distributionId`, `ranAt`). Нехватка баланса → остаётся PENDING, ретрай завтра.
- API `app/api/treasury/payments/route.ts`: GET (список по проекту), POST ({amount, runAt} → ставит в очередь), DELETE (?id= → отменяет только PENDING → CANCELED). Owner-only.
- UI: `components/ScheduledPayoutsRow.tsx` — список выплат со статусами + «Schedule a payout» + Cancel, под `AutoPayoutRow` в `DbProjectDashboard`.
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
- [x] Legacy on-chain: SplitVault.sol (deploy/initialize/distribute/replaceContributors), /history, ProjectSwitcher — работают для старых 0x-проектов
- [x] Frontend на Vercel, Privy login (Google/email/wallet + embedded), Arc Testnet
- [x] Backend: Prisma + Supabase, API routes
- [x] **Полный кастодиальный pivot (no-web3 для всех ролей):**
  - [x] Treasury: пополнение картой (Stripe) и криптой, баланс
  - [x] Distribute по % (кастодиально, в БД), в т.ч. ДО подтверждения инвайтов (резерв доли)
  - [x] Кабинет участника + Claim (executor платит газ, fee из доли; фикс 18→6 знаков)
  - [x] Add Arc network / Add USDC token в кабинете
  - [x] DB-first проекты (без контракта), инвайты при создании
  - [x] Distribute прямо на странице проекта (баланс + сумма)
  - [x] `/dashboard` — хаб (контрибьютор/создатель); заголовок → /dashboard

## Следующие шаги (на обсуждение в новом чате)
1. **Сквозной live-тест на проде**: создать DB-проект → инвайты → пополнить трежери картой → distribute → участник claim → проверить приход USDC во внешнем кошельке (Add network/token).
2. **Запланированные/авто-выплаты** — executor уже есть; можно автклеймить или автраспределять по расписанию. Нужна таблица расписания.
3. Редактирование контрибьюторов/% для DB-проектов (сейчас в DbProjectDashboard только добавление инвайтов; нет изменения долей/удаления claimed).
4. Реальный курс фиат→USDC (сейчас 1:1 хардкод) + мейннет-онрамп.
5. AI Split — V3, не начато.

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
