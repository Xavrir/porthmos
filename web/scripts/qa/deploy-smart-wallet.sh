#!/usr/bin/env bash
# Usage: scripts/qa/deploy-smart-wallet.sh [rpc-url]
# Deploys MockSmartWalletFactory (contracts/test/utils/MockSmartWallet.sol) on a local Anvil from its unlocked
# account 9 and prints the address, for QA_FACTORY in wallet.js. Local chains only.
set -euo pipefail
rpc="${1:-http://127.0.0.1:8545}"
here="$(cd "$(dirname "$0")" && pwd)"
artifact="$here/../../../contracts/out/MockSmartWallet.sol/MockSmartWalletFactory.json"
[ -f "$artifact" ] || (cd "$here/../../../contracts" && forge build >/dev/null)
[ "$(cast chain-id --rpc-url "$rpc")" = "31337" ] || { echo "not a local Anvil (chain 31337)" >&2; exit 1; }
code="$(node -e "process.stdout.write(require('$artifact').bytecode.object)")"
cast send --rpc-url "$rpc" --unlocked --from 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 --json --create "$code" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).contractAddress))"
