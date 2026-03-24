#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

load_env_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  fi
}

load_env_file "$ROOT_DIR/.env"
load_env_file "$ROOT_DIR/.env.local"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

require_cmd npx
require_cmd node
require_cmd jq
require_cmd curl
require_cmd nc

require_env OPENAI_API_KEY
require_env DATABASE_URL

export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="${PWCLI:-$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh}"

if [[ ! -x "$PWCLI" ]]; then
  echo "Playwright wrapper not found at $PWCLI" >&2
  exit 1
fi

HELPER=(node "$ROOT_DIR/scripts/playwright/settings_openai_helper.mjs")

timestamp_slug() {
  date +%Y%m%d-%H%M%S
}

RANDOM_HEX="$(node -e 'process.stdout.write(require("crypto").randomBytes(6).toString("hex"))')"
STAMP="$(timestamp_slug)"
SCHEMA_NAME="settings_openai_${STAMP//-/}_${RANDOM_HEX}"
OUT_DIR="$ROOT_DIR/output/playwright/settings-openai-${STAMP}-${RANDOM_HEX}"
mkdir -p "$OUT_DIR"

PASS_FILE="$OUT_DIR/passes.txt"
SKIP_FILE="$OUT_DIR/skips.txt"
NOTE_FILE="$OUT_DIR/notes.txt"
SUMMARY_JSON="$OUT_DIR/summary.json"
SUMMARY_MD="$OUT_DIR/summary.md"

touch "$PASS_FILE" "$SKIP_FILE" "$NOTE_FILE"

record_pass() {
  printf '%s\n' "$1" >> "$PASS_FILE"
}

record_skip() {
  printf '%s :: %s\n' "$1" "$2" >> "$SKIP_FILE"
}

record_note() {
  printf '%s\n' "$1" >> "$NOTE_FILE"
}

CURRENT_STEP="bootstrap"
LAST_ERROR_STEP=""
FAILED=0

trap 'FAILED=1; LAST_ERROR_STEP="${CURRENT_STEP}"' ERR

API_PID=""
WEB_PID=""
MOCK_PID=""
SESSION="soa-${RANDOM_HEX}"
LAST_SNAPSHOT=""
RESTORE_ATTEMPTED=0
DROP_ATTEMPTED=0
SERVICES_STARTED=0

API_PORT="$("${HELPER[@]}" get-free-port)"
VITE_PORT="$("${HELPER[@]}" get-free-port)"
MOCK_COMPAT_PORT="$("${HELPER[@]}" get-free-port)"

export BASE_DATABASE_URL="$DATABASE_URL"
export DATABASE_URL="$("${HELPER[@]}" schema-url --schema "$SCHEMA_NAME")"
export API_PORT
export API_TOKEN="settings-openai-${RANDOM_HEX}-token"
export VITE_API_TOKEN="$API_TOKEN"
export VITE_API_BASE_URL="http://127.0.0.1:${API_PORT}"
export APP_SECRETBOX_KEY="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))')"

API_BASE_URL="http://127.0.0.1:${API_PORT}"
VITE_BASE_URL="http://127.0.0.1:${VITE_PORT}"
VALID_COMPAT_BASE_URL="http://127.0.0.1:${MOCK_COMPAT_PORT}/v1"
INVALID_BASE_URL="http://127.0.0.1:9/v1"

BASELINE_JSON="$OUT_DIR/baseline.json"
PRIME_JSON="$OUT_DIR/prime-openai.json"
SETUP_FIXTURE_JSON="$OUT_DIR/approval-fixture.json"
ENV_JSON="$OUT_DIR/environment.json"

cat > "$ENV_JSON" <<EOF
{
  "schema": "$SCHEMA_NAME",
  "apiBaseUrl": "$API_BASE_URL",
  "viteBaseUrl": "$VITE_BASE_URL",
  "compatBaseUrl": "$VALID_COMPAT_BASE_URL",
  "outputDir": "$OUT_DIR"
}
EOF

wait_for_port() {
  local host="$1"
  local port="$2"
  local timeout_sec="${3:-120}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    if nc -z "$host" "$port" >/dev/null 2>&1; then
      return 0
    fi
    if (( "$(date +%s)" - started_at > timeout_sec )); then
      echo "Timed out waiting for ${host}:${port}" >&2
      return 1
    fi
    sleep 1
  done
}

wait_for_api_health() {
  local timeout_sec="${1:-120}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    if curl -sS "$API_BASE_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    if (( "$(date +%s)" - started_at > timeout_sec )); then
      echo "Timed out waiting for API health" >&2
      return 1
    fi
    sleep 1
  done
}

api_status_to() {
  local method="$1"
  local route="$2"
  local body="${3:-}"
  local output_file="$4"
  local args=(
    curl
    -sS
    -o "$output_file"
    -w '%{http_code}'
    -X "$method"
    "$API_BASE_URL$route"
    -H 'content-type: application/json'
    -H "x-local-api-token: $API_TOKEN"
  )
  if [[ -n "$body" ]]; then
    args+=(-d "$body")
  fi
  "${args[@]}"
}

api_get_to() {
  local route="$1"
  local output_file="$2"
  local status
  status="$(api_status_to GET "$route" "" "$output_file")"
  if [[ "$status" != "200" ]]; then
    echo "GET $route failed with HTTP $status" >&2
    cat "$output_file" >&2 || true
    return 1
  fi
}

api_post_to() {
  local route="$1"
  local body="$2"
  local output_file="$3"
  local status
  status="$(api_status_to POST "$route" "$body" "$output_file")"
  if [[ "$status" != "200" ]]; then
    echo "POST $route failed with HTTP $status" >&2
    cat "$output_file" >&2 || true
    return 1
  fi
}

api_patch_to() {
  local route="$1"
  local body="$2"
  local output_file="$3"
  local status
  status="$(api_status_to PATCH "$route" "$body" "$output_file")"
  if [[ "$status" != "200" ]]; then
    echo "PATCH $route failed with HTTP $status" >&2
    cat "$output_file" >&2 || true
    return 1
  fi
}

assert_jq_eq() {
  local file="$1"
  local filter="$2"
  local expected="$3"
  local actual
  actual="$(jq -r "$filter" "$file")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Assertion failed: $filter expected '$expected' got '$actual' in $file" >&2
    return 1
  fi
}

assert_jq_test() {
  local file="$1"
  local expression="$2"
  if ! jq -e "$expression" "$file" >/dev/null; then
    echo "Assertion failed: jq expression '$expression' did not pass for $file" >&2
    return 1
  fi
}

assert_file_not_contains() {
  local file="$1"
  local text="$2"
  if rg -F -q "$text" "$file"; then
    echo "Unexpected secret/material '$text' found in $file" >&2
    return 1
  fi
}

wait_for_api_expression() {
  local route="$1"
  local expression="$2"
  local timeout_sec="${3:-90}"
  local output_file="$4"
  local started_at
  started_at="$(date +%s)"
  while true; do
    api_get_to "$route" "$output_file"
    if jq -e "$expression" "$output_file" >/dev/null; then
      return 0
    fi
    if (( "$(date +%s)" - started_at > timeout_sec )); then
      echo "Timed out waiting for API expression '$expression' on $route" >&2
      cat "$output_file" >&2 || true
      return 1
    fi
    sleep 1
  done
}

wait_for_assistant_message() {
  local session_id="$1"
  local output_file="$2"
  local timeout_sec="${3:-120}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    api_get_to "/api/v1/chat/sessions/${session_id}/messages" "$output_file"
    if jq -e '.items | any(.role == "assistant")' "$output_file" >/dev/null; then
      return 0
    fi
    if (( "$(date +%s)" - started_at > timeout_sec )); then
      echo "Timed out waiting for assistant message in session ${session_id}" >&2
      cat "$output_file" >&2 || true
      return 1
    fi
    sleep 2
  done
}

