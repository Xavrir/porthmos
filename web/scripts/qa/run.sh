#!/usr/bin/env bash
# Usage: scripts/qa/run.sh <snippet.js> [base-url] [out-dir]
# Runs a Playwright CLI run-code snippet against a running Porthmos build.
set -euo pipefail
PW="${PLAYWRIGHT_CLI:-$HOME/.local/lib/node_modules/@playwright/cli/node_modules/playwright-core/lib/tools/cli-client/cli.js}"
here="$(cd "$(dirname "$0")" && pwd)"
file="$1"; base="${2:-http://localhost:5173}"; out="${3:-$here/../../screenshots/dashboard-v3}"
axe="${AXE_PATH:-}"
mkdir -p "$out"
code="$(sed -e "s#__BASE__#$base#g" -e "s#__OUT__#$(cd "$out" && pwd)#g" -e "s#__AXE__#$axe#g" -e "s#__QA_FACTORY__#${QA_FACTORY:-}#g" -e "s#__QA_WC_BASE__#${QA_WC_BASE:-}#g" "$here/$file")"
chrome="${CHROMIUM:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)}"
cfg="$(mktemp -t porthmos-qa-XXXX.json)"
if [ -n "$chrome" ]; then
  printf '{"browser":{"browserName":"chromium","launchOptions":{"executablePath":"%s","headless":true},"contextOptions":{"viewport":{"width":1440,"height":900}}}}' "$chrome" > "$cfg"
else
  printf '{"browser":{"browserName":"chromium","launchOptions":{"headless":true}}}' > "$cfg"
fi
node "$PW" -s="${QA_SESSION:-porthmos-qa}" open about:blank --config "$cfg" >/dev/null
node "$PW" -s="${QA_SESSION:-porthmos-qa}" --raw run-code "$code"
