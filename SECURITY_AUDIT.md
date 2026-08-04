# SplitPort — аудит безопасности и план починки

**Дата аудита:** 2026-08-04
**Ревизия:** `c40c34f` (main)
**Объём:** 22 API-роута, 2 смарт-контракта, конфигурация, секреты, зависимости
**Цель:** привести проект в состояние, готовое к показу команде USDC / Circle

---

## Как пользоваться документом

Каждая находка — это отдельная задача с чек-боксом, местом в коде, сценарием эксплуатации
и предлагаемым фиксом. Порядок разделов = порядок починки. Разделы 🔴 обязательны до показа,
🟠 желательны, 🟡 можно проговорить словами вместо кода.

Отмечайте `[x]` по мере починки — документ живёт в репозитории и коммитится вместе с фиксами.

---

## Сводка

| # | Находка | Серьёзность | Слой | Статус |
|---|---------|-------------|------|--------|
| 1 | Утёкший executor-ключ не ротирован | 🔴 Критично | Секреты | [ ] |
| 2 | Double-spend через гонку в claim | 🔴 Критично | Backend | [x] **Исправлено** |
| 3 | `accrue()` не резервирует средства в vault | 🔴 Критично | Контракт | [ ] |
| 4 | `distribute()` вызывается кем угодно | 🟠 Важно | Контракт | [ ] |
| 5 | Next.js 14.2.5 — critical advisory, 87 уязвимостей | 🟠 Важно | Зависимости | [ ] |
| 6 | Админ-гейт: слабый токен + режим в памяти инстанции | 🟠 Важно | Backend | [ ] |
| 7 | Нет rate limiting | 🟡 Стоит | Backend | [ ] |
| 8 | `emergencyWithdraw` забирает claimable-средства | 🟡 Документировать | Контракт | [ ] |
| 9 | Нет security-заголовков | 🟡 Стоит | Конфиг | [ ] |
| 10 | `circle-secrets/` открытым текстом на диске | 🟡 Стоит | Секреты | [ ] |

### Что уже сделано хорошо

Это стоит проговорить на показе — уровень выше типичного хакатонного проекта:

- **Авторизация выведена из проверенного токена, а не из параметров запроса.** `lib/auth.ts`
  проверяет Privy access-token, `requireWallet` дополнительно подтверждает, что кошелёк
  привязан к этому пользователю. Ни один роут не доверяет `privyId`/`wallet` из body или query.
- **Проверки владельца проекта стоят везде** — `project.owner.privyId !== ownerPrivyId → 403`
  в payments, schedule, streams, contributor, project.
- **Stripe-webhook проверяет подпись** по raw body (`constructEvent`), обработка идемпотентна
  по `stripeSessionId`.
- **Invite-токены** — 24 случайных байта из `crypto.randomBytes`, не угадываются.
- **Cron в проде fail-closed:** без `CRON_SECRET` эндпоинты возвращают 401 (`isCronAuthorized`).
- **Нет raw SQL, нет `dangerouslySetInnerHTML`, нет `eval`.** Весь доступ к БД — через Prisma.
- **Контракты:** `ReentrancyGuard` на всех движущих средства функциях, `SafeERC20`,
  pull-claim модель, `claimFor()` не даёт менять адрес получателя. 37 тестов проходят.

---

## 🔴 1. Утёкший executor-ключ не ротирован

**Где:** `contracts/.env.local` (файл удалён из истории git 2026-08-04)
**Серьёзность:** критично — прямой доступ к деньгам

### Суть

Приватный ключ деплой/executor-кошелька больше двух месяцев находился в публичном
репозитории `ogsells1/splitport`. История переписана и force-pushed, файл отдаёт 404 на
всех ветках, но:

- старый коммит `59d3b84` **до сих пор доступен по прямому SHA** через кэш GitHub;
- любой, кто клонировал репозиторий или сохранил SHA до очистки, имеет ключ навсегда.

Ключ считается **безвозвратно скомпрометированным**. Очистка истории уменьшает будущую
экспозицию, но не отменяет прошлую.

### Что сделать

- [ ] Сгенерировать новый кошелёк для деплоя контрактов
- [ ] Сгенерировать новый executor-кошелёк, обновить `EXECUTOR_PRIVATE_KEY` в Vercel
      (Production) и в локальном `frontend/.env.local`