snapshot_step() {
  local name="$1"
  local snapshot_out
  snapshot_out="$("$PWCLI" --session "$SESSION" snapshot 2>&1 || true)"
  printf '%s\n' "$snapshot_out" > "$OUT_DIR/${name}.snapshot.log"
  local snapshot_src
  snapshot_src="$(printf '%s\n' "$snapshot_out" | rg -o '\.playwright-cli/[^)]+\.yml' | tail -n 1 || true)"
  LAST_SNAPSHOT="$OUT_DIR/${name}.yml"
  if [[ -n "$snapshot_src" && -f "$snapshot_src" ]]; then
    cp "$snapshot_src" "$LAST_SNAPSHOT"
  else
    printf '%s\n' "$snapshot_out" > "$LAST_SNAPSHOT"
  fi

  local shot_out
  shot_out="$("$PWCLI" --session "$SESSION" screenshot 2>&1 || true)"
  printf '%s\n' "$shot_out" > "$OUT_DIR/${name}.screenshot.log"
  local png
  png="$(printf '%s\n' "$shot_out" | rg -o '\.playwright-cli/[^)]+\.png' | tail -n 1 || true)"
  if [[ -n "$png" && -f "$png" ]]; then
    cp "$png" "$OUT_DIR/${name}.png"
  fi
}

find_ref_nth() {
  local pattern="$1"
  local nth="${2:-1}"
  local ref
  ref="$(rg -F "$pattern" "$LAST_SNAPSHOT" | sed -E 's/.*\[ref=(e[0-9]+)\].*/\1/' | sed -n "${nth}p" || true)"
  if [[ -z "$ref" ]]; then
    echo "Failed to find ref for pattern '$pattern' (occurrence ${nth}) in $LAST_SNAPSHOT" >&2
    return 1
  fi
  printf '%s' "$ref"
}

find_ref() {
  find_ref_nth "$1" 1
}

click_pattern_nth() {
  local pattern="$1"
  local nth="${2:-1}"
  local ref
  ref="$(find_ref_nth "$pattern" "$nth")"
  "$PWCLI" --session "$SESSION" click "$ref" >/dev/null
}

fill_pattern_nth() {
  local pattern="$1"
  local value="$2"
  local nth="${3:-1}"
  local ref
  ref="$(find_ref_nth "$pattern" "$nth")"
  "$PWCLI" --session "$SESSION" fill "$ref" "$value" >/dev/null
}

select_pattern_nth() {
  local pattern="$1"
  local value="$2"
  local nth="${3:-1}"
  local ref
  ref="$(find_ref_nth "$pattern" "$nth")"
  "$PWCLI" --session "$SESSION" select "$ref" "$value" >/dev/null
}

check_pattern_nth() {
  local pattern="$1"
  local nth="${2:-1}"
  local ref
  ref="$(find_ref_nth "$pattern" "$nth")"
  "$PWCLI" --session "$SESSION" check "$ref" >/dev/null
}

uncheck_pattern_nth() {
  local pattern="$1"
  local nth="${2:-1}"
  local ref
  ref="$(find_ref_nth "$pattern" "$nth")"
  "$PWCLI" --session "$SESSION" uncheck "$ref" >/dev/null
}

eval_page() {
  local expression="$1"
  "$PWCLI" --session "$SESSION" eval "$expression" >/dev/null
}

eval_page_output() {
  local expression="$1"
  "$PWCLI" --session "$SESSION" eval "$expression"
}

