#!/usr/bin/env bash
# Brings up a local solana-test-validator with the program deployed,
# waits for the RPC to be ready, runs scripts/demo.ts and cleans up after itself.
#
# Requires a prior build: NO_DNA=1 anchor build
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SO="$ROOT/target/deploy/magican_solana_multisig.so"
KEYPAIR="$ROOT/target/deploy/magican_solana_multisig-keypair.json"
LEDGER="$(mktemp -d)"
RPC="http://127.0.0.1:8899"

if [ ! -f "$SO" ]; then
  echo "No $SO — run this first: NO_DNA=1 anchor build" >&2
  exit 1
fi

echo "Starting solana-test-validator (ledger: $LEDGER)…"
NO_DNA=1 solana-test-validator \
  --reset \
  --ledger "$LEDGER" \
  --bpf-program "$KEYPAIR" "$SO" \
  --quiet &
VALIDATOR_PID=$!

cleanup() {
  echo "Stopping the validator…"
  kill "$VALIDATOR_PID" 2>/dev/null || true
  wait "$VALIDATOR_PID" 2>/dev/null || true
  rm -rf "$LEDGER"
}
trap cleanup EXIT

echo "Waiting for the RPC to be ready…"
READY=0
for _ in $(seq 1 60); do
  if NO_DNA=1 solana --url "$RPC" cluster-version >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "The RPC never came up within 60 s." >&2
  exit 1
fi
echo "RPC is ready. Starting the demo."

yarn tsx scripts/demo.ts
