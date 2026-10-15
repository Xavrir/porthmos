#!/usr/bin/env bash
# Starts the five AEGIS processes against a running chain (default: local Anvil + deployments/31337.json).
# Each process gets only its own key in its environment.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
export CHAIN_ID="${CHAIN_ID:-31337}"
export DEPLOYMENTS_PATH="${DEPLOYMENTS_PATH:-$(cd .. && pwd)/deployments/${CHAIN_ID}.json}"
if [ ! -f "$DEPLOYMENTS_PATH" ]; then
  echo "missing $DEPLOYMENTS_PATH: start Anvil (make anvil) and deploy (make deploy) first" >&2
  exit 1
fi
if ! curl -s -m 3 -X POST -H 'content-type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC_URL" >/dev/null; then
  echo "no RPC at $RPC_URL" >&2
  exit 1
fi
mkdir -p var/log
KEYS=(AUTHORIZER_KEY EXIT_KEY EXECUTOR_KEY KEEPER_KEY ADMIN_KEY)
pids=()

start() {
  local name=$1 keep=$2
  local unset_args=()
  for k in "${KEYS[@]}"; do [ "$k" = "$keep" ] || unset_args+=(-u "$k"); done
  env "${unset_args[@]}" uv run python -m aegis "$name" >"var/log/$name.log" 2>&1 &
  pids+=($!)
  echo "started $name (pid $!), log var/log/$name.log"
}

cleanup() { kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

start authorizer AUTHORIZER_KEY
sleep 2
start api ADMIN_KEY
start executor EXECUTOR_KEY
start exit_agent EXIT_KEY
start keeper KEEPER_KEY
echo "API on http://127.0.0.1:${API_PORT:-8787} (Ctrl-C stops all)"
wait
