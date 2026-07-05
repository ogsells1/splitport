# SplitPort — план реализации под Stablecoin Commerce Stack Challenge (Circle × Arc)

Документ для нового чата. Самодостаточный: контекст + цель + конкретные задачи с указанием файлов.

## Контекст проекта

**SplitPort** — платформа split-выплат для распределённых команд, расчёты в **USDC на Arc Testnet**.
- Прод: https://splitport.vercel.app · Репо: https://github.com/ogsells1/splitport (монорепо: `frontend/` Next.js App Router + `contracts/` Hardhat/Solidity).
- Флоу: пополнить общую казну (карта Stripe или on-chain USDC) → задать доли контрибьюторов → распределить (percentage / fixed / scheduled / streaming) → контрибьютор клеймит долю в кабинете → executor шлёт USDC on-chain, комиссия (газ в USDC) вычитается при claim.
- Учёт распределений — в Postgres (Supabase), on-chain — финальный settlement при claim. `contracts/SplitVault.sol` (19 тестов) — задел под on-chain custody. См. `PROJECT_CONTEXT.md`, `NONCUSTODIAL.md`.

**Текущий стек и где он в коде:**
- Кошельки получателей: **Privy** (embedded). Клиент — `frontend/app/providers.tsx` + `usePrivy/useWallets` в 11 файлах `app/`,`components/`. Сервер-верификация — только `frontend/lib/auth.ts` (`requireUser`, `requireWallet` через `@privy-io/server-auth`).
- Onramp: **Stripe** (карта→USDC, testnet 1:1). За абстракцией `frontend/lib/onramp/` (`OnrampProvider`, режимы `simulated`/`wallet-delivery`, `types.ts`, `index.ts`, `simulated.ts`, `walletDelivery.ts`, `DESIGN.md`).
- Executor (платит газ+выплаты): один viem-кошелёк из `EXECUTOR_PRIVATE_KEY` — `frontend/lib/executor.ts`. Settlement за абстракцией `frontend/lib/settlement/` (`custodial.ts`, `vault.ts`, `index.ts` — режим `CUSTODY_MODE=custodial|onchain`).
- USDC: `frontend/lib/contract.ts` (адрес, ABI). Сеть Arc: `frontend/lib/wagmi.ts`, `lib/executor.ts`.

## Цель

Подать в **Трек 1 (Best Cross-Border Payments & Remittances, UAE→Global)** — пример трека дословно «global payroll / freelancer payouts with stablecoin settlement and receipts» = SplitPort. Приз 1st 5000 / 2nd 3000 USDC. Участие открыто всем, только testnet, максимум **1 сабмишен**.

**Судят по «effective use of Circle Developer tools».** Сейчас из Circle-стека используется только **USDC**. Кошельки — Privy, onramp — Stripe. Задача плана: **углубить интеграцию Circle** (главное — Circle Wallets) и закрыть артефакты сабмишена.

## Рабочие потоки (по приоритету)

### WS-1. Circle Wallets вместо/рядом с Privy — САМЫЙ ВАЖНЫЙ для баллов
Два варианта, выбрать по времени:

- **1A (минимальный, локализованный, рекомендую как база):** заменить **executor/treasury** viem-кошелёк на Circle **Developer-Controlled Wallet** (Circle Programmable Wallets API). Подписание выплат и газа идёт через Circle Wallets.
  - Точки: `frontend/lib/executor.ts` (замена подписи transfer), `frontend/lib/settlement/custodial.ts` (`settleClaim` — вызов транзакции), env вместо `EXECUTOR_PRIVATE_KEY`.
  - Плюс: даёт легитимное «Wallets» в чек-боксе сабмишена без переписывания клиента.
- **1B (сильный, больше работы):** дать получателям **Circle User-Controlled Wallets** вместо Privy embedded.
  - Точки: `frontend/app/providers.tsx`, все `usePrivy/useWallets` (11 файлов), серверная верификация в `frontend/lib/auth.ts`. Продумать логин (Circle требует свой auth-флоу / social login).
  - Плюс: точнее попадает в «Circle Wallets — embedded wallet UX for non-crypto users».
  - Риск: логин/сессии — самая вшитая часть; закладывать буфер.