set_role_routing_select() {
  local role_label="$1"
  local field_label="$2"
  local value="$3"
  local expression
  local role_label_json
  local field_label_json
  local value_json
  role_label_json="$(printf '%s' "$role_label" | jq -Rs .)"
  field_label_json="$(printf '%s' "$field_label" | jq -Rs .)"
  value_json="$(printf '%s' "$value" | jq -Rs .)"
  expression=$(cat <<EOF
() => {
  const roleLabel = ${role_label_json};
  const fieldLabel = ${field_label_json};
  const nextValue = ${value_json};
  const roleNode = [...document.querySelectorAll("div")]
    .find((node) => node.textContent?.trim() === roleLabel);
  if (!roleNode) {
    throw new Error(\`Role card not found for \${roleLabel}\`);
  }
  const card = roleNode.closest("div.rounded-lg");
  if (!card) {
    throw new Error(\`Role card container not found for \${roleLabel}\`);
  }
  const labelNode = [...card.querySelectorAll("label")]
    .find((node) => node.textContent?.includes(fieldLabel));
  if (!labelNode) {
    throw new Error(\`Field \${fieldLabel} not found for \${roleLabel}\`);
  }
  const select = labelNode.querySelector("select");
  if (!select) {
    throw new Error(\`Select input missing for \${roleLabel} / \${fieldLabel}\`);
  }
  select.value = nextValue;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { roleLabel, fieldLabel, nextValue, appliedValue: select.value };
}
EOF
)
  "$PWCLI" --session "$SESSION" eval "$expression" >/dev/null
}

wait_for_role_routing_option() {
  local role_label="$1"
  local option_value="$2"
  local timeout_sec="${3:-90}"
  local role_label_json
  local option_value_json
  local started_at
  role_label_json="$(printf '%s' "$role_label" | jq -Rs .)"
  option_value_json="$(printf '%s' "$option_value" | jq -Rs .)"
  started_at="$(date +%s)"
  while true; do
    local expression
    expression=$(cat <<EOF
() => {
  const roleLabel = ${role_label_json};
  const optionValue = ${option_value_json};
  const roleNode = [...document.querySelectorAll("div")]
    .find((node) => node.textContent?.trim() === roleLabel);
  if (!roleNode) return false;
  const card = roleNode.closest("div.rounded-lg");
  if (!card) return false;
  const modelLabel = [...card.querySelectorAll("label")]
    .find((node) => node.textContent?.includes("Model"));
  const select = modelLabel?.querySelector("select");
  if (!select) return false;
  return [...select.options].some((option) => option.value === optionValue);
}
EOF
)
    local output
    output="$(eval_page_output "$expression" | tail -n 1 | tr -d '\r')"
    if [[ "$output" == "true" ]]; then
      return 0
    fi
    if (( "$(date +%s)" - started_at > timeout_sec )); then
      echo "Timed out waiting for role-routing option '$option_value' in role '$role_label'" >&2
      return 1
    fi
    sleep 1
  done
}

scroll_main_top() {
  eval_page '() => { const el = document.querySelector("main"); if (el) { el.scrollTo(0, 0); return el.scrollTop; } window.scrollTo(0, 0); return window.scrollY; }'
  sleep 1
}

scroll_main_bottom() {
  eval_page '() => { const el = document.querySelector("main"); if (el) { el.scrollTo(0, el.scrollHeight); return el.scrollTop; } window.scrollTo(0, document.body.scrollHeight); return window.scrollY; }'
  sleep 1
}

scroll_main_middle() {
  eval_page '() => { const el = document.querySelector("main"); if (el) { el.scrollBy(0, 1200); return el.scrollTop; } window.scrollBy(0, 1200); return window.scrollY; }'
  sleep 1
}

wait_for_snapshot_text() {
  local expected="$1"
  local timeout_sec="${2:-90}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    local snapshot_out
    snapshot_out="$("$PWCLI" --session "$SESSION" snapshot 2>&1 || true)"
    local snapshot_src
    snapshot_src="$(printf '%s\n' "$snapshot_out" | rg -o '\.playwright-cli/[^)]+\.yml' | tail -n 1 || true)"
    if [[ -n "$snapshot_src" && -f "$snapshot_src" ]] && rg -F -q "$expected" "$snapshot_src"; then
      LAST_SNAPSHOT="$snapshot_src"
      return 0
    fi
    if (( "$(date +%s)" - started_at > timeout_sec )); then
      echo "Timed out waiting for snapshot text '$expected'" >&2
      return 1
    fi
    sleep 2
  done
}

optional_api_post() {
  local label="$1"
  local route="$2"
  local body="$3"
  local output_file="$4"
  local status
  status="$(api_status_to POST "$route" "$body" "$output_file")"
  if [[ "$status" == "200" ]]; then
    return 0
  fi
  record_skip "$label" "HTTP ${status}"
  return 1
}

write_summary() {
  local final_status="$1"
  node - "$PASS_FILE" "$SKIP_FILE" "$NOTE_FILE" "$SUMMARY_JSON" "$SUMMARY_MD" "$OUT_DIR" "$SCHEMA_NAME" "$LAST_ERROR_STEP" "$final_status" <<'NODE'
const fs = require("fs");
const [passFile, skipFile, noteFile, summaryJson, summaryMd, outDir, schemaName, lastErrorStep, finalStatus] = process.argv.slice(2);
const readLines = (file) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
const passes = readLines(passFile);
const skips = readLines(skipFile);
const notes = readLines(noteFile);
const payload = {
  status: Number(finalStatus) === 0 ? "passed" : "failed",
  outputDir: outDir,
  schema: schemaName,
  failureStep: lastErrorStep || null,
  passCount: passes.length,
  skipCount: skips.length,
  passes,
  skips,
  notes,
};
fs.writeFileSync(summaryJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const lines = [
  "# Settings OpenAI Kitchen-Sink E2E",
  "",
  `- status: ${payload.status}`,
  `- schema: \`${schemaName}\``,
  `- output: \`${outDir}\``,
  `- passes: ${passes.length}`,
  `- skips: ${skips.length}`,
];
if (payload.failureStep) {
  lines.push(`- failure step: \`${payload.failureStep}\``);
}
if (passes.length) {
  lines.push("", "## Passes", ...passes.map((item) => `- ${item}`));
}
if (skips.length) {
  lines.push("", "## Skips", ...skips.map((item) => `- ${item}`));
}
if (notes.length) {
  lines.push("", "## Notes", ...notes.map((item) => `- ${item}`));
}
fs.writeFileSync(summaryMd, `${lines.join("\n")}\n`, "utf8");
NODE
}

cleanup() {
  local exit_code="$?"

  set +e

  if [[ "$SERVICES_STARTED" == "1" ]] && [[ "$RESTORE_ATTEMPTED" == "0" ]] && [[ -f "$BASELINE_JSON" ]]; then
    RESTORE_ATTEMPTED=1
    "${HELPER[@]}" restore --baseline "$BASELINE_JSON" --output "$OUT_DIR/restore.json" > "$OUT_DIR/restore.stdout.log" 2> "$OUT_DIR/restore.stderr.log" || record_skip "restore" "best-effort restore failed"
  fi

  if [[ -n "$SESSION" ]]; then
    "$PWCLI" --session "$SESSION" console > "$OUT_DIR/browser-console.log" 2>&1 || true
    "$PWCLI" --session "$SESSION" network > "$OUT_DIR/browser-network.log" 2>&1 || true
    "$PWCLI" --session "$SESSION" close > "$OUT_DIR/browser-close.log" 2>&1 || true
  fi

  if [[ -n "$WEB_PID" ]]; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$API_PID" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$MOCK_PID" ]]; then
    kill "$MOCK_PID" >/dev/null 2>&1 || true
  fi

  if [[ "$DROP_ATTEMPTED" == "0" ]]; then
    DROP_ATTEMPTED=1
    "${HELPER[@]}" drop-schema --schema "$SCHEMA_NAME" > "$OUT_DIR/drop-schema.log" 2>&1 || record_skip "drop-schema" "schema cleanup failed"
  fi

  write_summary "$exit_code"
  return "$exit_code"
}

trap cleanup EXIT

CURRENT_STEP="db-push"
npx prisma db push --skip-generate > "$OUT_DIR/prisma-db-push.log" 2>&1
record_pass "Disposable schema created and Prisma schema pushed"

CURRENT_STEP="mock-compat-start"
"${HELPER[@]}" mock-openai-compatible --port "$MOCK_COMPAT_PORT" > "$OUT_DIR/mock-openai-compatible.log" 2>&1 &
MOCK_PID=$!
wait_for_port 127.0.0.1 "$MOCK_COMPAT_PORT" 30
record_pass "Mock OpenAI-compatible provider started"

CURRENT_STEP="api-start"
npm run dev:api > "$OUT_DIR/dev-api.log" 2>&1 &
API_PID=$!
wait_for_port 127.0.0.1 "$API_PORT" 120
wait_for_api_health 120

CURRENT_STEP="web-start"
npx vite --host 127.0.0.1 --port "$VITE_PORT" > "$OUT_DIR/dev-web.log" 2>&1 &
WEB_PID=$!
wait_for_port 127.0.0.1 "$VITE_PORT" 120
SERVICES_STARTED=1
record_pass "API and Vite browser preview started with disposable token/ports"

CURRENT_STEP="capture-baseline"
"${HELPER[@]}" capture-state --api-base-url "$API_BASE_URL" --api-token "$API_TOKEN" --output "$BASELINE_JSON"
record_pass "Baseline settings, OpenAI budget, and raw DB state captured"

CURRENT_STEP="seed-fixture"
"${HELPER[@]}" seed-approval-fixture --output "$SETUP_FIXTURE_JSON"
FIXTURE_REPO_ID="$(jq -r '.fixture.repoId' "$SETUP_FIXTURE_JSON")"
FIXTURE_TICKET_ID="$(jq -r '.fixture.ticketId' "$SETUP_FIXTURE_JSON")"
FIXTURE_RUN_ID="$(jq -r '.fixture.runId' "$SETUP_FIXTURE_JSON")"
FIXTURE_APPROVAL_ID="$(jq -r '.fixture.approvalId' "$SETUP_FIXTURE_JSON")"
FIXTURE_WORKTREE_PATH="$(jq -r '.fixture.worktreePath' "$SETUP_FIXTURE_JSON")"
record_pass "Approval relay fixture seeded in disposable schema"

CURRENT_STEP="prime-openai"
"${HELPER[@]}" prime-openai --api-base-url "$API_BASE_URL" --api-token "$API_TOKEN" --daily-budget 0.6 --per-run-budget 0.2 --output "$PRIME_JSON"
GLOBAL_MODEL="$(jq -r '.chosenModels.globalModel' "$PRIME_JSON")"
FAST_MODEL="$(jq -r '.chosenModels.fastModel' "$PRIME_JSON")"
BUILD_MODEL="$(jq -r '.chosenModels.buildModel' "$PRIME_JSON")"
REVIEW_MODEL="$(jq -r '.chosenModels.reviewModel' "$PRIME_JSON")"
ESCALATION_MODEL="$(jq -r '.chosenModels.escalationModel' "$PRIME_JSON")"
record_note "Chosen OpenAI models: global=${GLOBAL_MODEL}, fast=${FAST_MODEL}, build=${BUILD_MODEL}, review=${REVIEW_MODEL}, escalation=${ESCALATION_MODEL}"
record_pass "OpenAI-all runtime primed with dynamic low-cost model selection"

CURRENT_STEP="channel-session"
CHANNEL_SESSION_BODY="$(jq -n --arg title "Settings E2E Channel Session" --arg repoId "$FIXTURE_REPO_ID" '{title:$title, repoId:$repoId}')"
api_post_to "/api/v1/chat/sessions" "$CHANNEL_SESSION_BODY" "$OUT_DIR/channel-session.json"
CHANNEL_SESSION_ID="$(jq -r '.item.id' "$OUT_DIR/channel-session.json")"

CURRENT_STEP="browser-open"
"$PWCLI" --session "$SESSION" open "$VITE_BASE_URL" --headed > "$OUT_DIR/browser-open.log" 2>&1
snapshot_step "01-open"
if rg -F -q 'button "Continue anyway"' "$LAST_SNAPSHOT"; then
  click_pattern_nth 'button "Continue anyway"' 1
  sleep 1
  snapshot_step "01b-continue-anyway"
fi
wait_for_snapshot_text "Browser preview is limited" 90
snapshot_step "01c-preview-warning"
record_pass "Browser preview opened and warning banner confirmed"

CURRENT_STEP="navigation"
scroll_main_top
click_pattern_nth 'button "Settings"' 1
snapshot_step "02-settings"
click_pattern_nth 'button "Open quick settings"' 1
snapshot_step "03-quick-settings"
click_pattern_nth 'button "Open Advanced' 1
wait_for_snapshot_text "Execution Profiles" 90
snapshot_step "04-advanced"
rg -F -q 'Execution Profiles' "$LAST_SNAPSHOT"
rg -F -q 'Role routing' "$LAST_SNAPSHOT"
click_pattern_nth 'button "Open quick settings"' 1
snapshot_step "05-quick-settings-again"
click_pattern_nth 'button "Open Essentials' 1
wait_for_snapshot_text "Runtime mode" 90
snapshot_step "06-essentials"
record_pass "Settings navigation and quick-settings deep links reached Essentials and Advanced"

CURRENT_STEP="essentials-baseline"
api_get_to "/api/v1/settings" "$OUT_DIR/essentials-baseline.json"
api_get_to "/api/v1/providers" "$OUT_DIR/providers-baseline.json"
assert_jq_eq "$OUT_DIR/essentials-baseline.json" '.items.runtimeMode' 'openai_api'
assert_jq_eq "$OUT_DIR/providers-baseline.json" '.activeProvider' 'openai-responses'
assert_jq_eq "$OUT_DIR/essentials-baseline.json" '.items.openAiResponses.apiKeySource' 'env'
assert_jq_test "$OUT_DIR/essentials-baseline.json" '.items.openAiResponses.hasApiKey == true'
rg -F -q 'OpenAI API active' "$LAST_SNAPSHOT"
rg -F -q 'env provided' "$LAST_SNAPSHOT"
rg -F -q 'Local runtime summary' "$LAST_SNAPSHOT"
rg -F -q 'No Qwen CLI accounts configured.' "$LAST_SNAPSHOT"
record_pass "Essentials baseline shows OpenAI-active runtime, redacted env-backed key, local runtime summary, and empty optional Qwen account state"

CURRENT_STEP="runtime-toggle-local"
click_pattern_nth 'button "Restore Local Qwen"' 1
wait_for_api_expression "/api/v1/settings" '.items.runtimeMode == "local_qwen" and .items.modelRoles.utility_fast.providerId == "onprem-qwen" and .items.modelRoles.coder_default.providerId == "onprem-qwen" and .items.modelRoles.review_deep.providerId == "onprem-qwen" and .items.modelRoles.overseer_escalation.providerId == "openai-responses"' 90 "$OUT_DIR/runtime-local.json"
api_get_to "/api/v1/providers" "$OUT_DIR/runtime-local-providers.json"
assert_jq_eq "$OUT_DIR/runtime-local-providers.json" '.activeProvider' 'onprem-qwen'
snapshot_step "07-runtime-local"
record_pass "Essentials runtime toggle restored Local Qwen defaults while preserving OpenAI escalation routing"

CURRENT_STEP="runtime-toggle-openai"
click_pattern_nth 'button "Use OpenAI for all roles"' 1
wait_for_api_expression "/api/v1/settings" '.items.runtimeMode == "openai_api" and .items.modelRoles.utility_fast.providerId == "openai-responses" and .items.modelRoles.coder_default.providerId == "openai-responses" and .items.modelRoles.review_deep.providerId == "openai-responses" and .items.modelRoles.overseer_escalation.providerId == "openai-responses"' 90 "$OUT_DIR/runtime-openai.json"
api_get_to "/api/v1/providers" "$OUT_DIR/runtime-openai-providers.json"
assert_jq_eq "$OUT_DIR/runtime-openai-providers.json" '.activeProvider' 'openai-responses'
snapshot_step "08-runtime-openai"
record_pass "Essentials runtime toggle restored OpenAI-all routing and active provider"

CURRENT_STEP="openai-key-flow"
INVALID_OPENAI_KEY="sk-settings-openai-invalid-${RANDOM_HEX}"
fill_pattern_nth 'textbox "API key"' "$INVALID_OPENAI_KEY" 1
snapshot_step "09-key-draft"
click_pattern_nth 'button "Save key"' 1
wait_for_api_expression "/api/v1/settings" '.items.openAiResponses.apiKeySource == "stored" and .items.openAiResponses.hasApiKey == true' 90 "$OUT_DIR/openai-key-saved.json"
assert_file_not_contains "$OUT_DIR/openai-key-saved.json" "$INVALID_OPENAI_KEY"
assert_jq_test "$OUT_DIR/openai-key-saved.json" '.items.openAiResponses | has("apiKey") | not'
click_pattern_nth 'button "Refresh models"' 1
sleep 3
api_get_to "/api/v1/openai/models" "$OUT_DIR/openai-models-invalid-key.json"
assert_jq_test "$OUT_DIR/openai-models-invalid-key.json" '(.items | length) == 0 and (.error | type == "string") and (.error | length > 0)'
click_pattern_nth 'button "Clear draft"' 1
snapshot_step "10-key-stored-draft-cleared"
click_pattern_nth 'button "Clear saved key"' 1
wait_for_api_expression "/api/v1/settings" '.items.openAiResponses.apiKeySource == "env" and .items.openAiResponses.hasApiKey == true' 90 "$OUT_DIR/openai-key-restored.json"
api_get_to "/api/v1/openai/models" "$OUT_DIR/openai-models-env.json"
assert_jq_test "$OUT_DIR/openai-models-env.json" '(.items | length) > 0'

DRAFT_KEY="sk-settings-openai-draft-${RANDOM_HEX}"
fill_pattern_nth 'textbox "API key"' "$DRAFT_KEY" 1
snapshot_step "11-key-draft-filled"
click_pattern_nth 'button "Clear draft"' 1
snapshot_step "12-key-draft-cleared"
rg -F -q '/placeholder: Saved in backend. Enter a new key to rotate it.' "$LAST_SNAPSHOT"
rg -F -q 'button "Save key" [disabled]' "$LAST_SNAPSHOT"
rg -F -q 'button "Clear saved key"' "$LAST_SNAPSHOT"
record_pass "OpenAI key draft/save/clear/refresh flow persisted source transitions and preserved redaction"

CURRENT_STEP="approval-toggles"
uncheck_pattern_nth 'checkbox "requireApprovalForDestructiveOps"' 1
uncheck_pattern_nth 'checkbox "requireApprovalForProviderChanges"' 1
uncheck_pattern_nth 'checkbox "requireApprovalForCodeApply"' 1
wait_for_api_expression "/api/v1/settings" '.items.safety.requireApprovalForDestructiveOps == false and .items.safety.requireApprovalForProviderChanges == false and .items.safety.requireApprovalForCodeApply == false' 90 "$OUT_DIR/safety-disabled.json"
PROVIDER_SWITCH_BODY="$(jq -n '{providerId:"onprem-qwen"}')"
api_post_to "/api/v1/providers/active" "$PROVIDER_SWITCH_BODY" "$OUT_DIR/provider-switch-unapproved.json"
assert_jq_test "$OUT_DIR/provider-switch-unapproved.json" '.ok == true and (.requiresApproval | not)'

check_pattern_nth 'checkbox "requireApprovalForDestructiveOps"' 1
check_pattern_nth 'checkbox "requireApprovalForProviderChanges"' 1
check_pattern_nth 'checkbox "requireApprovalForCodeApply"' 1
wait_for_api_expression "/api/v1/settings" '.items.safety.requireApprovalForDestructiveOps == true and .items.safety.requireApprovalForProviderChanges == true and .items.safety.requireApprovalForCodeApply == true' 90 "$OUT_DIR/safety-enabled.json"
PROVIDER_SWITCH_BODY_BACK="$(jq -n '{providerId:"openai-responses"}')"
api_post_to "/api/v1/providers/active" "$PROVIDER_SWITCH_BODY_BACK" "$OUT_DIR/provider-switch-approval.json"
assert_jq_test "$OUT_DIR/provider-switch-approval.json" '.ok == true and .requiresApproval == true and (.approvalId | type == "string")'
record_pass "Approval toggles persisted and provider change policy produced both direct and approval-required outcomes"

CURRENT_STEP="reopen-advanced"
scroll_main_top
click_pattern_nth 'button "Open Advanced' 1
wait_for_snapshot_text "Execution Profiles" 90
snapshot_step "12-advanced-reopened"

CURRENT_STEP="labs-toggle"
check_pattern_nth 'checkbox "Show Labs"' 1
wait_for_snapshot_text "Benchmarks + internal tools" 90
snapshot_step "13-labs-enabled"
rg -F -q 'Distillation' "$LAST_SNAPSHOT"
record_pass "Developer Labs checkbox revealed the hidden Labs panels"

CURRENT_STEP="execution-profiles"
click_pattern_nth 'button "Deep Scope ' 1
wait_for_api_expression "/api/v1/settings" '.items.executionProfiles.activeProfileId == "deep_scope"' 90 "$OUT_DIR/profile-deep-scope.json"
click_pattern_nth 'button "Build Heavy ' 1
wait_for_api_expression "/api/v1/settings" '.items.executionProfiles.activeProfileId == "build_heavy"' 90 "$OUT_DIR/profile-build-heavy.json"
click_pattern_nth 'button "Balanced ' 1
wait_for_api_expression "/api/v1/settings" '.items.executionProfiles.activeProfileId == "balanced"' 90 "$OUT_DIR/profile-balanced.json"
select_pattern_nth 'combobox "scope"' 'review_deep' 1
select_pattern_nth 'combobox "build"' 'utility_fast' 1
select_pattern_nth 'combobox "review"' 'overseer_escalation' 1
select_pattern_nth 'combobox "escalate"' 'coder_default' 1
click_pattern_nth 'button "Use Custom"' 1
wait_for_api_expression "/api/v1/settings" '.items.executionProfiles.activeProfileId == "custom" and (.items.executionProfiles.profiles[] | select(.id == "custom") | .stages.scope == "review_deep" and .stages.build == "utility_fast" and .stages.review == "overseer_escalation" and .stages.escalate == "coder_default")' 90 "$OUT_DIR/profile-custom.json"
snapshot_step "14-execution-profiles"
record_pass "Execution profile presets and every Custom stage mapping persisted through the UI"

CURRENT_STEP="role-routing"
click_pattern_nth 'button "Apply recommended OpenAI roles"' 1
wait_for_api_expression "/api/v1/settings" '.items.modelRoles.utility_fast.providerId == "openai-responses" and .items.modelRoles.coder_default.providerId == "openai-responses" and .items.modelRoles.review_deep.providerId == "openai-responses" and .items.modelRoles.overseer_escalation.providerId == "openai-responses"' 90 "$OUT_DIR/roles-openai-recommended.json"
click_pattern_nth 'button "Apply hybrid recommended"' 1
wait_for_api_expression "/api/v1/settings" '.items.modelRoles.utility_fast.providerId == "onprem-qwen" and .items.modelRoles.coder_default.providerId == "openai-responses" and .items.modelRoles.review_deep.providerId == "openai-responses" and .items.modelRoles.overseer_escalation.providerId == "openai-responses"' 90 "$OUT_DIR/roles-hybrid-recommended.json"

MANUAL_ROLE_PATCH="$(jq -n \
  --arg buildModel "$BUILD_MODEL" \
  --arg reviewModel "$REVIEW_MODEL" \
  --arg escalationModel "$ESCALATION_MODEL" \
  '{
    modelRoles: {
      utility_fast: {
        role: "utility_fast",
        providerId: "onprem-qwen",
        pluginId: "qwen3.5-0.8b",
        model: "Qwen/Qwen3.5-0.8B",
        temperature: 0.1,
        maxTokens: 900,
        reasoningMode: "off"
      },
      coder_default: {
        role: "coder_default",
        providerId: "openai-responses",
        pluginId: null,
        model: $buildModel,
        temperature: 0.1,
        maxTokens: 1800,
        reasoningMode: "auto"
      },
      review_deep: {
        role: "review_deep",
        providerId: "openai-responses",
        pluginId: null,
        model: $reviewModel,
        temperature: 0.05,
        maxTokens: 2200,
        reasoningMode: "on"
      },
      overseer_escalation: {
        role: "overseer_escalation",
        providerId: "openai-responses",
        pluginId: null,
        model: $escalationModel,
        temperature: 0.05,
        maxTokens: 2400,
        reasoningMode: "on"
      }
    }
  }')"
