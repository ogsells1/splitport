# План подготовки SplitPort к презентации команде Arc

Контекст: SplitPort (бывш. BYN Split Pay) — кастодиальная платформа split-выплат в USDC на Arc Testnet.
Прод: https://splitport.vercel.app (Vercel-проект `splitport`, репо ogsells1/byn-split-pay).
Полное описание архитектуры — в PROJECT_CONTEXT.md, план non-custodial миграции — в NONCUSTODIAL.md.
Цель: за 1–2 дня довести проект до состояния, в котором его не стыдно показать BD/tech-команде Arc (Circle).

## П1. Сквозной live-тест на проде (блокер, делать первым)

Прогнать целиком реальный флоу на https://splitport.vercel.app:
1. Логин через Privy (Google) → `/create`: создать DB-проект (PERCENTAGE, 2 контрибьютора: один по кошельку, один по инвайт-ссылке).
2. `/treasury`: пополнить картой через Stripe (тестовая карта 4242…) и/или криптой по txHash. Убедиться, что баланс отобразился.
3. Distribute с дашборда проекта: сумма делится по %, payouts создаются, в т.ч. зарезервированный для pending-инвайта.
4. Открыть инвайт-ссылку под вторым аккаунтом → привязка кошелька → зарезервированный payout стал claimable.
5. `/cabinet`: Claim → executor шлёт USDC on-chain, комиссия вычтена, tx виден в https://testnet.arcscan.app.
6. «Add Arc network / Add USDC token» → USDC виден во внешнем кошельке (MetaMask).

Все найденные баги фиксить сразу; итог теста задокументировать (шаги, tx-хэши) в этом файле, секцией «Результаты прогона».

## П2. Executor и балансы (пререквизит П1)

- Проверить баланс executor-кошелька `0xf89f…7A56` (адрес целиком — в `EXECUTOR_PRIVATE_KEY`-паре, см. memory/Vercel env): нужен запас USDC и на выплаты, и на газ (газ на Arc — тоже USDC).
- Пополнить с фаусета https://faucet.circle.com при необходимости.
- Проверить, что env в Vercel Production живы: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_TREASURY_ADDRESS`, `EXECUTOR_PRIVATE_KEY`, `NEXT_PUBLIC_PRIVY_APP_ID`, `DATABASE_URL`.
- Проверить, что Stripe webhook указывает на актуальный прод-домен (если он был привязан к старому URL byn-split-pay.vercel.app — обновить на splitport.vercel.app).

## П3. Демо-данные

- Создать «витринный» проект с реалистичными данными (имя типа "Nomad Design Studio", 3–4 контрибьютора с разными ролями и долями), историей: 1–2 прошедших distribution, активный стрим, запланированная выплата.
- Убедиться, что дашборд этого проекта выглядит наполненным (не пустые списки) — его будем показывать на демо.

## П4. Ребрендинг хвостов

- Переименовать GitHub-репо `ogsells1/byn-split-pay` → `splitport` (gh repo rename; git remote обновится редиректом, но обновить origin явно).
- Пройтись по репо: `README.md` (сейчас одна строчка "BYN Split Pay" — написать нормальный README: что это, стек, как запустить, ссылка на прод), `PROJECT_CONTEXT.md` (заголовок и упоминания имени), `contracts/` скрипты, `package.json` name.
- Проверить, что в UI не осталось "BYN"/"Split Pay" (grep по репо).
- В Privy Dashboard (руками, отметить как TODO для владельца): сменить App name на SplitPort — он показывается в логин-модале как alt логотипа.

## П5. Позиция по кастодиальности (для разговора с Arc)

Подготовить 1-страничный документ `ARC_PITCH.md`:
- Что мы показываем Arc: gas abstraction (executor платит газ в USDC, fee 18→6 знаков), embedded wallets (Privy), карта→USDC onramp (Stripe, testnet 1:1), 4 режима выплат (instant %, fixed, scheduled, streaming).
- Честная архитектурная позиция: сегодня учёт распределений в БД, on-chain — финальный settlement при claim; SplitVault.sol (19 тестов) — задел под on-chain custody; roadmap по NONCUSTODIAL.md.
- Метрики, если есть (кол-во тестовых tx, время от инвайта до денег).
- Ask: что хотим от Arc (mainnet-доступ, грант/экосистемная программа, интро к Circle onramp).

## П6. Мелкий polish перед показом (по остатку времени)

- Лендинг: заполнить футер реальными ссылками (GitHub, Terms-заглушка), заменить «Start paying — it's free» на честное «Start paying» (fee вычитается при claim).
- Убедиться, что `splitport.vercel.app` остаётся публично доступным (не под Vercel SSO protection), а старый `byn-split-pay.vercel.app` либо восстановить как алиас, либо оставить мёртвым — но тогда проверить, что нигде в коде/вебхуках/Privy allowed origins он не используется.
- Прогнать `npx tsc --noEmit` и `cd contracts && npx hardhat test` — всё зелёное перед показом.

## Критерий готовности

Сценарий демо от логина до USDC в MetaMask проходит на проде без единого сбоя дважды подряд; репо и все витрины называются SplitPort; ARC_PITCH.md готов.
