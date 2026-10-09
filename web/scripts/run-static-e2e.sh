#!/usr/bin/env bash
set -euo pipefail

WEB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${DAYFRAME_E2E_RUNTIME_DIR:-/tmp/dayframe-e2e}"
STATIC_DIR="${DAYFRAME_STATIC_DIR:-/tmp/dayframe-static}"
BASE_URL="${DAYFRAME_BASE_URL:-http://127.0.0.1:4173/dayframe/}"
TIMEOUT_SECONDS="${DAYFRAME_E2E_TIMEOUT:-600}"
WORKERS="${DAYFRAME_E2E_WORKERS:-1}"

rm -rf "$RUNTIME_DIR" "$STATIC_DIR"
mkdir -p "$RUNTIME_DIR" "$STATIC_DIR/dayframe"
cp "$WEB_ROOT"/e2e/*.spec.mjs "$RUNTIME_DIR"/
# The product-guide spec imports the real pure extractor, not a duplicated test stub.
cp "$WEB_ROOT"/lib/dayframe-product-guide-extract.mjs "$RUNTIME_DIR"/
cp "$WEB_ROOT"/lib/dayframe-manufacturer-guide.mjs "$RUNTIME_DIR"/
cp "$WEB_ROOT"/lib/dayframe-product-discovery.mjs "$RUNTIME_DIR"/
cp "$WEB_ROOT"/lib/dayframe-product-quality.mjs "$RUNTIME_DIR"/
cp -a "$WEB_ROOT"/preview-dist/. "$STATIC_DIR/dayframe/"

cd "$RUNTIME_DIR"
npm init -y >/dev/null
timeout 180s npm install --no-package-lock --ignore-scripts @playwright/test@1.55.0 >/dev/null
google-chrome --version

cat > playwright.config.mjs <<'EOF'
export default {
  use: {
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
};
EOF

python3 -m http.server 4173 --bind 127.0.0.1 --directory "$STATIC_DIR" > /tmp/dayframe-preview.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

READY=0
for _ in {1..30}; do
  if curl -fsS "$BASE_URL" >/dev/null; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  cat /tmp/dayframe-preview.log
  exit 1
fi

export DAYFRAME_BASE_URL="$BASE_URL"
timeout "${TIMEOUT_SECONDS}s" npx playwright test   --config=playwright.config.mjs   --workers="$WORKERS"   --reporter=line   "$@"
