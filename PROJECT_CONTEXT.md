# BYN Split Pay — Project Context

## Что строим
Платформа автоматического распределения доходов между участниками
музыкального проекта через USDC и smart contracts на Arc blockchain.

## Стек
- Frontend: Next.js 14 + TypeScript + TailwindCSS
- Backend: Node.js + Prisma + PostgreSQL (Supabase) — не начат
- Blockchain: Arc Testnet (Chain ID: 5042002, RPC: https://rpc.testnet.arc.network)
- Contracts: Solidity + Hardhat + OpenZeppelin
- Auth: Privy (Google login + embedded wallets)
- Deploy: Vercel (frontend) + GitHub

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
│   │   └── debug.ts
│   ├── hardhat.config.ts
│   └── .env
├── frontend/           # Next.js ✅ работает локально
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── providers.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   └── dashboard/
│   │       └── page.tsx
│   ├── components/
│   │   ├── VaultInfo.tsx
│   │   ├── DepositModal.tsx
│   │   └── DistributeButton.tsx
│   ├── lib/
│   │   ├── contract.ts
│   │   └── wagmi.ts
│   ├── .env.local
│   └── package.json
└── backend/            # не начат

## Core Flow
Create Project → Add Contributors → Set Percentages →
Deploy Split Contract → Deposit Revenue → Automatic Distribution

## Задеплоенные контракты (Arc Testnet)

### Актуальный контракт
- SplitVault: `0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774`
- USDC: `0x3600000000000000000000000000000000000000`
- Owner / Deployer: `0xc35D19Ba49177710265f90aAE2ACcEd3bEbB8645`
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
| Адрес | Роль | % | Total Paid |
|---|---|---|---|
| 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf | label | 50% | 5.00 USDC |
| 0xc35D19Ba49177710265f90aAE2ACcEd3bEbB8645 | artist | 30% | 3.00 USDC |
| 0x000000000000000000000000000000000000dEaD | producer | 20% | 2.00 USDC |

⚠️ 0xDead — заглушка, заменить через replaceContributors()

## Frontend (✅ работает на localhost:3000)

### Privy
- App ID: `cmpcetqik00790dla40826rds`
- .env.local: `NEXT_PUBLIC_PRIVY_APP_ID=cmpcetqik00790dla40826rds`
- Google логин включён ✅
- Embedded wallets включены ✅

### Ключевые компоненты
- `providers.tsx` — Privy + WagmiProvider + QueryClientProvider
- `VaultInfo.tsx` — читает getProjectInfo() + getContributors() из chain
- `DepositModal.tsx` — approve USDC → depositRevenue()
- `DistributeButton.tsx` — вызывает distribute(), активна только если pending > 0
- `lib/wagmi.ts` — Arc Testnet defineChain (id: 5042002)
- `lib/contract.ts` — VAULT_ABI, USDC_ABI, адреса контрактов

### Запуск
```bash
cd byn-split-pay/frontend
npm install
npm run dev
# → http://localhost:3000
```

## Проверенный flow (всё работает ✅)
1. deploy.ts → деплой SplitVault
2. initialize.ts → задать участников и USDC адрес
3. deposit.ts → approve + depositRevenue(amount)
4. distribute.ts → USDC разлетается по участникам
5. check.ts → просмотр состояния vault
6. Frontend → дашборд показывает реальные данные из chain

## Database Schema (не реализована)
- Users: id, email, wallet, createdAt
- Projects: id, ownerId, name, contractAddress, createdAt
- Contributors: id, projectId, wallet, percentage, role
- Transactions: id, projectId, amount, txHash, createdAt

## API Routes (не реализованы)
- POST /project/create
- POST /project/deposit
- GET /project/:id
- GET /transactions

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
- [x] Frontend создан (Next.js 14)
- [x] Privy подключён (Google логин работает)
- [x] Дашборд читает данные из контракта on-chain
- [x] DepositModal — approve + deposit работает
- [x] DistributeButton — вызов distribute() работает
- [ ] Заменить 0xDead на реальный кошелёк продюсера
- [ ] Задеплоить frontend на Vercel
- [ ] Backend: Node.js API + Prisma + Supabase
- [ ] История транзакций
- [ ] Мобильная адаптация

## Важные решения
1. Gas token на Arc = USDC (не ETH) — учитывать везде
2. Для лейбла (deposit) = Circle Dev-Controlled Wallets
3. Для участников = Privy embedded wallets
4. Dust (остаток от деления basis points) → owner
5. replaceContributors() — атомарная замена, сначала вызвать distribute()
6. Frontend читает данные прямо из chain (без backend на MVP)
7. Unified Balance — фича V2, не MVP
8. AI Split — фича V3, не MVP