- [ ] Обновить `NEXT_PUBLIC_TREASURY_ADDRESS` на новый адрес
- [ ] Перевести остаток USDC со старого executor-кошелька `0xf89f…7A56` на новый
- [ ] Отправить запрос в [поддержку GitHub](https://support.github.com/contact)
      (категория «sensitive data removal») на удаление кэша коммита `59d3b84`
- [ ] Проверить, что старый ключ больше нигде не используется:
      `grep -rn "0x3548aac" . --exclude-dir=node_modules`

> **Действия с деньгами выполняет владелец проекта вручную.** Перевод средств и генерация
> ключей не делаются агентом.

---

## ✅ 2. Double-spend через гонку в claim — ИСПРАВЛЕНО

> **Статус:** исправлено 2026-08-04. Реализация — [`frontend/lib/claimLock.ts`](frontend/lib/claimLock.ts),
> подключена в обоих путях claim. Регрессионный тест:
>
> ```bash
> cd frontend && npx tsx scripts/race-test.ts
> ```
>
> Тест создаёт временные фикстуры, запускает 8 параллельных claim-прогонов и удаляет
> за собой всё созданное. Результат прогона:
>
> - **контроль (старая логика):** 8 из 8 прогонов отправили бы перевод — 4000 USDC при долге 500
> - **с блокировкой:** ровно 1 победитель, 500 USDC, остальные 7 получают «Nothing to claim»
> - после release строка возвращается в `PENDING` и доступна для повторной попытки
>
> Реализация отличается от первоначального плана ниже: вместо простого статуса `PROCESSING`
> используется статус **плюс уникальный `claimLockId`**. Причина: по одному лишь статусу
> прогон не может отличить свои строки от строк, захваченных параллельным прогоном —
> `findMany({status: PROCESSING})` вернул бы чужие. Лок-идентификатор даёт точную
> принадлежность. Плюс `claimLockAt`: без него упавший процесс заморозил бы средства
> пользователя навсегда, а так лок старше `STALE_LOCK_MS` (15 мин) переиспользуется.

<details>
<summary>Исходное описание проблемы и первоначальный план фикса</summary>


**Где:**
- [`frontend/lib/settlement/custodial.ts:59-74`](frontend/lib/settlement/custodial.ts) — чтение PENDING
- [`frontend/app/api/cabinet/claim/route.ts:80-113`](frontend/app/api/cabinet/claim/route.ts) — `claimOnchain`

**Серьёзность:** критично — прямая потеря средств из treasury

### Суть

Порядок операций в обоих путях claim:

1. `prisma.payout.findMany({ where: { wallet, status: "PENDING" } })` — прочитали долг
2. `walletClient.writeContract(... transfer ...)` — отправили USDC on-chain
3. `prisma.payout.update({ status: "CLAIMED" })` — пометили выплаченным

Между шагами 1 и 3 строки в БД остаются в статусе `PENDING`. Два параллельных запроса
`POST /api/cabinet/claim` (двойной клик, две вкладки, ретрай по таймауту) прочитают
**один и тот же** набор выплат и оба дойдут до перевода.

### Сценарий эксплуатации

```
Пользователю начислено 500 USDC (одна строка Payout, PENDING).

t=0ms   Запрос A: findMany → [payout#1: 500]
t=5ms   Запрос B: findMany → [payout#1: 500]   ← та же строка, ещё PENDING
t=800ms Запрос A: transfer 500 USDC → кошелёк пользователя
t=850ms Запрос B: transfer 500 USDC → кошелёк пользователя
t=1.2s  Запрос A: payout#1 → CLAIMED
t=1.3s  Запрос B: payout#1 → CLAIMED (перезапись, никакой ошибки)

Итог: из treasury ушло 1000 USDC при долге в 500. В БД — одна выплата на 500.
```

Не требует злого умысла: воспроизводится обычным двойным кликом при медленной сети.
Злоумышленник может усилить эффект, отправив 10 параллельных запросов.

### Фикс

Атомарно «захватить» строки перед переводом — перевести их в промежуточный статус одним
условным `updateMany`, и продолжать только если захват удался.

**Шаг 1.** Добавить статус в `frontend/prisma/schema.prisma`:

```prisma
enum PayoutStatus {
  PENDING
  PROCESSING   // захвачено обработчиком claim, перевод в полёте
  CLAIMED
}
```

Миграция: `npx prisma migrate dev --name payout-processing-status`

**Шаг 2.** В `custodial.ts` и `claimOnchain` заменить «прочитать → перевести» на
«захватить → перевести»:

```ts
// Захват: только один параллельный запрос получит count > 0 для этих строк.
const claimed = await prisma.payout.updateMany({
  where: { wallet: walletLc, status: "PENDING" },
  data: { status: "PROCESSING" },
});
if (claimed.count === 0) {
  throw Object.assign(new Error("Nothing to claim"), { status: 400 });
}
const pending = await prisma.payout.findMany({
  where: { wallet: walletLc, status: "PROCESSING" },
});
// ... дальше перевод и перевод строк в CLAIMED
```

**Шаг 3.** Обработать неуспех: если `writeContract` бросил исключение, вернуть строки
в `PENDING` в `catch`-блоке, иначе деньги «зависнут» в `PROCESSING` навсегда:

```ts
catch (err) {
  await prisma.payout.updateMany({
    where: { id: { in: pending.map((p) => p.id) }, status: "PROCESSING" },
    data: { status: "PENDING" },
  });
  throw err;
}
```

**Шаг 4.** То же самое для `StreamShare`: там гонка приводит к двойному начислению
`claimedAmount`. Захват сделать через условный `update` с проверкой `claimedAmount`
(optimistic locking) либо через `SELECT … FOR UPDATE` внутри транзакции.

### Проверка

- [x] Параллельные claim-прогоны для кошелька с одной выплатой — ровно один выигрывает
      (проверено скриптом `scripts/race-test.ts`, 8 прогонов)
- [x] После release строки возвращаются в `PENDING`
- [ ] Прогнать end-to-end на testnet: два реальных клика Claim подряд, убедиться, что
      on-chain ушёл ровно один перевод

</details>

---

## 🔴 3. `accrue()` не резервирует средства в vault

**Где:** [`contracts/contracts/SplitVault.sol:340-356`](contracts/contracts/SplitVault.sol) (`accrue`),
[`:245-304`](contracts/contracts/SplitVault.sol) (`distribute` / `_distribute`)
**Серьёзность:** критично — обещанные средства могут исчезнуть

### Суть

`accrue()` увеличивает `claimable[recipient]`, но деньги остаются в общем балансе vault.
`distribute()` при этом раздаёт **весь** `usdcToken.balanceOf(address(this))` по процентам,
не зная про обязательства из `claimable`. Проверка в `accrue` (`balanceOf >= total`)
смотрит на баланс в момент вызова и ничего не резервирует на будущее.

### Сценарий

```
1. Vault имеет 100 USDC.
2. Owner вызывает accrue([Алиса], [100]) → claimable[Алиса] = 100. Проверка проходит.
3. Кто угодно вызывает distribute() (см. находку №4 — модификатора нет).
4. _distribute раздаёт все 100 USDC по процентам участникам + dust владельцу.
5. Баланс vault = 0, но claimable[Алиса] всё ещё = 100.
6. Алиса вызывает claim() → safeTransfer падает на нехватке баланса. Навсегда.
```

Итог: обязательство в учёте есть, денег нет. В кастодиальном режиме то же расхождение
возникает между БД и балансом executor-кошелька.

### Фикс

Ввести счётчик зарезервированных средств и вычитать его из распределяемого баланса.

```solidity
/// Сумма всех невыплаченных claimable-балансов. Эти средства не подлежат распределению.
uint256 public totalClaimable;

function accrue(address[] calldata _recipients, uint256[] calldata _amounts)
    external onlyOwner onlyInitialized whenNotPaused nonReentrant
{
    if (_recipients.length == 0 || _recipients.length != _amounts.length) revert LengthMismatch();

    uint256 total;
    for (uint256 i = 0; i < _amounts.length; i++) total += _amounts[i];

    // Обеспеченность считаем с учётом уже зарезервированного.
    if (usdcToken.balanceOf(address(this)) < totalClaimable + total) revert InsufficientBalance();

    for (uint256 i = 0; i < _recipients.length; i++) {
        if (_recipients[i] == address(0)) revert InvalidAddress();
        if (_amounts[i] == 0) continue;
        claimable[_recipients[i]] += _amounts[i];
        emit Accrued(_recipients[i], _amounts[i]);
    }
    totalClaimable += total;
}

function claim() external onlyInitialized whenNotPaused nonReentrant {
    uint256 amount = claimable[msg.sender];
    if (amount == 0) revert NothingToClaim();
    claimable[msg.sender] = 0;
    totalClaimable -= amount;          // ← освобождаем резерв
    totalDistributed += amount;
    usdcToken.safeTransfer(msg.sender, amount);
    emit Claimed(msg.sender, amount);
}
// то же самое в claimFor()
```

Свободный к распределению баланс — во всех трёх местах, где сейчас берётся `balanceOf`:

```solidity
function _freeBalance() internal view returns (uint256) {
    uint256 bal = usdcToken.balanceOf(address(this));
    return bal > totalClaimable ? bal - totalClaimable : 0;
}
```

- `distribute()` — `uint256 pending = _freeBalance();`
- `distributePartial()` — сравнивать `_amount > _freeBalance()`
- `payEach()` — сравнивать `_freeBalance() < total`
- `pendingBalance()` и `previewShare()` — считать от `_freeBalance()` (иначе UI покажет
  завышенный доступный остаток)

### Проверка

- [ ] Тест: accrue(100) → distribute() не трогает эти 100 → claim() успешен
- [ ] Тест: accrue на сумму больше свободного баланса → revert `InsufficientBalance`
- [ ] Тест: claim() уменьшает `totalClaimable`, следующий distribute() видит освободившееся
- [ ] `npx hardhat test` — все 37 существующих тестов по-прежнему проходят

---

## 🟠 4. `distribute()` и `distributePartial()` вызываются кем угодно

**Где:** [`contracts/contracts/SplitVault.sol:245`](contracts/contracts/SplitVault.sol),
[`:262`](contracts/contracts/SplitVault.sol)
**Серьёзность:** важно

### Суть

Комментарий в коде обещает: «Может вызывать owner или любой участник». Модификатора,
который бы это ограничивал, нет — обе функции `external` без проверки `msg.sender`.
Вызвать может **любой адрес в сети**.

Это не кража (деньги уходят по заданным процентам законным получателям), но это потеря
контроля над моментом раздачи:

- **Front-run `replaceContributors`.** Owner отправляет транзакцию со сменой долей;
  атакующий видит её в мемпуле и вызывает `distribute()` с большим приоритетом — баланс
  раздаётся по **старым** процентам.
- **Форс-раздача не вовремя** — например, до того как owner довнёс средства для fixed-выплат.

### Фикс

Определиться с политикой и закрепить её в коде. Рекомендую вариант «owner или активный
участник» — он совпадает с задокументированным намерением:

```solidity
modifier onlyOwnerOrContributor() {
    if (msg.sender != owner() && contributorIndex[msg.sender] == 0) {
        revert ContributorNotFound();
    }
    _;
}

function distribute() external onlyOwnerOrContributor onlyInitialized whenNotPaused nonReentrant { … }
function distributePartial(uint256 _amount) external onlyOwnerOrContributor onlyInitialized whenNotPaused nonReentrant { … }
```

Если по продуктовой логике раздачу должен инициировать только owner/кипер — поставить
`onlyOwner` и поправить комментарий.

- [ ] Выбрать политику, применить модификатор
- [ ] Обновить комментарии, чтобы они соответствовали коду
- [ ] Тест: посторонний адрес получает revert

---

## 🟠 5. Устаревшие зависимости

**Где:** `frontend/package.json`
**Серьёзность:** важно — критический advisory в проде

### Суть

`npm audit --omit=dev`: **87 уязвимостей (1 critical, 8 high, 66 moderate, 12 low)**.

| Пакет | Severity | Проблема | Прямая? |
|-------|----------|----------|---------|
| `next` 14.2.5 | **critical** | Cache Poisoning; DoS в image optimization | да |
| `@privy-io/react-auth` 1.x | high | — (устаревшая мажорная версия) | да |
| `axios` | high | Prototype pollution; DoS в `formDataToJSON` | транзитивная |
| `undici` | high | Недостаточная случайность; unbounded decompression | транзитивная |
| `ws` | high | Раскрытие неинициализированной памяти; DoS | транзитивная |
| `postcss` | high | XSS через unescaped `</style>`; чтение файлов | транзитивная |
| `@coinbase/wallet-sdk` | high | не раскрыто | транзитивная |
| `fast-uri`, `socket.io-parser` | high | host confusion; memory exhaustion | транзитивные |

### Что сделать

- [ ] Обновить Next.js в пределах мажорной версии (безболезненно, снимает critical):
      `npm i next@^14.2 --legacy-peer-deps`
- [ ] Пересобрать и проверить, что билд проходит: `npm run build`
- [ ] Прогнать `npm audit --omit=dev` повторно, зафиксировать остаток
- [ ] Рассмотреть миграцию `@privy-io/react-auth` на 2.x — **отдельной задачей после показа**,
      это ломающее изменение в основном потоке авторизации
- [ ] Транзитивные (`axios`, `ws`, `undici`) подтянутся с обновлением wagmi/connectors —
      проверить, не ломает ли `npm update @wagmi/connectors`

> Флаг `--legacy-peer-deps` обязателен: он зафиксирован в проекте из-за опционального
> Solana-пира в Circle SDK (коммит `f985dd5`).

---

## 🟠 6. Админ-гейт `/api/admin/settlement-mode`

**Где:** [`frontend/app/api/admin/settlement-mode/route.ts:12-15`](frontend/app/api/admin/settlement-mode/route.ts),
[`frontend/lib/settlement/index.ts:16-23`](frontend/lib/settlement/index.ts)
**Серьёзность:** важно (одна проблема безопасности + один функциональный баг)

### Суть

**Безопасность.** Гейт — статический токен в заголовке `x-admin-token`, сравнение через `===`
(не constant-time, теоретически уязвимо к timing-атаке). Роут переключает, каким кошельком
подписываются расчёты — то есть управляет движением реальных средств. Сам файл честно
помечен «Demo-only… not a production auth model», но на показе это спросят.

**Функциональный баг.** Переопределение режима хранится в переменной модуля:

```ts
let _modeOverride: "custodial" | "circle" | null = null;
```

На Vercel каждый serverless-инстанс имеет собственную копию памяти. Переключение режима
через POST попадёт **только в тот инстанс, который обработал запрос**. Следующий claim может
уйти на другой инстанс со старым режимом. На демо это выглядит как «настройка не применилась»
или, хуже, как хаотичное чередование режимов между запросами.

### Что сделать

- [ ] Заменить сравнение токена на constant-time:
      `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` (с предварительной проверкой длины)
- [ ] Перенести хранение режима из памяти в БД (таблица настроек) или в переменную окружения
      с редеплоем — иначе поведение недетерминированно
- [ ] Либо, если на показе переключение не нужно: отключить роут в проде
      (`if (process.env.NODE_ENV === "production") return 404`) и переключать режим
      через env-переменную `CUSTODY_MODE`
- [ ] Ротировать `ADMIN_TOKEN` (он лежал в том же `.env.local`, что и утёкший ключ)

---

## 🟡 7. Нет rate limiting

**Где:** все роуты `frontend/app/api/**`
**Серьёзность:** стоит сделать

Ни один эндпоинт не ограничен по частоте. Наиболее чувствительные:

- `POST /api/cabinet/claim` — каждый вызов делает RPC-запросы и потенциально on-chain перевод
  (жжёт газ executor-кошелька)
- `POST /api/treasury/distribute` — тяжёлые операции с БД и RPC
- `GET /api/invite/[token]` — публичный, без авторизации; позволяет перебирать токены
  (24 байта энтропии делают перебор бессмысленным, но логировать всплески полезно)

Аутентификация ограничивает злоупотребление одним аккаунтом, но зарегистрироваться через
Privy может кто угодно.

- [ ] Добавить лимит на `claim` и `distribute` — например, `@upstash/ratelimit` или
      простой счётчик в БД: не чаще N запросов в минуту на `privyId`
- [ ] Отдельный, более строгий лимит на публичный `GET /api/invite/[token]` по IP

---

## 🟡 8. `emergencyWithdraw` забирает и claimable-средства

**Где:** [`contracts/contracts/SplitVault.sol:447-459`](contracts/contracts/SplitVault.sol)
**Серьёзность:** документировать

`emergencyWithdraw(address _to)` переводит **весь** баланс vault на указанный адрес, включая
средства, начисленные участникам через `accrue()`. Owner может (в поставленном на паузу
контракте) забрать деньги, обещанные участникам.

Это осознанное trust-допущение текущей модели, а не баг — но именно такие вопросы задаёт
команда Circle при разборе non-custodial заявок. Лучше выйти с готовым ответом.

- [ ] Задокументировать допущение в `NONCUSTODIAL.md` и в README (раздел «Trust assumptions»)
- [ ] Опционально: исключить зарезервированное — выводить только `_freeBalance()`,
      оставляя `totalClaimable` в контракте (после фикса №3 это одна строка)
- [ ] Опционально: timelock на `emergencyWithdraw` — задержка между `pause()` и выводом

---

## 🟡 9. Нет security-заголовков

**Где:** `frontend/next.config.js`
**Серьёзность:** стоит сделать

Приложение не отдаёт `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy`,
`X-Content-Type-Options`. Для приложения, работающего с деньгами, отсутствие
`X-Frame-Options` означает возможность clickjacking-обёртки.

```js
// next.config.js
async headers() {
  return [{
    source: "/:path*",
    headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ],
  }];
}
```

- [ ] Добавить базовые заголовки
- [ ] CSP — отдельной задачей: Privy и Stripe подгружают свои скрипты и iframe,
      политику надо составлять с их доменами, иначе сломается вход

---

## 🟡 10. `circle-secrets/` открытым текстом на диске

**Где:** `circle-secrets/circle_recovery_file.dat`, `circle-secrets/entity-secret.md`
**Серьёзность:** стоит сделать

Директория корректно исключена из git (`.gitignore`, проверено `git check-ignore`), в
репозиторий не попадала. Но recovery-файл и entity secret Circle лежат незашифрованными
в рабочей папке проекта — они попадут в резервные копии, в синхронизацию облачных дисков,
в архив при передаче проекта.

- [ ] Перенести в менеджер паролей (1Password / Bitwarden) или зашифрованный контейнер
- [ ] Удалить локальные копии после переноса
- [ ] Проверить, не синхронизируется ли папка проекта в iCloud/Dropbox

---

## Порядок работ

**До показа — обязательно:**

1. Находка №1 — ротация ключей (делает владелец вручную; блокирует всё остальное по смыслу)
2. Находка №2 — гонка в claim (код + миграция БД + тест на параллельные запросы)
3. Находка №3 — резервирование `claimable` в контракте (код + тесты + редеплой vault)
4. Находка №4 — модификатор на `distribute` (входит в тот же редеплой, что и №3)
5. Находка №5 — обновление Next.js

**После показа:**

6. Находки №6, №7 — админ-гейт и rate limiting
7. Находки №8, №9, №10 — документация trust-допущений, заголовки, хранение секретов
8. Миграция `@privy-io/react-auth` на 2.x

> Находки №3 и №4 требуют **редеплоя контрактов** и обновления `VAULT_FACTORY_ADDRESS`.
> Планируйте их одним заходом и заранее — существующие vault'ы останутся на старом коде.

---

## Область, не покрытая аудитом

Чтобы не создавать ложного чувства полноты:

- **Не проводился penetration testing** — только чтение кода и статический анализ
- **Не проверялись** интеграции Circle SDK (Bridge Kit, Unified Balance) на предмет
  корректности обработки ошибок при частичных переводах между сетями
- **Не анализировалась** экономика fee-расчёта в `settleClaim` (комиссия оценивается через
  `estimateContractGas` с множителем 1.2 и делением на 10^12 — стоит проверить отдельно на
  корректность единиц измерения)
- **Не проверялась** логика `claimableNow` для стримов на граничные условия (отмена стрима
  в момент начисления, перекрытие окон)
- **Контракты не проходили внешний аудит** — 37 юнит-тестов не заменяют его