**Решение для нового чата:** начать с **1A** (быстрый выигрыш), 1B — если останется время; иначе описать 1B на уровне архитектуры (правила допускают conceptual-интеграцию).

### WS-2. Circle Gateway для оркестрации казны/выплат
- Использовать Circle **Gateway** для routing/treasury movement при distribute/claim (мульти-получатели).
- Точки: `frontend/lib/settlement/` (новый провайдер `gateway.ts` рядом с `custodial.ts`), возможно `frontend/app/api/treasury/*`.
- Даёт «Gateway» в чек-боксе. Оценить объём — может быть частично концептуально.

### WS-3. CCTP / Bridge Kit — усиление «cross-border»
- Опция «получить выплату на другой чейн» через CCTP (Arc→другой USDC-чейн). Прямо усиливает нарратив Трека 1 (UAE→Global).
- Точки: новый шаг в кабинете `frontend/app/cabinet/page.tsx` (выбор чейна назначения) + серверный вызов CCTP.
- Можно как отдельная демонстрируемая фича или концепт-диаграмма.

### WS-4. Onramp через Circle (вместо/рядом со Stripe)
- Заменить/дополнить Stripe карту→USDC на Circle-onramp, если доступно на testnet. Абстракция `OnrampProvider` уже есть — добавить провайдера.
- Точки: `frontend/lib/onramp/` (новый провайдер), `frontend/app/api/treasury/checkout` + `webhook`.
- Ниже приоритет: «Pay-in AED, settle in USDC» из трека можно оставить концептом.

### WS-5. (опц.) Nanopayments для стриминга
- Стрим-выплаты (per-second) переложить на Circle **Nanopayments** — усилит и стриминг, и релевантность.
- Точки: `frontend/lib/stream.ts`, `components/StreamRow.tsx`, `app/api/treasury/streams`.
- Только если время есть; иначе оставить текущую custodial-реализацию.

## Артефакты сабмишена (обязательны, вести параллельно)

- [ ] **Circle Developer Account** — регистрация на https://console.circle.com/signup (email нужен в заявке).
- [ ] Запросить **gated-тулы** только если реально используешь USYC/StableFX (для Трека 1 не обязательно).
- [ ] **Architecture diagram** — потоки: onramp → treasury → distribute → claim → on-chain settlement на Arc, с явными Circle-компонентами (USDC/Wallets/Gateway/CCTP).
- [ ] **Video demo + presentation** — уже есть скрипт в `ARC_DEMO_SCRIPT.md`; переписать под Circle-интеграции.
- [ ] **GitHub repo + integration-доки** — раздел в `README.md`: как настроить, как именно интегрированы Circle-тулы.
- [ ] **Demo URL** — https://splitport.vercel.app (готов).
- [ ] Раздел **«Circle Product Feedback»** (в README или отдельным файлом): почему выбраны продукты, что зашло, что улучшить, рекомендации по DX.
- [ ] Отметить в форме реально использованные Circle-продукты (USDC + что добавим).

## Что уже готово (не переделывать)
- Живой прод на Arc Testnet, сквозной флоу login→treasury→distribute→claim, on-chain settlement.
- Пример tx claim: https://testnet.arcscan.app/tx/0x1f74cee2bda1b546d6a5edb61cd5915e84e148f0b0b583facb1772049b24cc26
- Ребренд SplitPort, единая навигация, имена/роли контрибьюторов, en-US даты, partial-claim UX, ссылки на explorer. Инфраструктура (Vercel env, Stripe webhook, Privy, домен) настроена.

## Первый шаг для нового чата
1. Уточнить **дедлайны** на Ignyte Overview (определяет объём: 1A vs 1A+1B).
2. Прочитать Circle Programmable Wallets docs, оценить **WS-1A** по коду (`lib/executor.ts`, `lib/settlement/custodial.ts`) и составить пошаговую имплементацию замены executor-подписи на Circle Developer-Controlled Wallet.
3. Параллельно завести Circle Developer Account и начать architecture diagram.

## Открытые решения (ответить в новом чате)
- Circle Wallets: только executor (1A) или ещё и получатели (1B)?
- Оставляем Stripe как onramp или добавляем Circle-onramp (WS-4)?
- CCTP: живая фича или концепт-диаграмма?
- Приоритет треков подтверждён: только Трек 1, 1 сабмишен.