api_patch_to "/api/v1/settings" "$MANUAL_ROLE_PATCH" "$OUT_DIR/roles-manual-patch.json"
ROLE_ROUTING_EXPR=".items.modelRoles.utility_fast.providerId == \"onprem-qwen\" and .items.modelRoles.utility_fast.pluginId == \"qwen3.5-0.8b\" and .items.modelRoles.coder_default.providerId == \"openai-responses\" and .items.modelRoles.coder_default.model == \"$BUILD_MODEL\" and .items.modelRoles.review_deep.providerId == \"openai-responses\" and .items.modelRoles.review_deep.model == \"$REVIEW_MODEL\" and .items.modelRoles.overseer_escalation.providerId == \"openai-responses\" and .items.modelRoles.overseer_escalation.model == \"$ESCALATION_MODEL\""
wait_for_api_expression "/api/v1/settings" "$ROLE_ROUTING_EXPR" 90 "$OUT_DIR/roles-manual.json"
snapshot_step "15-role-routing"
record_pass "Role routing handled OpenAI recommended, hybrid recommended, and manual provider/model/thinking overrides"

CURRENT_STEP="role-routing-smoke"
SMOKE_SESSION_BODY="$(jq -n --arg title "Settings OpenAI Routing Smoke" '{title:$title}')"
api_post_to "/api/v1/chat/sessions" "$SMOKE_SESSION_BODY" "$OUT_DIR/smoke-session.json"
SMOKE_SESSION_ID="$(jq -r '.item.id' "$OUT_DIR/smoke-session.json")"
SMOKE_MESSAGE_BODY="$(jq -n --arg content "Reply with exactly SETTINGS_ROUTE_OK" '{content:$content, modelRole:"coder_default"}')"
api_post_to "/api/v1/chat/sessions/${SMOKE_SESSION_ID}/messages" "$SMOKE_MESSAGE_BODY" "$OUT_DIR/smoke-message.json"
wait_for_assistant_message "$SMOKE_SESSION_ID" "$OUT_DIR/smoke-messages.json" 120
assert_jq_test "$OUT_DIR/smoke-messages.json" '.items | any(.role == "assistant" and (.content | tostring | contains("SETTINGS_ROUTE_OK")) and .metadata.providerId == "openai-responses" and .metadata.modelRole == "coder_default")'
api_get_to "/api/v3/providers/openai/budget" "$OUT_DIR/openai-budget-after-smoke.json"
assert_jq_test "$OUT_DIR/openai-budget-after-smoke.json" '.item.requestCount >= 1'
record_note "Runtime smoke asserts provider/modelRole metadata from assistant messages. Model ids are asserted at the settings layer because the current runtime APIs do not expose the concrete model id per chat turn."
record_pass "OpenAI-routed smoke chat used the manual coder_default binding and updated provider budget telemetry"

