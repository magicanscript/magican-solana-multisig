# PRD: Multi-Sig Wallet на Solana (`magican-solana-multisig`)

> Product Requirements Document + пошаговый план реализации.
> Автор портфеля: @magicanscript. Черновик от 2026-07-07, приведён к состоянию **as built** 2026-07-15.
>
> **Статус:** Фазы 0–5 (on-chain ядро + Codama-клиент + скрипты) — готовы, 21 LiteSVM-тест зелёный.
> Фазы 6–7 (фронтенд, devnet-деплой, README, CI) — в работе. Разделы ниже описывают то, что
> **реально построено**; там, где раздел — план, это указано явно.

---

## 1. Концепция

**Что это.** Смарт-контракт (Anchor-программа) на Solana, реализующий кошелёк с мультиподписью:
любая транзакция исполняется только после того, как её одобрили **M из N** владельцев (например, 2 из 3).
Мультисиг — это **два PDA**: аккаунт данных `Multisig` (правила: владельцы, порог, счётчики) и
отдельная **treasury-PDA** `multisig_signer`, которая держит средства и от чьего имени программа
подписывает произвольные вложенные инструкции через `invoke_signed`. Подробнее о разделении — §3.

**Какую проблему решает.** Единоличный приватный ключ — единая точка отказа: украли ключ → потеряли всё.
Мультисиг распределяет контроль: казна DAO, командный кошелёк, аварийный доступ, разделение полномочий.
Это фундаментальный примитив авторизации в Web3.

**Почему это ценно для портфеля.**
- Логически продолжает `magican-oracle-escrow`: обе программы про **условную авторизацию нескольких сторон**.
- Идеальный носитель, чтобы показать **security-мышление** — а именно этого ждут от Solana-подрядчика.
- Компактный, самодостаточный скоуп: реально довести до продакшн-качества, а не бросить на полпути.

