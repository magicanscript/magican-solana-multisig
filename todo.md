# Roadmap — `magican-solana-multisig`

> Программируемый multisig-кошелёк общего назначения на Solana (Anchor v1). Портфолио-проект.
> Полное ТЗ — `docs/PRD_multisig.md`. Security-ресёрч — `docs/audit.md`.
> Обновлено: 2026-07-09.

## Легенда
`[x]` готово · `[~]` частично · `[ ]` предстоит

---

## ✅ Сделано — on-chain ядро (Фазы 1–4)

Все 21 тест зелёный (LiteSVM, Rust): `create` 4 · `proposal_flow` 2 · `governance` 3 · `security` 11 + unit.
`anchor build` чистый.

### Фаза 1 — Состояние и создание
- [x] Аккаунты `Multisig`, `Transaction`, `TransactionAccount` (`#[derive(InitSpace)]`, `#[max_len]`)
- [x] `create_multisig` с валидацией (threshold, дубликаты, лимит N), канонический bump, `init` (не `init_if_needed`)
- [x] Отдельный treasury-PDA `multisig_signer` (seeds `[multisig.key()]`), `signer_bump` в state
- [x] Тесты `tests/create.rs`

### Фаза 2 — Жизненный цикл предложения
- [x] `create_transaction` — автоголос proposer, снапшот `owner_set_seqno`, детерминированный PDA по `transaction_count`
- [x] `approve` — идемпотентная булева маска, `has_one`
- [x] `execute_transaction` — пересчёт порога, replay-защита `did_execute`, `invoke_signed` от PDA
- [x] Demo 2-из-3 перевод SOL с PDA-казны (`tests/proposal_flow.rs`)

### Фаза 3 — Управление правилами (self-governance)
- [x] `Auth`-контекст (`multisig_signer: Signer` с seed-констрейнтом) — паттерн аудированного эталона
- [x] `set_owners` (клампинг порога вниз, `owner_set_seqno += 1` checked)
- [x] `change_threshold`
- [x] Тест инвалидации старых предложений (`tests/governance.rs`)

### Фаза 4 — Security-тесты (главная витрина)
- [x] `tests/security.rs` — по 1 негативному тесту на каждый из 11 векторов модели угроз
- [x] Каждый тест проверяет **конкретную** Anchor-ошибку (`assert_err_log`) — не «зеленеет» по случайности

### Ресёрч
- [x] Сверка архитектуры с аудированным `coral-xyz/multisig`
- [x] Глубокий security-аудит (deep-research) → `docs/audit.md`

---

## 🔜 Предстоит

### Фаза 4.5 — Security-hardening (по итогам `docs/audit.md`)
- [ ] **F2**: `change_threshold` должен инкрементировать `owner_set_seqno` (+ тест) — быстрый выигрыш
- [ ] **F1** (opt-in): проверка апгрейда целевой программы — поле `slot` при create, сверка с `ProgramData` в execute
- [ ] Задокументировать F4/F5 (remaining_accounts / arbitrary CPI) как осознанный design trade-off
- [ ] (опц.) CU-бенчмарк `execute_transaction` (Mollusk `MolluskComputeUnitBencher`)

### Фаза 5 — Клиент и скрипты
- [ ] Codama-генерация типизированного клиента из IDL
- [ ] Скрипт `@solana/kit`: create → propose → approve → execute
- [ ] Демонстрация: при M-1 подписях `execute` падает

### Фаза 6 — Фронтенд (Next.js, devnet)
- [ ] Подключение кошелька (Wallet Standard / Phantom) через framework-kit (`@solana/client` + `@solana/react-hooks`)
- [ ] Создание мультисига, список предложений с индикатором «X of N подтверждено»
- [ ] Кнопки Approve/Execute, симуляция транзакции перед подписью

### Фаза 7 — Полировка и деплой
- [ ] Деплой на devnet, публичный program ID в README
- [ ] README: диаграмма стейт-машины, раздел «что здесь нетривиального», ссылка на живое демо
- [ ] GitHub Actions CI (`cargo test-sbf` + `anchor test`)
- [ ] MIT-лицензия, единый нейминг `magican-*`

---

## 🎯 Stretch goals (по желанию)
- [ ] Несколько инструкций в одном предложении (batch)
- [ ] Expiry предложений по `Clock` (закрывает F3 из аудита)
- [ ] Timelock: задержка между достижением порога и исполнением
- [ ] События (Anchor `emit!`) для индексации фронтендом
- [ ] Закрытие аккаунтов транзакций (с учётом F6: revival + Anchor 0.30+ close-поведение)

---

## Definition of Done (из PRD)
- [~] `anchor build` + тесты зелёные (ядро готово; фронт/интеграция впереди)
- [ ] Codama-клиент генерируется без ошибок
- [ ] Скрипт end-to-end на devnet; при M-1 подписях `execute` падает
- [ ] Фронтенд поднимается, Phantom на devnet, полный флоу
- [ ] README: архитектура + диаграмма + «что нетривиального» + ссылка на демо
- [ ] CI зелёный на GitHub
- [ ] MIT-лицензия, единый нейминг `magican-*`
