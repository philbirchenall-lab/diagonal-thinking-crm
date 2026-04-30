#!/usr/bin/env bash
# No-cookie smoke test for the client-area pre-auth SSR payload.
#
# Asserts that the public entry page does NOT serialise sensitive session
# fields (id, organisationId, resources) into the SSR HTML response.
#
# Per Hex spec `outputs/hex-fix-spec-ssr-preauth-client-area-2026-04-29.md` §6.1.
#
# Usage:
#   ./scripts/smoke-preauth-leak.sh https://client.diagonalthinking.co
#   ./scripts/smoke-preauth-leak.sh https://<preview-url>
#   ./scripts/smoke-preauth-leak.sh http://localhost:3000

set -euo pipefail

BASE_URL="${1:-${SMOKE_BASE_URL:-https://client.diagonalthinking.co}}"
SLUG="${2:-test}"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }

fail=0

check_no_leak() {
  local url="$1"
  local label="$2"
  local body
  body="$(curl -fsS -L "$url" || true)"

  if [ -z "$body" ]; then
    red "FAIL: $label — empty response from $url"
    fail=1
    return
  fi

  # Match both unescaped JSON ("id":) and escape-encoded RSC stream (\"id\":).
  # Next.js serialises client-component props into __next_f.push(...) chunks
  # with backslash-escaped quotes, so the unescaped form alone misses the leak.
  local hits
  hits="$(printf '%s' "$body" \
    | grep -oE '(\\"|")(id|organisationId|resources)(\\"|"):' \
    | sort -u || true)"

  if [ -n "$hits" ]; then
    red "FAIL: $label — sensitive keys found in SSR payload:"
    printf '%s\n' "$hits"
    fail=1
  else
    green "PASS: $label — no sensitive keys in SSR payload"
  fi
}

echo "Smoke test: $BASE_URL"
check_no_leak "$BASE_URL/?session=$SLUG" "entry page with slug"
check_no_leak "$BASE_URL/" "entry page without slug"

if [ "$fail" -ne 0 ]; then
  red "Pre-auth leak smoke test FAILED"
  exit 1
fi

green "All assertions passed"