CURRENT_STEP="openai-model-budget-ui"
select_pattern_nth 'combobox "Model"' "$GLOBAL_MODEL" 5
fill_pattern_nth 'textbox "Daily budget"' '0.45' 1
fill_pattern_nth 'textbox "Per-run budget"' '0.15' 1
wait_for_api_expression "/api/v1/settings" ".items.openAiResponses.model == \"$GLOBAL_MODEL\" and (.items.openAiResponses.dailyBudgetUsd | tostring) == \"0.45\" and (.items.openAiResponses.perRunBudgetUsd | tostring) == \"0.15\"" 90 "$OUT_DIR/openai-budget-ui.json"
api_get_to "/api/v3/providers/openai/budget" "$OUT_DIR/openai-budget-ui-route.json"
assert_jq_test "$OUT_DIR/openai-budget-ui-route.json" '.item.dailyBudgetUsd == 0.45'
record_pass "Advanced OpenAI global model and budget controls stayed consistent with the budget route"

CURRENT_STEP="runtime-controls-ui"
scroll_main_middle
snapshot_step "16-runtime-controls"
rg -F -q 'Default local model' "$LAST_SNAPSHOT"
rg -F -q 'Local role runtimes' "$LAST_SNAPSHOT"
rg -F -q 'On-prem backend' "$LAST_SNAPSHOT"
rg -F -q 'Parallel runtime' "$LAST_SNAPSHOT"
rg -F -q 'Qwen CLI runtime' "$LAST_SNAPSHOT"
select_pattern_nth 'combobox "Plugin"' 'qwen3.5-0.8b' 1
wait_for_api_expression "/api/v1/settings" '.items.onPremQwen.pluginId == "qwen3.5-0.8b"' 90 "$OUT_DIR/onprem-plugin-switched.json"
record_pass "Advanced runtime controls exposed default local model and plugin switching"

