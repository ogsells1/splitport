# SplitPort — демо и коммуникация с Arc

Материалы для показа команде Arc (Circle): приветственное сообщение в Discord и
скрипт живого демо. Прод: https://splitport.vercel.app

## 1. Приветственное сообщение (Arc builder Discord, общий чат)

> 👋 Hi Arc team! I'm building **SplitPort** — a split-payout platform for global
> teams, settling in USDC on Arc Testnet.
>
> Teams fund a shared treasury (card via Stripe or on-chain USDC), set each person's
> share, and pay everyone — by percentage, fixed salary, schedule, or a live stream.
> Recipients just sign in with Google (embedded wallets via Privy) and never touch
> gas — the executor pays it in USDC. On-chain settlement happens at claim.
>
> Live demo: https://splitport.vercel.app · sample claim tx on Arc:
> https://testnet.arcscan.app/tx/0x1f74cee2bda1b546d6a5edb61cd5915e84e148f0b0b583facb1772049b24cc26
>
> Would love feedback and a chat about mainnet access / the ecosystem program. 🙌

_(Подстрой тон под чат; ссылки оставить.)_

## 2. Скрипт живого демо (~3 минуты)

Держи заранее открытыми: витринный проект «Nomad Design Studio» + второй Google-аккаунт
в инкогнито. Браузер лучше на английском (уберёт русские плейсхолдеры дат).

1. **Проблема (15 сек).** «Глобальная команда, платить всем в USDC, у получателей нет
   крипты и газа — обычно это боль».
2. **Витрина (40 сек).** Открыть Nomad Design Studio: 4 контрибьютора с именами и
   ролями, доли, история распределений (total paid out), **живой стрим** — показать,
   как accrued растёт ежесекундно, — и pending-инвайт с зарезервированной долей.
3. **Живой флоу (90 сек).** Небольшая раздача (~2 USDC) → второй участник заходит
   **через Google** (акцент: без крипты, кошелёк создаётся сам) → в `/cabinet` видит
   свою долю → **Claim** → USDC уходит on-chain → кликнуть **«View on explorer»** и
   показать транзакцию на testnet.arcscan.app.
4. **Что показываем Arc (30 сек).** Gas abstraction (executor платит газ в USDC),
   embedded wallets (Privy), card→USDC onramp (Stripe), on-chain settlement,
   `SplitVault.sol` (19 тестов) как задел под non-custodial custody.
5. **Ask.** Mainnet-доступ, грант/экосистемная программа, интро к Circle onramp.

## 3. Заготовки ответов на вопросы

- **«Кастодиально?»** Честно: сегодня учёт распределений в БД, on-chain — финальный
  settlement при claim. `SplitVault.sol` — задел под on-chain custody, roadmap в
  NONCUSTODIAL.md.
- **«Бонус одному человеку?»** На подходе; FIXED-режим уже умеет выбирать конкретных
  контрибьюторов, персональные выплаты в % — в roadmap.
- **«Комиссии?»** Газ на Arc платится в USDC executor'ом и вычитается при claim;
  получатель платит только сетевую комиссию из своей доли, ничего вперёд.

## 4. Технические оговорки на день демо

- Executor `0xf89f…7A56` пополнен (фаусет Circle, лимит 20 USDC/2ч).
- Живой claim — только на маленьких суммах (~2-5 USDC), иначе partial-claim.
- Демо-числа на витрине могут быть крупными (это только визуал — распределение не
  тратит USDC executor'а, тратит только claim).
