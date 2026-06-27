# BYN Split Pay — Project Context

## Что строим
Платформа автоматического распределения доходов между участниками
музыкального проекта через USDC и smart contracts на Arc blockchain.

## Стек
- Frontend: Next.js 14 + TypeScript + TailwindCSS
- Backend: Next.js API routes + Prisma 7.8.0 + PostgreSQL (Supabase) — в процессе
- Blockchain: Arc Testnet (Chain ID: 5042002, RPC: https://rpc.testnet.arc.network)
- Contracts: Solidity + Hardhat + OpenZeppelin
- Auth: Privy (Google login + embedded wallets)
- Deploy: Vercel (frontend) ✅

## Arc Testnet
- RPC: https://rpc.testnet.arc.network
- Chain ID: 5042002
- Gas token: USDC (не ETH)
- Explorer: https://testnet.arcscan.app
- Faucet: https://faucet.circle.com

## GitHub
https://github.com/ogsells1/byn-split-pay

## Структура репозитория
byn-split-pay/
├── contracts/          # Solidity + Hardhat ✅
│   ├── contracts/
│   │   ├── SplitVault.sol
│   │   └── MockERC20.sol
│   ├── scripts/
│   │   ├── deploy.ts
│   │   ├── initialize.ts
│   │   ├── deposit.ts
│   │   ├── distribute.ts
│   │   ├── check.ts
│   │   ├── debug.ts
│   │   └── replace_contributors.ts
│   ├── hardhat.config.ts
│   └── .env
└── frontend/           # Next.js ✅ задеплоен на Vercel
    ├── app/
    │   ├── layout.tsx
    │   ├── providers.tsx
    │   ├── page.tsx
    │   ├── globals.css
    │   ├── dashboard/
    │   │   └── page.tsx   ✅ с кнопкой View Transaction History
    │   ├── history/
    │   │   └── page.tsx   ✅ страница истории транзакций
    │   └── api/           ← создано, но НЕ работает — blocker с Prisma
    │       ├── project/
    │       │   └── route.ts
    │       └── transactions/
    │           ├── route.ts
    │           └── sync/
    │               └── route.ts
    ├── components/
    │   ├── VaultInfo.tsx
    │   ├── DepositModal.tsx
    │   └── DistributeButton.tsx
    ├── lib/
    │   ├── contract.ts
    │   ├── wagmi.ts
    │   ├── events.ts      ✅ хук useVaultEvents с chunked getLogs
    │   └── prisma.ts      ← создан, использует PrismaPg adapter
    ├── prisma/
    │   └── schema.prisma  ← создан (без url/directUrl — Prisma 7 требует)
    ├── prisma.config.ts   ← создан, но НЕ работает — blocker
    ├── tsconfig.json
    ├── .env.local         ← DATABASE_URL и DIRECT_URL заполнены (Supabase)
    └── package.json

## Core Flow
Create Project → Add Contributors → Set Percentages →
Deploy Split Contract → Deposit Revenue → Automatic Distribution

## Задеплоенные контракты (Arc Testnet)

### Актуальный контракт
- SplitVault: `0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774`
- USDC: `0x3600000000000000000000000000000000000000`
- Owner / Deployer: `0xc35D19Ba49177710265f90aAE2ACcEd3bEbB8645`
- Deploy block: `42802682`
- Initialized: ✅
- Explorer: https://testnet.arcscan.app/address/0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774

### Старый контракт (не использовать — owner недоступен)
- SplitVault: `0x690b71Fe67235a94bad81A4D204e79e09D63d550`

## Smart Contract — SplitVault.sol
Основные функции:
- initialize(): создаёт split configuration (onlyOwner, один раз)
- depositRevenue(): принимает USDC (требует approve)
- distribute(): автоматически распределяет funds по basis points
- replaceContributors(): атомарная замена участников (onlyOwner)
- getProjectInfo(): возвращает contributors, balances, total payouts
- emergencyWithdraw(): вывод средств когда paused (onlyOwner)

Security: ReentrancyGuard, Ownable, Pausable, SafeERC20

## Текущие участники
| Адрес | Роль | % |
|---|---|---|
| 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf | label | 50% |
| 0xc35D19Ba49177710265f90aAE2ACcEd3bEbB8645 | artist | 30% |
| 0x80bdCE0557714834fF509C055C062f55C14E8626 | producer | 20% |

## Frontend (✅ задеплоен)

### URLs
- Production: https://byn-split-pay.vercel.app
- Vercel project: https://vercel.com/ofi-s-projects/byn-split-pay

### Privy
- App ID: `cmpcetqik00790dla40826rds`
- .env.local: `NEXT_PUBLIC_PRIVY_APP_ID=cmpcetqik00790dla40826rds`
- Google логин включён ✅
- Embedded wallets включены ✅
- Allowed domain: `byn-split-pay.vercel.app` ✅

### Vercel env переменные
- `NEXT_PUBLIC_PRIVY_APP_ID=cmpcetqik00790dla40826rds` ✅

### Ключевые компоненты
- `providers.tsx` — Privy + WagmiProvider + QueryClientProvider
- `VaultInfo.tsx` — читает getProjectInfo() + getContributors() из chain
- `DepositModal.tsx` — approve USDC → depositRevenue()
- `DistributeButton.tsx` — вызывает distribute(), активна только если pending > 0
- `lib/wagmi.ts` — Arc Testnet defineChain (id: 5042002)
- `lib/contract.ts` — VAULT_ABI, USDC_ABI, адреса контрактов
- `lib/events.ts` — useVaultEvents хук, chunked getLogs по 9000 блоков от DEPLOY_BLOCK
- `app/history/page.tsx` — страница истории транзакций

### Важно для билда
- `frontend/tsconfig.json` должен содержать `"target": "ES2020"` — иначе BigInt literals не компилируются

## Проверенный flow (всё работает ✅)
1. deploy.ts → деплой SplitVault
2. initialize.ts → задать участников и USDC адрес
3. replace_contributors.ts → замена участников
4. deposit.ts → approve + depositRevenue(amount)
5. distribute.ts → USDC разлетается по участникам
6. check.ts → просмотр состояния vault
7. Frontend → дашборд показывает реальные данные из chain ✅
8. /history → история транзакций из chain (getLogs) ✅
9. Vercel деплой → сайт публично доступен ✅

## ⚠️ ТЕКУЩИЙ BLOCKER — Prisma 7.8.0 + prisma db push

### Проблема
Prisma 7.8.0 полностью изменил конфигурацию:
- `url` и `directUrl` в `schema.prisma` больше НЕ поддерживаются
- Теперь нужен `prisma.config.ts` с `defineConfig()`
- `prisma db push` требует `datasource.url` в `prisma.config.ts`
- Все попытки задать `db.url()` в `prisma.config.ts` дают ту же ошибку:
  `Error: The datasource.url property is required in your Prisma config file when using prisma db push`

### Что уже сделано
1. `prisma/schema.prisma` — без `url`/`directUrl`, только `provider = "postgresql"`
2. `prisma.config.ts` — с `defineConfig({ earlyAccess: true, migrate: { adapter() {...} }, db: { url() {...} } })`
3. Установлены: `@prisma/adapter-pg`, `pg`, `@types/pg`
4. `.env.local` заполнен: `DATABASE_URL` (порт 6543, pgbouncer) и `DIRECT_URL` (порт 5432)
5. `lib/prisma.ts` — использует `PrismaPg` adapter

### Текущий `prisma.config.ts` (не работает)
```typescript
import path from "path";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

export default defineConfig({
  earlyAccess: true,
  schema: path.join("prisma", "schema.prisma"),
  migrate: {
    async adapter() {
      const pool = new pg.Pool({
        connectionString: process.env.DIRECT_URL,
      });
      return new PrismaPg(pool);
    },
  },
  db: {
    async url() {
      return process.env.DIRECT_URL ?? "";
    },
  },
});
```

### Текущий `prisma/schema.prisma`
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}
```

### Что нужно выяснить в Claude Code
1. Запустить диагностику:
```bash
cat node_modules/prisma/package.json | grep '"version"' | head -1
cat node_modules/prisma/config.d.ts 2>/dev/null | head -80
ls node_modules/@prisma/adapter-pg/
```
2. Найти правильный синтаксис `prisma.config.ts` для `prisma db push` в версии 7.8.0
3. Либо — рассмотреть даунгрейд до Prisma 5.x где `url` в schema.prisma ещё работает

### Альтернативное решение (если Prisma 7 не поддаётся)
Даунгрейд до Prisma 5.22 (стабильная, LTS):
```bash
npm install prisma@5.22 @prisma/client@5.22
# убрать prisma.config.ts
# вернуть url = env("DATABASE_URL") и directUrl = env("DIRECT_URL") в schema.prisma
npx prisma db push
```

## Database Schema (реализована, но НЕ применена к БД)
- `users` — id, privyId, email, wallet, createdAt
- `projects` — id, name, contractAddress, usdcAddress, chainId, deployBlock, ownerId
- `contributors` — id, projectId, wallet, percentage, role, active, totalPaid
- `transactions` — id, projectId, type (DEPOSIT/PAYMENT/DISTRIBUTION), amount, txHash, blockNumber, timestamp

## API Routes (созданы, НЕ протестированы — ждут БД)
- `GET /api/project` — проект + участники
- `POST /api/project` — создать/обновить проект
- `GET /api/transactions` — список транзакций (с фильтром по type, пагинация)
- `POST /api/transactions/sync` — читает события из chain (viem getLogs) → сохраняет в БД

## contracts/.env
```
PRIVATE_KEY=<ключ от 0xc35D...>
USDC_ADDRESS=0x3600000000000000000000000000000000000000
PROJECT_NAME=BYN Demo Project
CONTRACT_ADDRESS=0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774
```

## Текущий прогресс
- [x] GitHub репозиторий создан
- [x] SplitVault.sol написан и задеплоен на Arc Testnet
- [x] Vault инициализирован (3 участника)
- [x] depositRevenue() протестирован
- [x] distribute() протестирован — USDC распределился корректно
- [x] replaceContributors() — 0xDead заменён на реального продюсера
- [x] Frontend создан (Next.js 14)
- [x] Privy подключён (Google логин работает)
- [x] Дашборд читает данные из контракта on-chain
- [x] DepositModal — approve + deposit работает
- [x] DistributeButton — вызов distribute() работает
- [x] Frontend задеплоен на Vercel ✅
- [x] Google логин работает на проде ✅
- [x] История транзакций /history — getLogs с chunked запросами ✅
- [x] Prisma schema создана (Users, Projects, Contributors, Transactions)
- [x] API routes созданы (project, transactions, transactions/sync)
- [x] lib/prisma.ts создан с PrismaPg adapter
- [ ] ⚠️ prisma db push — BLOCKER (Prisma 7.8.0 конфиг)
- [ ] Заполнить БД через POST /api/project
- [ ] Протестировать POST /api/transactions/sync
- [ ] Добавить env в Vercel + задеплоить backend
- [ ] Мобильная адаптация

## Следующие шаги (после решения blocker)
1. Решить Prisma 7.8.0 blocker (или даунгрейд до 5.x)
2. `npx prisma db push` → применить схему к Supabase
3. `POST /api/project` → заполнить проект в БД
4. `POST /api/transactions/sync` → синхронизировать историю из chain
5. Добавить `DATABASE_URL` и `DIRECT_URL` в Vercel env
6. `vercel --prod` → задеплоить с backend
7. Мобильная адаптация дашборда и /history

## Важные решения
1. Gas token на Arc = USDC (не ETH) — учитывать везде
2. Для лейбла (deposit) = Circle Dev-Controlled Wallets
3. Для участников = Privy embedded wallets
4. Dust (остаток от деления basis points) → owner
5. replaceContributors() — атомарная замена, сначала вызвать distribute()
6. Frontend читает данные прямо из chain (без backend на MVP)
7. events.ts: DEPLOY_BLOCK = 42802682n, CHUNK_SIZE = 9000n
8. Backend использует Next.js API routes (не отдельный сервер) — деплоится на Vercel
9. Unified Balance — фича V2, не MVP
10. AI Split — фича V3, не MVP