CURRENT_STEP="runtime-controls-api"
api_get_to "/api/v1/settings" "$OUT_DIR/runtime-controls-settings-before.json"
CURRENT_BACKEND_ID="$(jq -r '.items.onPremQwen.inferenceBackendId' "$OUT_DIR/runtime-controls-settings-before.json")"
api_get_to "/api/v2/inference/backends" "$OUT_DIR/onprem-backends.json"
ALT_BACKEND_ID="$(jq -r --arg current "$CURRENT_BACKEND_ID" '.items[] | select(.id != $current) | .id' "$OUT_DIR/onprem-backends.json" | head -n 1)"
if [[ -z "$ALT_BACKEND_ID" ]]; then
  ALT_BACKEND_ID="$CURRENT_BACKEND_ID"
fi

BACKEND_SWITCH_ALT_BODY="$(jq -n --arg actor "user" --arg backend "$ALT_BACKEND_ID" '{actor:$actor, backend_id:$backend}')"
api_post_to "/api/v2/commands/inference.backend.switch" "$BACKEND_SWITCH_ALT_BODY" "$OUT_DIR/backend-switch-alt.json"
wait_for_api_expression "/api/v1/settings" ".items.onPremQwen.inferenceBackendId == \"$ALT_BACKEND_ID\"" 90 "$OUT_DIR/backend-switched-alt-settings.json"
BACKEND_SWITCH_BACK_BODY="$(jq -n --arg actor "user" --arg backend "$CURRENT_BACKEND_ID" '{actor:$actor, backend_id:$backend}')"
api_post_to "/api/v2/commands/inference.backend.switch" "$BACKEND_SWITCH_BACK_BODY" "$OUT_DIR/backend-switch-back.json"
wait_for_api_expression "/api/v1/settings" ".items.onPremQwen.inferenceBackendId == \"$CURRENT_BACKEND_ID\"" 90 "$OUT_DIR/backend-switched-back-settings.json"

AUTOTUNE_BODY="$(jq -n '{actor:"user", profile:"interactive", dry_run:true}')"
if optional_api_post "on-prem autotune" "/api/v2/commands/inference.autotune" "$AUTOTUNE_BODY" "$OUT_DIR/autotune.json"; then
  record_pass "Autotune command surface responded successfully"
fi

ROLE_RUNTIME_PATCH="$(jq -n --arg baseUrl "http://127.0.0.1:8001/v1" '{onPremQwenRoleRuntimes:{utility_fast:{enabled:true,baseUrl:$baseUrl,inferenceBackendId:"mlx-lm",pluginId:"qwen3.5-0.8b",model:"Qwen/Qwen3.5-0.8B",reasoningMode:"off",timeoutMs:120000,temperature:0.1,maxTokens:900}}}')"
api_patch_to "/api/v1/settings" "$ROLE_RUNTIME_PATCH" "$OUT_DIR/role-runtime-patch.json"
wait_for_api_expression "/api/v1/settings" '.items.onPremQwenRoleRuntimes.utility_fast.enabled == true and .items.onPremQwenRoleRuntimes.utility_fast.pluginId == "qwen3.5-0.8b"' 90 "$OUT_DIR/role-runtime-settings.json"

ROLE_RUNTIME_BODY="$(jq -n '{actor:"user", role:"utility_fast"}')"
if optional_api_post "role-runtime test" "/api/v1/providers/onprem/role-runtimes/test" "$ROLE_RUNTIME_BODY" "$OUT_DIR/role-runtime-test.json"; then
  record_pass "Dedicated utility_fast role runtime test endpoint responded"
fi
if optional_api_post "role-runtime start" "/api/v1/providers/onprem/role-runtimes/start" "$ROLE_RUNTIME_BODY" "$OUT_DIR/role-runtime-start.json"; then
  record_pass "Dedicated utility_fast role runtime start endpoint responded"
fi
if optional_api_post "role-runtime stop" "/api/v1/providers/onprem/role-runtimes/stop" "$ROLE_RUNTIME_BODY" "$OUT_DIR/role-runtime-stop.json"; then
  record_pass "Dedicated utility_fast role runtime stop endpoint responded"
fi

BACKEND_START_BODY="$(jq -n --arg actor "user" --arg backend "$CURRENT_BACKEND_ID" '{actor:$actor, backend_id:$backend}')"
if optional_api_post "backend start" "/api/v2/commands/inference.backend.start" "$BACKEND_START_BODY" "$OUT_DIR/backend-start.json"; then
  record_pass "On-prem backend start endpoint responded"
fi
if optional_api_post "backend stop" "/api/v2/commands/inference.backend.stop" "$BACKEND_START_BODY" "$OUT_DIR/backend-stop.json"; then
  record_pass "On-prem backend stop endpoint responded"
fi

fill_pattern_nth 'textbox "Command"' 'qwen-e2e' 1
fill_pattern_nth 'textbox "Args"' 'chat --prompt --json' 1
wait_for_api_expression "/api/v1/settings" '.items.qwenCli.command == "qwen-e2e" and (.items.qwenCli.args | join(" ")) == "chat --prompt --json"' 90 "$OUT_DIR/qwen-cli-settings.json"
record_pass "Qwen CLI command and args persisted through the advanced settings UI"

CURRENT_STEP="numeric-coercion"
fill_pattern_nth 'textbox "Daily budget"' '' 1
wait_for_api_expression "/api/v1/settings" '.items.openAiResponses.dailyBudgetUsd == 0' 90 "$OUT_DIR/daily-budget-zero.json"
fill_pattern_nth 'textbox "Max local lanes"' 'abc' 1
fill_pattern_nth 'textbox "Lease minutes"' '' 1
wait_for_api_expression "/api/v1/settings" '.items.parallelRuntime.maxLocalLanes == 0 and .items.parallelRuntime.defaultLaneLeaseMinutes == 0' 90 "$OUT_DIR/parallel-runtime-zero.json"
NUMERIC_RESTORE_BODY="$(jq -n '{openAiResponses:{dailyBudgetUsd:0.45,perRunBudgetUsd:0.15},parallelRuntime:{maxLocalLanes:4,defaultLaneLeaseMinutes:20}}')"
api_patch_to "/api/v1/settings" "$NUMERIC_RESTORE_BODY" "$OUT_DIR/numeric-restore.json"
wait_for_api_expression "/api/v1/settings" '.items.openAiResponses.dailyBudgetUsd == 0.45 and .items.parallelRuntime.maxLocalLanes == 4 and .items.parallelRuntime.defaultLaneLeaseMinutes == 20' 90 "$OUT_DIR/numeric-restored-settings.json"
record_pass "Blank and non-numeric numeric edits coerced to zero without crashing and were restored afterward"

CURRENT_STEP="channels-ui"
scroll_main_bottom
snapshot_step "17-bottom-sections"
rg -F -q 'Channels + automations' "$LAST_SNAPSHOT"
rg -F -q 'Recent channel activity' "$LAST_SNAPSHOT"
check_pattern_nth 'checkbox "Enable channels"' 1
snapshot_step "17a-channels-enabled"
check_pattern_nth 'checkbox "Allow remote approvals"' 1
snapshot_step "17b-channels-remote-approvals"
check_pattern_nth 'checkbox "Allow unattended read-only delivery"' 1
snapshot_step "17c-channels-unattended"
check_pattern_nth 'checkbox "Webhook source enabled"' 1
snapshot_step "17d-channels-webhook"
check_pattern_nth 'checkbox "Telegram relay enabled"' 1
snapshot_step "17e-channels-telegram"
check_pattern_nth 'checkbox "CI / monitoring source enabled"' 1
snapshot_step "17f-channels-ci"
fill_pattern_nth 'textbox "Default project id"' "$FIXTURE_REPO_ID" 1
fill_pattern_nth 'textbox "Default session id"' "$CHANNEL_SESSION_ID" 1
fill_pattern_nth 'textbox "Sender allowlist"' 'ops-bot,tele-bot,ci-main' 1