**Чем отличаемся от «клона туториала».** Референс — [SPL Multisig](https://github.com/solana-labs/solana-program-library/tree/master/multisig) —
это примитив на уровне токен-программы (только для подписи токен-операций). Мы делаем **программируемый
мультисиг общего назначения**: он может исполнить любую инструкцию (перевод SOL, вызов другой программы,
смену собственных настроек). Плюс — акцент на explicit security-тестах и живом фронтенде.

**Некоммерческая цель.** Не конкурируем со Squads Protocol (это продакшн-стандарт). Наша задача —
показать глубокое понимание модели аккаунтов, PDA, CPI и векторов атак.

---

## 2. Технический стек

| Слой | Выбор |
|---|---|
| Программа | Anchor v1.x, Rust |
| Клиент/скрипты | `@solana/kit` 7, типизированный клиент через **Codama** (из IDL) |
| Фронтенд | Next.js **16** (App Router, Turbopack) + `@solana/client` + `@solana/react-hooks` (framework-kit), Wallet Standard (Phantom) |
| Тесты программы | **LiteSVM, Rust** (`cargo test`) — быстрый гейт, 21 тест |
| Тесты фронта | **Vitest** (+ @testing-library/react для компонентов) |
| Кластер | разработка сразу против **devnet** (план Б); программа задеплоена — см. «Статус деплоя» ниже |
| CI | GitHub Actions (`anchor build` + `cargo test`; фронт: `build` + `vitest` + `tsc`) |
| Лицензия | MIT |

> Anchor TS-тесты и Surfpool-integration **сознательно не используются**: LiteSVM покрывает и
> happy-path, и все негативные кейсы модели угроз, давая гейт на порядок быстрее. Перенесены
> в stretch goals (§6).
>
> Фронт держит **два слоя доступа к сети**: framework-kit — подключение кошелька, подпись и отправка;
> отдельный kit-RPC (`createSolanaRpc`) — чтение (`getProgramAccounts` + `memcmp`).

> Все CLI-команды агент/скрипт запускает с префиксом `NO_DNA=1`.

### Статус деплоя (devnet)

Программа задеплоена **2026-07-16** на публичный devnet:

| Параметр | Значение |
|---|---|
| Program ID | `EKYNZ8yeiivzgpmbq5TxC5bphmRnfARLxgzMxDUhHEUG` |
| Кластер | devnet (`https://api.devnet.solana.com`) |
| Loader | BPF Upgradeable (обновляемая) |
| Upgrade authority | `8wpBxSGcudaQWGB47SMhkFVb1XmHXqhDXsfyjVJj5TCY` |
| Deploy signature | `89iuZuBtNMVK11QPom8Dggfc5uuqXLHxQcwEKDaJfVgLfCozzX9Lh9zui2vrXHaZpmDSM77y1pGfrcQyqWfiwxP` |
| Data length | 209 440 байт |
| Explorer | `https://explorer.solana.com/address/EKYNZ8yeiivzgpmbq5TxC5bphmRnfARLxgzMxDUhHEUG?cluster=devnet` |

Первая попытка `anchor deploy` упала на `Max retries exceeded` (перегрузка публичного RPC при
заливке буфера); деплой возобновлён из существующего буфера (`solana program deploy --buffer …
--max-sign-attempts 200`) без повторной аренды.

---

## 3. Модель данных (on-chain state)

### Аккаунт `Multisig` (PDA данных)
```
seeds = [b"multisig", creator.key(), seed.to_le_bytes()]   // уникальность на создателя
```
| Поле | Тип | Назначение |
|---|---|---|
| `creator` | `Pubkey` | часть сидов PDA; хранится, чтобы реконструировать сиды подписи |
| `seed` | `u64` | часть сидов PDA; позволяет одному создателю иметь много мультисигов |
| `owners` | `Vec<Pubkey>` | список владельцев (N), `#[max_len(MAX_OWNERS)]` |
| `threshold` | `u8` | сколько подписей нужно (M) |
| `owner_set_seqno` | `u32` | версия набора владельцев — инвалидирует старые предложения |
| `transaction_count` | `u64` | счётчик для деривации PDA транзакций |
| `bump` | `u8` | канонический bump самого PDA данных |
| `signer_bump` | `u8` | канонический bump treasury-PDA (см. ниже) |

### Treasury-PDA `multisig_signer` (казна и authority)
```
seeds = [multisig.key()]        // аккаунта нет в state — это System-owned PDA без данных
```
**Зачем отдельный PDA.** `SystemProgram.transfer` требует, чтобы source-аккаунт принадлежал System
Program, а аккаунт данных `Multisig` принадлежит нашей программе. Поэтому средства держит отдельная
System-owned PDA без данных; программа подписывает за неё через `invoke_signed` с сидами
`[multisig.key(), signer_bump]`. Она же выступает authority в governance-инструкциях (§4).

### Аккаунт `Multisig` — лимиты

`MAX_OWNERS = 10`, `MAX_TX_ACCOUNTS = 16`, `MAX_TX_DATA = 1024` (`constants.rs`) — задают `space`
через `#[derive(InitSpace)]` + `#[max_len]` и защищают от раздувания аккаунтов.

### Аккаунт `Transaction` (PDA)
```
seeds = [b"transaction", multisig.key(), transaction_index.to_le_bytes()]
```
| Поле | Тип | Назначение |
|---|---|---|
| `multisig` | `Pubkey` | к какому мультисигу относится |
| `proposer` | `Pubkey` | кто предложил |
| `program_id` | `Pubkey` | целевая программа вложенной инструкции |
| `accounts` | `Vec<TransactionAccount>` | метаданные аккаунтов (pubkey, is_signer, is_writable), `#[max_len(MAX_TX_ACCOUNTS)]` |
| `data` | `Vec<u8>` | сериализованные данные инструкции, `#[max_len(MAX_TX_DATA)]` |
| `signers` | `Vec<bool>` | маска одобрений, длиной = `owners.len()` |
| `did_execute` | `bool` | защита от повторного исполнения (replay) |
| `owner_set_seqno` | `u32` | снапшот версии владельцев на момент создания |

> Примечание по масштабу: для простоты храним **одну** вложенную инструкцию на `Transaction`.
> Расширение до нескольких инструкций — в roadmap как «stretch goal».

---

## 4. Инструкции (API программы)

| Инструкция | Кто может | Что делает | Ключевые проверки |
|---|---|---|---|
| `create_multisig(owners, threshold, seed)` | любой | создаёт `Multisig` | `1 <= threshold <= owners.len()`; нет дубликатов; `owners.len() <= MAX` |
| `create_transaction(program_id, accounts, data)` | владелец | создаёт `Transaction`, автоматически ставит голос proposer'а | подписант ∈ `owners`; `owner_set_seqno` копируется; `accounts.len() <= MAX_TX_ACCOUNTS`; `data.len() <= MAX_TX_DATA` |
| `approve()` | владелец | ставит `signers[i] = true` | подписант ∈ `owners`; **идемпотентно** (повтор не считается дважды); `!did_execute`; `owner_set_seqno` совпадает |
| `execute_transaction()` | любой | если одобрений `>= threshold` — исполняет вложенную инструкцию через `invoke_signed` от treasury-PDA | пересчёт одобрений; `!did_execute`; ставит `did_execute = true` **до** CPI (anti-reentrancy); `owner_set_seqno` совпадает |
| `set_owners(new_owners)` | **только сам мультисиг** (self-CPI) | меняет владельцев, `owner_set_seqno += 1` | вызвано через `execute_transaction`; уникальность; лимит N; порог клампится вниз, если стал больше N |
| `change_threshold(new_threshold)` | **только сам мультисиг** | меняет порог, `owner_set_seqno += 1` | `1 <= new_threshold <= owners.len()` |

**Ключевой механизм.** `set_owners`/`change_threshold` нельзя вызвать напрямую — только «пропустив»
через процедуру голосования (создать транзакцию, где target = сам мультисиг). Так изменение правил
само подчиняется правилам. Инкремент `owner_set_seqno` делает все ранее созданные, но не исполненные
предложения невалидными (иначе уволенный владелец мог бы доисполнить старое предложение).

Реализовано **структурно, а не проверкой в теле**: в контексте governance-инструкций treasury-PDA
объявлена как `Signer` с seed-констрейнтом — подписать за неё может только `invoke_signed` из
`execute_transaction`, поэтому прямой вызов не проходит на уровне констрейнтов Anchor (паттерн
аудированного `coral-xyz/multisig`). Следствие: ошибка `UnauthorizedGovernance` (6009) на практике
недостижима — вызов падает раньше.

---

## 5. Модель угроз и security-требования

> Это **главная витрина** проекта. Каждый пункт → отдельный тест (см. раздел 7).

| # | Атака | Защита |
|---|---|---|
| 1 | Не-владелец предлагает/одобряет/исполняет | `Signer` + проверка вхождения в `owners` |
| 2 | Исполнение при одобрениях < threshold | пересчёт маски `signers` в `execute` |
| 3 | Replay: повторное исполнение той же транзакции | флаг `did_execute` |
| 4 | Двойное одобрение одним владельцем накручивает счётчик | `signers` — булева маска по индексу, не счётчик |
| 5 | Уволенный владелец доисполняет старое предложение | сверка `owner_set_seqno` в `execute` |
| 6 | Смена владельцев/порога в обход голосования | `set_owners`/`change_threshold` требуют signer = PDA мультисига |
| 7 | Reinit существующего мультисига | Anchor `init` (не `init_if_needed`) |
| 8 | Подмена PDA не-каноническим bump | хранить и валидировать канонический bump |
| 9 | Некорректный threshold (0 или > N) | валидация при create и change |
| 10 | Дубликаты владельцев (обход эффективного порога) | проверка уникальности в `create`/`set_owners` |
| 11 | Эскалация привилегий при CPI | не передавать callee лишних signer/writable |

**Статус:** все 11 векторов закрыты негативными тестами (`tests/security.rs`, 11 тестов) — раздел
выполнен полностью.

Отдельный разбор по итогам самоаудита — `docs/audit.md` (нетрекаемый): находка F2 закрыта (инкремент
`owner_set_seqno` при `change_threshold`), F1/F4/F5 — осознанные trade-off, задокументированы как
таковые.

Общий чеклист безопасности Solana-программ: см. `~/.claude/skills/solana-dev/references/security.md`.

---

## 6. Пошаговый план реализации

> Легенда: ✅ — сделано, 🔄 — в работе. Детальный план фронта (19 задач) — во внутренних доках
> `docs/superpowers/plans/2026-07-14-multisig-frontend.md`.

### ✅ Фаза 0 — Каркас (0.5 дня)
1. `NO_DNA=1 anchor init magican-solana-multisig`.
2. Настроить `Anchor.toml` (кластер devnet + localnet), выставить версии в `Cargo.toml`.
3. Завести структуру каталогов: `programs/`, `tests/`, `app/` (фронт позже), `scripts/`.
4. Пустой CI-workflow, README-скелет.

### ✅ Фаза 1 — Ядро состояния и создание (1 день)
1. Описать аккаунты `Multisig`, `Transaction`, вспомогательный `TransactionAccount`.
2. Реализовать `create_multisig` с валидацией (threshold, дубликаты, лимит N).
3. Первый LiteSVM/Anchor-тест: создание мультисига, чтение обратно.

### ✅ Фаза 2 — Жизненный цикл предложения (1.5 дня)
1. `create_transaction` — автопроставление голоса proposer'а, копирование `owner_set_seqno`.
2. `approve` — идемпотентность.
3. `execute_transaction` — сбор маски, проверка порога, `invoke_signed` от PDA, `did_execute`.
4. Демо-сценарий: перевод SOL с PDA-казны при 2 из 3 подписей.

### ✅ Фаза 3 — Управление правилами (1 день)
1. `set_owners` / `change_threshold` через self-CPI.
2. Инкремент и сверка `owner_set_seqno`.
3. Тест инвалидации старых предложений после смены владельцев.

### ✅ Фаза 4 — Security-тесты (1.5 дня)
1. По каждому пункту таблицы из раздела 5 — негативный тест (ожидаем ошибку).
2. Позитивные happy-path тесты.
3. Surfpool integration: полный флоу против реалистичного состояния.

### ✅ Фаза 5 — Клиент и скрипты (1 день)
1. Codama-генерация типизированного клиента из IDL.
2. Скрипт на `@solana/kit`: создать → предложить → собрать подписи → исполнить.
3. Демонстрация, что при M-1 подписях `execute` падает.

### 🔄 Фаза 6 — Фронтенд (2–3 дня)
1. Подключение кошелька, создание мультисига.
2. Список предложений с индикатором «X of N подтверждено».
3. Кнопки Approve/Execute, симуляция транзакции перед подписью.

### 🔄 Фаза 7 — Полировка и деплой (1 день)
1. Деплой на devnet, публичный program ID в README.
2. README: диаграмма стейт-машины предложения, раздел «что здесь нетривиального».
3. Ссылка на живое devnet-демо.

**Оценка:** ~9–11 дней с фронтендом.

### Stretch goals (по желанию)
- **Surfpool integration-тест** (`tests/integration/full.rs`) — полный сценарий против реалистичного
  состояния. Изначально был в плане; не сделан осознанно (LiteSVM покрывает те же кейсы быстрее).
- **Anchor TS-тесты** — по той же причине заменены LiteSVM.
- **CU-бенчмарк** `execute_transaction` (`MolluskComputeUnitBencher`).
- Несколько инструкций в одном предложении (batch).
- Время жизни предложения / срок годности (expiry по `Clock`).
- События (Anchor `emit!`) для индексации фронтендом.
- Timelock: задержка между достижением порога и исполнением.

---

## 7. Тестовая стратегия

- **Программа (быстрый CI-гейт):** LiteSVM на Rust — happy path + все негативные кейсы модели угроз.
  **21 тест, зелёные.** Запуск: `NO_DNA=1 anchor build` (обязателен — тесты подключают `.so` через
  `include_bytes!`), затем `cargo test -p magican-solana-multisig`.
- **End-to-end:** `scripts/demo.ts` на Codama-клиенте — полный сценарий с treasury-PDA, включая
  демонстрацию, что при M-1 подписях `execute` падает.
- **Фронтенд:** Vitest — чистая логика (PDA, статусы предложений, билдеры инструкций, разбор ошибок,
  слой чтения) + компонентные тесты. Запуск: `cd app && npm test`.
- **Детерминизм:** seeded keypairs, фиксированные PDA.

Тест-раскладка (фактическая):
```
programs/magican-solana-multisig/tests/
├── common/          # общие хелперы
├── create.rs        # создание, валидация          (4)
├── proposal_flow.rs # propose/approve/execute      (2)
├── governance.rs    # set_owners / change_threshold / seqno  (4)
└── security.rs      # негативные кейсы (главная витрина)     (11)

app/src/lib/*.test.ts   # логика фронта (Vitest)
```

---

## 8. Definition of Done

- [x] `NO_DNA=1 anchor build` + `cargo test` зелёные (happy path + все 11 security-кейсов).
- [x] Codama-клиент генерируется без ошибок.
- [x] Скрипт end-to-end отрабатывает локально; при M-1 подписях `execute` падает.
- [ ] Скрипт end-to-end отрабатывает **на devnet**.
- [ ] Фронтенд поднимается, подключает Phantom, проходит полный флоу (локально → devnet).
- [ ] `cd app && npm test && npm run build && npx tsc --noEmit` зелёные.
- [ ] README: архитектура + диаграмма стейт-машины + «что нетривиального» + ссылка на демо.
- [ ] CI зелёный на GitHub (программа + фронт).
- [ ] MIT-лицензия, единый нейминг `magican-*`.

---

## 9. Полезные ссылки

- SPL Multisig (референс-примитив): https://github.com/solana-labs/solana-program-library/tree/master/multisig
- Squads Protocol (продакшн-эталон, для вдохновения): https://squads.so
- Anchor CPI / `invoke_signed`: skill `solana-dev` → `references/programs/anchor.md`
- Security-чеклист: skill `solana-dev` → `references/security.md`
- Тестирование: skill `solana-dev` → `references/testing.md`
