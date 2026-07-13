#!/usr/bin/env bash
# Поднимает локальный solana-test-validator с задеплоенной программой,
# ждёт готовности RPC, запускает scripts/demo.ts и убирает за собой.
#
# Требует предварительной сборки: NO_DNA=1 anchor build
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SO="$ROOT/target/deploy/magican_solana_multisig.so"
KEYPAIR="$ROOT/target/deploy/magican_solana_multisig-keypair.json"
LEDGER="$(mktemp -d)"
RPC="http://127.0.0.1:8899"

if [ ! -f "$SO" ]; then
  echo "Нет $SO — сначала выполни: NO_DNA=1 anchor build" >&2
  exit 1
fi

echo "Запускаю solana-test-validator (ledger: $LEDGER)…"
NO_DNA=1 solana-test-validator \
  --reset \
  --ledger "$LEDGER" \
  --bpf-program "$KEYPAIR" "$SO" \
  --quiet &
VALIDATOR_PID=$!

cleanup() {
  echo "Останавливаю валидатор…"
  kill "$VALIDATOR_PID" 2>/dev/null || true
  wait "$VALIDATOR_PID" 2>/dev/null || true
  rm -rf "$LEDGER"
}
trap cleanup EXIT

echo "Жду готовности RPC…"
READY=0
for _ in $(seq 1 60); do
  if NO_DNA=1 solana --url "$RPC" cluster-version >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "RPC так и не поднялся за 60 c." >&2
  exit 1
fi
echo "RPC готов. Запускаю демо."

yarn tsx scripts/demo.ts