WEBHOOK_SECRET="whsec-${RANDOM_HEX}"
TELEGRAM_SECRET="tgsec-${RANDOM_HEX}"
CI_SECRET="cisecret-${RANDOM_HEX}"
fill_pattern_nth 'textbox "Secret"' "$WEBHOOK_SECRET" 1
snapshot_step "17g-channels-webhook-secret"
click_pattern_nth 'button "Save"' 1
snapshot_step "17h-channels-webhook-saved"
fill_pattern_nth 'textbox "Secret"' "$TELEGRAM_SECRET" 2
snapshot_step "17i-channels-telegram-secret"
click_pattern_nth 'button "Save"' 2
snapshot_step "17j-channels-telegram-saved"
fill_pattern_nth 'textbox "Secret"' "$CI_SECRET" 3
snapshot_step "17k-channels-ci-secret"
click_pattern_nth 'button "Save"' 3
wait_for_api_expression "/api/v1/settings" '.items.experimentalChannels.enabled == true and .items.experimentalChannels.allowRemoteApprovals == true and .items.experimentalChannels.allowUnattendedReadOnly == true and .items.experimentalChannels.webhook.enabled == true and .items.experimentalChannels.telegram.enabled == true and .items.experimentalChannels.ciMonitoring.enabled == true and .items.experimentalChannels.defaultProjectId != null and .items.experimentalChannels.defaultSessionId != null and .items.experimentalChannels.webhook.hasSigningSecret == true and .items.experimentalChannels.telegram.hasSigningSecret == true and .items.experimentalChannels.ciMonitoring.hasSigningSecret == true' 90 "$OUT_DIR/channels-settings.json"
assert_file_not_contains "$OUT_DIR/channels-settings.json" "$WEBHOOK_SECRET"
assert_file_not_contains "$OUT_DIR/channels-settings.json" "$TELEGRAM_SECRET"
assert_file_not_contains "$OUT_DIR/channels-settings.json" "$CI_SECRET"
record_pass "Channels master/child flags, defaults, allowlist, and signing secret redaction all persisted"

CURRENT_STEP="channels-events"
WEBHOOK_EVENT_BODY="$(jq -n --arg repoId "$FIXTURE_REPO_ID" --arg sessionId "$CHANNEL_SESSION_ID" '{source:"webhook", sender_id:"ops-bot", content:"settings webhook event", project_id:$repoId, session_id:$sessionId, reply_supported:true}')"
TELEGRAM_EVENT_BODY="$(jq -n --arg repoId "$FIXTURE_REPO_ID" --arg sessionId "$CHANNEL_SESSION_ID" '{source:"telegram", sender_id:"tele-bot", content:"settings telegram event", project_id:$repoId, session_id:$sessionId, reply_supported:true}')"
CI_EVENT_BODY="$(jq -n --arg repoId "$FIXTURE_REPO_ID" --arg sessionId "$CHANNEL_SESSION_ID" '{source:"ci_monitoring", sender_id:"ci-main", content:"ci failing build regression for settings suite", project_id:$repoId, session_id:$sessionId, reply_supported:false}')"

curl -sS -o "$OUT_DIR/channel-event-webhook.json" -w '%{http_code}' -X POST "$API_BASE_URL/api/v1/experimental/channels/events" -H 'content-type: application/json' -H "x-local-api-token: $API_TOKEN" -H "x-channel-secret: $WEBHOOK_SECRET" -d "$WEBHOOK_EVENT_BODY" > "$OUT_DIR/channel-event-webhook.status"
WEBHOOK_EVENT_STATUS="$(cat "$OUT_DIR/channel-event-webhook.status")"
[[ "$WEBHOOK_EVENT_STATUS" == "200" ]]
curl -sS -o "$OUT_DIR/channel-event-telegram.json" -w '%{http_code}' -X POST "$API_BASE_URL/api/v1/experimental/channels/events" -H 'content-type: application/json' -H "x-local-api-token: $API_TOKEN" -H "x-channel-secret: $TELEGRAM_SECRET" -d "$TELEGRAM_EVENT_BODY" > "$OUT_DIR/channel-event-telegram.status"
TELEGRAM_EVENT_STATUS="$(cat "$OUT_DIR/channel-event-telegram.status")"
[[ "$TELEGRAM_EVENT_STATUS" == "200" ]]
curl -sS -o "$OUT_DIR/channel-event-ci.json" -w '%{http_code}' -X POST "$API_BASE_URL/api/v1/experimental/channels/events" -H 'content-type: application/json' -H "x-local-api-token: $API_TOKEN" -H "x-channel-secret: $CI_SECRET" -d "$CI_EVENT_BODY" > "$OUT_DIR/channel-event-ci.status"
CI_EVENT_STATUS="$(cat "$OUT_DIR/channel-event-ci.status")"
[[ "$CI_EVENT_STATUS" == "200" ]]

api_get_to "/api/v1/experimental/channels/activity?projectId=${FIXTURE_REPO_ID}" "$OUT_DIR/channel-activity.json"
assert_jq_test "$OUT_DIR/channel-activity.json" '(.items.channels | length) >= 3 and (.items.subagents | length) >= 2'
record_pass "Synthetic webhook, telegram, and CI ingress updated recent channel activity"

CURRENT_STEP="labs-distill-ui"
fill_pattern_nth 'textbox "Teacher command"' 'echo settings-teacher' 1
fill_pattern_nth 'textbox "Teacher model"' 'gpt-5-nano' 1
fill_pattern_nth 'textbox "Objective split"' '50/30/20' 1
fill_pattern_nth 'textbox "Privacy policy"' 'settings-openai-e2e' 1
fill_pattern_nth 'textbox "Teacher RPM"' '7' 1
fill_pattern_nth 'textbox "Daily tokens"' '123456' 1
wait_for_api_expression "/api/v1/settings" '.items.distill.teacherCommand == "echo settings-teacher" and .items.distill.teacherModel == "gpt-5-nano" and .items.distill.objectiveSplit == "50/30/20" and .items.distill.privacyPolicyVersion == "settings-openai-e2e" and .items.distill.teacherRateLimit.maxRequestsPerMinute == 7 and .items.distill.teacherRateLimit.dailyTokenBudget == 123456' 90 "$OUT_DIR/labs-distill-ui.json"
record_pass "Visible Labs distillation controls persisted through the UI"

CURRENT_STEP="api-only-openai-compatible"
OPENAI_COMPAT_VALID_BODY="$(jq -n --arg baseUrl "$VALID_COMPAT_BASE_URL" '{openAiCompatible:{baseUrl:$baseUrl,model:"mock-openai-compatible-small",timeoutMs:45000,temperature:0.15,maxTokens:800}}')"
api_patch_to "/api/v1/settings" "$OPENAI_COMPAT_VALID_BODY" "$OUT_DIR/openai-compatible-valid.json"
api_post_to "/api/v2/commands/provider.activate" "$(jq -n '{provider_id:"openai-compatible", actor:"user"}')" "$OUT_DIR/openai-compatible-activate-valid.json"
assert_jq_test "$OUT_DIR/openai-compatible-activate-valid.json" '.status != "rejected"'

OPENAI_COMPAT_INVALID_BODY="$(jq -n --arg baseUrl "$INVALID_BASE_URL" '{openAiCompatible:{baseUrl:$baseUrl,model:"mock-openai-compatible-small"}}')"
api_patch_to "/api/v1/settings" "$OPENAI_COMPAT_INVALID_BODY" "$OUT_DIR/openai-compatible-invalid.json"
api_post_to "/api/v2/commands/provider.activate" "$(jq -n '{provider_id:"openai-compatible", actor:"user"}')" "$OUT_DIR/openai-compatible-activate-invalid.json"
assert_jq_test "$OUT_DIR/openai-compatible-activate-invalid.json" '.status == "rejected"'
record_pass "API-only openAiCompatible settings were consumed by provider health activation"

CURRENT_STEP="api-only-openai-responses"
OPENAI_RESPONSES_PATCH="$(jq -n '{openAiResponses:{timeoutMs:91000,reasoningEffort:"high",toolPolicy:{enableFileSearch:true,enableRemoteMcp:true}}}')"
api_patch_to "/api/v1/settings" "$OPENAI_RESPONSES_PATCH" "$OUT_DIR/openai-responses-api-only.json"
wait_for_api_expression "/api/v1/settings" '.items.openAiResponses.timeoutMs == 91000 and .items.openAiResponses.reasoningEffort == "high" and .items.openAiResponses.toolPolicy.enableFileSearch == true and .items.openAiResponses.toolPolicy.enableRemoteMcp == true' 90 "$OUT_DIR/openai-responses-api-only-settings.json"

OPENAI_RESPONSES_INVALID_BASE_BODY="$(jq -n --arg baseUrl "$INVALID_BASE_URL" '{openAiResponses:{baseUrl:$baseUrl}}')"
api_patch_to "/api/v1/settings" "$OPENAI_RESPONSES_INVALID_BASE_BODY" "$OUT_DIR/openai-responses-invalid-base.json"
OPENAI_MODELS_STATUS="$(api_status_to GET "/api/v1/openai/models" "" "$OUT_DIR/openai-models-invalid-base.json")"
if [[ "$OPENAI_MODELS_STATUS" == "200" ]]; then
  assert_jq_test "$OUT_DIR/openai-models-invalid-base.json" '(.error | type == "string") and (.error | length > 0)'
else
  record_note "OpenAI models route returned HTTP ${OPENAI_MODELS_STATUS} for invalid base URL, which is acceptable for the negative-path assertion."
fi
OPENAI_RESPONSES_VALID_BASE_BODY="$(jq -n '{openAiResponses:{baseUrl:"https://api.openai.com/v1",timeoutMs:91000,reasoningEffort:"high",toolPolicy:{enableFileSearch:true,enableRemoteMcp:true},dailyBudgetUsd:0.45,perRunBudgetUsd:0.15}}')"
api_patch_to "/api/v1/settings" "$OPENAI_RESPONSES_VALID_BASE_BODY" "$OUT_DIR/openai-responses-valid-base.json"
api_get_to "/api/v1/openai/models" "$OUT_DIR/openai-models-restored-base.json"
assert_jq_test "$OUT_DIR/openai-models-restored-base.json" '(.items | length) > 0'
record_pass "API-only OpenAI Responses fields persisted, and invalid base URLs failed cleanly without breaking recovery"

CURRENT_STEP="api-only-parallel-runtime"
PARALLEL_RUNTIME_PATCH="$(jq -n '{parallelRuntime:{heartbeatIntervalSeconds:17,reservationTtlSeconds:3210}}')"
api_patch_to "/api/v1/settings" "$PARALLEL_RUNTIME_PATCH" "$OUT_DIR/parallel-runtime-api-only.json"
wait_for_api_expression "/api/v1/settings" '.items.parallelRuntime.heartbeatIntervalSeconds == 17 and .items.parallelRuntime.reservationTtlSeconds == 3210' 90 "$OUT_DIR/parallel-runtime-api-only-settings.json"
record_pass "API-only parallel runtime lease internals persisted"

CURRENT_STEP="api-only-distill"
DISTILL_API_PATCH="$(jq -n '{distill:{teacherTimeoutMs:33000,teacherRateLimit:{maxConcurrentTeacherJobs:4,retryBackoffMs:2500,maxRetries:5},trainer:{backend:"hf-lora-local",pythonCommand:"python3",maxSteps:28,perDeviceBatchSize:2,gradientAccumulationSteps:6,learningRate:0.0003,loraRank:12,loraAlpha:24,maxSeqLength:1536,orpoBeta:0.2,toolRewardScale:0.75}}}')"
api_patch_to "/api/v1/settings" "$DISTILL_API_PATCH" "$OUT_DIR/distill-api-only.json"
wait_for_api_expression "/api/v1/settings" '.items.distill.teacherTimeoutMs == 33000 and .items.distill.teacherRateLimit.maxConcurrentTeacherJobs == 4 and .items.distill.teacherRateLimit.retryBackoffMs == 2500 and .items.distill.teacherRateLimit.maxRetries == 5 and .items.distill.trainer.maxSteps == 28 and .items.distill.trainer.perDeviceBatchSize == 2 and .items.distill.trainer.gradientAccumulationSteps == 6 and .items.distill.trainer.learningRate == 0.0003 and .items.distill.trainer.loraRank == 12 and .items.distill.trainer.loraAlpha == 24 and .items.distill.trainer.maxSeqLength == 1536 and .items.distill.trainer.orpoBeta == 0.2 and .items.distill.trainer.toolRewardScale == 0.75' 90 "$OUT_DIR/distill-api-only-settings.json"
record_pass "API-only distillation trainer and teacher-rate-limit fields persisted"

CURRENT_STEP="budget-exhaustion"
BUDGET_RESET_BODY="$(jq -n '{openAiResponses:{baseUrl:"https://api.openai.com/v1",dailyBudgetUsd:0.45,perRunBudgetUsd:0.15}}')"
api_patch_to "/api/v1/settings" "$BUDGET_RESET_BODY" "$OUT_DIR/budget-reset-before-exhaustion.json"
"${HELPER[@]}" seed-budget --mode exhausted --used-usd 0.45 --output "$OUT_DIR/budget-seeded-exhausted.json"
EXHAUSTED_SESSION_BODY="$(jq -n --arg title "Settings OpenAI Budget Exhaustion" '{title:$title}')"
api_post_to "/api/v1/chat/sessions" "$EXHAUSTED_SESSION_BODY" "$OUT_DIR/budget-session.json"
EXHAUSTED_SESSION_ID="$(jq -r '.item.id' "$OUT_DIR/budget-session.json")"
EXHAUSTED_MESSAGE_BODY="$(jq -n --arg content "Budget exhaustion smoke request" '{content:$content, modelRole:"coder_default"}')"
api_post_to "/api/v1/chat/sessions/${EXHAUSTED_SESSION_ID}/messages" "$EXHAUSTED_MESSAGE_BODY" "$OUT_DIR/budget-message.json"
"${HELPER[@]}" wait-chat-failure --session-id "$EXHAUSTED_SESSION_ID" --timeout-ms 90000 --output "$OUT_DIR/budget-chat-failure.json"
assert_jq_test "$OUT_DIR/budget-chat-failure.json" '.found == true and .event.eventType == "chat.turn_failed" and (.event.payload.message | type == "string") and (.event.payload.message | length > 0)'
"${HELPER[@]}" seed-budget --mode clear --output "$OUT_DIR/budget-cleared.json"
record_pass "Seeded budget exhaustion blocked OpenAI-routed work until the budget projection was cleared"

CURRENT_STEP="approval-relay"
APPROVAL_RELAY_BODY="$(jq -n --arg approvalId "$FIXTURE_APPROVAL_ID" '{source:"webhook", sender_id:"ops-bot", replay_id:"settings-openai-relay-1", approval_id:$approvalId, decision:"approved"}')"
curl -sS -o "$OUT_DIR/approval-relay.json" -w '%{http_code}' -X POST "$API_BASE_URL/api/v1/experimental/channels/approval/relay" -H 'content-type: application/json' -H "x-local-api-token: $API_TOKEN" -H "x-channel-secret: $WEBHOOK_SECRET" -d "$APPROVAL_RELAY_BODY" > "$OUT_DIR/approval-relay.status"
APPROVAL_RELAY_STATUS="$(cat "$OUT_DIR/approval-relay.status")"
if [[ "$APPROVAL_RELAY_STATUS" != "200" ]]; then
  cat "$OUT_DIR/approval-relay.json" >&2 || true
  exit 1
fi
assert_jq_test "$OUT_DIR/approval-relay.json" '.item.status == "approved" and (.command_execution.toolEventId | type == "string") and .lifecycle_requeue.to == "in_progress"'
"${HELPER[@]}" inspect-approval --approval-id "$FIXTURE_APPROVAL_ID" --ticket-id "$FIXTURE_TICKET_ID" --run-id "$FIXTURE_RUN_ID" --output "$OUT_DIR/approval-relay-inspect.json"
assert_jq_test "$OUT_DIR/approval-relay-inspect.json" '.approval.status == "approved" and .ticket.status == "in_progress"'
record_pass "Remote approval relay updated approval state and requeued the ticket lifecycle with command follow-through"

CURRENT_STEP="final-snapshot"
scroll_main_top
snapshot_step "19-final"
record_pass "Final browser snapshot, screenshots, and logs captured"

CURRENT_STEP="done"
record_note "Artifacts include browser snapshots, screenshots, API assertions, setup/restore logs, and final summary files under output/playwright."
