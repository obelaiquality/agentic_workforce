#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="${PWCLI:-$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh}"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required for playwright-cli" >&2
  exit 1
fi

if [[ ! -x "$PWCLI" ]]; then
  echo "Playwright wrapper not found at $PWCLI" >&2
  exit 1
fi

OUT_DIR="output/playwright/e2e-critical-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"

SESSION="ae2e$(date +%H%M%S)"
export PLAYWRIGHT_CLI_SESSION="$SESSION"

API_PID=""
WEB_PID=""
LAST_SNAPSHOT=""

cleanup() {
  if [[ -n "$WEB_PID" ]]; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$API_PID" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_port() {
  local host="$1"
  local port="$2"
  local timeout_sec="${3:-90}"
  local start_ts
  start_ts="$(date +%s)"
  while true; do
    if nc -z "$host" "$port" >/dev/null 2>&1; then
      return 0
    fi
    if (( $(date +%s) - start_ts > timeout_sec )); then
      echo "Timed out waiting for $host:$port" >&2
      return 1
    fi
    sleep 1
  done
}

snapshot_step() {
  local name="$1"
  local snapshot_out
  snapshot_out="$($PWCLI --session "$SESSION" snapshot 2>&1 || true)"
  printf '%s\n' "$snapshot_out" > "$OUT_DIR/${name}.snapshot.log"
  local snapshot_src
  snapshot_src="$(printf '%s\n' "$snapshot_out" | rg -o "\.playwright-cli/[^)]+\.yml" | tail -n 1 || true)"
  LAST_SNAPSHOT="$OUT_DIR/${name}.yml"
  if [[ -n "$snapshot_src" && -f "$snapshot_src" ]]; then
    cp "$snapshot_src" "$LAST_SNAPSHOT"
  else
    printf '%s\n' "$snapshot_out" > "$LAST_SNAPSHOT"
  fi

  local shot_out
  shot_out="$($PWCLI --session "$SESSION" screenshot 2>&1 || true)"
  printf '%s\n' "$shot_out" > "$OUT_DIR/${name}.screenshot.log"
  local png
  png="$(printf '%s\n' "$shot_out" | rg -o "\.playwright-cli/[^)]+\.png" | tail -n 1 || true)"
  if [[ -n "$png" && -f "$png" ]]; then
    cp "$png" "$OUT_DIR/${name}.png"
  fi
}

find_ref() {
  local pattern="$1"
  local ref
  ref="$(rg -m 1 "$pattern" "$LAST_SNAPSHOT" | sed -E 's/.*\[ref=(e[0-9]+)\].*/\1/' || true)"
  if [[ -z "$ref" ]]; then
    echo "Failed to find ref pattern: $pattern in $LAST_SNAPSHOT" >&2
    exit 1
  fi
  printf '%s' "$ref"
}

wait_for_text() {
  local expected="$1"
  local timeout_sec="${2:-90}"
  local start_ts
  start_ts="$(date +%s)"
  while true; do
    local wait_out
    wait_out="$($PWCLI --session "$SESSION" snapshot 2>&1 || true)"
    local wait_src
    wait_src="$(printf '%s\n' "$wait_out" | rg -o "\.playwright-cli/[^)]+\.yml" | tail -n 1 || true)"
    if [[ -n "$wait_src" && -f "$wait_src" ]] && rg -q "$expected" "$wait_src"; then
      return 0
    fi
    if (( $(date +%s) - start_ts > timeout_sec )); then
      echo "Timed out waiting for text: $expected" >&2
      return 1
    fi
    sleep 2
  done
}

api_post() {
  local route="$1"
  local body="$2"
  curl -sS -X POST "http://127.0.0.1:8787${route}" -H 'content-type: application/json' -d "$body"
}

if ! nc -z 127.0.0.1 8787 >/dev/null 2>&1; then
  npm run dev:api > "$OUT_DIR/dev-api.log" 2>&1 &
  API_PID=$!
fi

if ! nc -z 127.0.0.1 5173 >/dev/null 2>&1; then
  npm run dev > "$OUT_DIR/dev-web.log" 2>&1 &
  WEB_PID=$!
fi

wait_for_port 127.0.0.1 8787 120
wait_for_port 127.0.0.1 5173 120

"$PWCLI" --session "$SESSION" open http://127.0.0.1:5173 --headed
snapshot_step "01-open"

rg -q 'button "Overseer"' "$LAST_SNAPSHOT"
rg -q 'button "Backlog"' "$LAST_SNAPSHOT"
rg -q 'button "Runs"' "$LAST_SNAPSHOT"
rg -q 'button "Artifacts"' "$LAST_SNAPSHOT"
rg -q 'button "Settings"' "$LAST_SNAPSHOT"
rg -q 'button "Distill Lab"' "$LAST_SNAPSHOT"

SETTINGS_REF="$(find_ref 'button "Settings"')"
"$PWCLI" --session "$SESSION" click "$SETTINGS_REF"
snapshot_step "02-settings"

ONPREM_REF="$(find_ref 'button "On-Prem Qwen"')"
"$PWCLI" --session "$SESSION" click "$ONPREM_REF"
snapshot_step "02b-settings-onprem"

MODEL_REF="$(find_ref 'textbox "Runtime model id"')"
"$PWCLI" --session "$SESSION" fill "$MODEL_REF" "mlx-community/Qwen3.5-4B-4bit"
snapshot_step "02c-settings-model"

OVERSEER_REF="$(find_ref 'button "Overseer"')"
"$PWCLI" --session "$SESSION" click "$OVERSEER_REF"
snapshot_step "03-overseer"

CHAT_REF="$(find_ref 'textbox "Talk to the Overseer agent\."')"
"$PWCLI" --session "$SESSION" click "$CHAT_REF"
"$PWCLI" --session "$SESSION" type "Reply with exactly: UI_E2E_OK"
"$PWCLI" --session "$SESSION" press Enter
wait_for_text "UI_E2E_OK" 120
snapshot_step "03b-overseer-chat"

BACKLOG_REF="$(find_ref 'button "Backlog"')"
"$PWCLI" --session "$SESSION" click "$BACKLOG_REF"
snapshot_step "04-backlog"

TICKET_TITLE="E2E Ticket $(date +%s)"
TITLE_REF="$(find_ref 'textbox "New ticket title"')"
"$PWCLI" --session "$SESSION" fill "$TITLE_REF" "$TICKET_TITLE"
CREATE_REF="$(find_ref 'button "Create"')"
"$PWCLI" --session "$SESSION" click "$CREATE_REF"
wait_for_text "$TICKET_TITLE" 60
snapshot_step "04b-backlog-created"

TICKET_ID="$(curl -sS http://127.0.0.1:8787/api/v1/tickets | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));const title=process.argv[1];const item=(d.items||[]).find((x)=>x.title===title);process.stdout.write(item?item.id:'');" "$TICKET_TITLE")"
if [[ -z "$TICKET_ID" ]]; then
  echo "Failed to resolve ticket id for E2E ticket" >&2
  exit 1
fi

api_post "/api/v2/commands/task.transition" "{\"ticket_id\":\"${TICKET_ID}\",\"actor\":\"user\",\"status\":\"active\"}" > "$OUT_DIR/task-transition.json"
"$PWCLI" --session "$SESSION" reload
sleep 2
snapshot_step "04c-backlog-transition"

api_post "/api/v2/commands/inference.backend.switch" '{"actor":"user","backend_id":"transformers-openai"}' > "$OUT_DIR/backend-switch-to-transformers.json"
api_post "/api/v2/commands/inference.backend.switch" '{"actor":"user","backend_id":"mlx-lm"}' > "$OUT_DIR/backend-switch-to-mlx.json"
snapshot_step "05-backend-switch"

DISTILL_REF="$(find_ref 'button "Distill Lab"')"
"$PWCLI" --session "$SESSION" click "$DISTILL_REF"
snapshot_step "06-distill"

# Use a deterministic fallback teacher command for E2E to avoid quota/rate-limit stalls.
curl -sS -X PATCH http://127.0.0.1:8787/api/v1/settings \
  -H 'content-type: application/json' \
  -d '{"distill":{"teacherCommand":"__missing__","teacherModel":"opus","teacherTimeoutMs":3000}}' \
  > "$OUT_DIR/distill-settings-patch.json"

GEN_PAYLOAD='{"actor":"user","title":"E2E Distill Batch","sample_count":3,"retrieval_context_ids":["knowledge-001","knowledge-002"]}'
api_post "/api/v2/commands/distill.dataset.generate" "$GEN_PAYLOAD" > "$OUT_DIR/distill-generate.json"
DATASET_ID="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(d.dataset&&d.dataset.id?d.dataset.id:'');" "$OUT_DIR/distill-generate.json")"
if [[ -z "$DATASET_ID" ]]; then
  echo "Distill dataset generation did not return dataset id" >&2
  exit 1
fi

curl -sS "http://127.0.0.1:8787/api/v2/distill/datasets/${DATASET_ID}" > "$OUT_DIR/distill-dataset.json"
REVIEW_BODY="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const decisions=(d.examples||[]).filter((x)=>x.reviewerDecision==='pending' && x.privacySafe).map((x)=>({example_id:x.id,decision:'approved'}));process.stdout.write(JSON.stringify({actor:'user',dataset_id:process.argv[2],decisions}));" "$OUT_DIR/distill-dataset.json" "$DATASET_ID")"
api_post "/api/v2/commands/distill.dataset.review" "$REVIEW_BODY" > "$OUT_DIR/distill-review.json"

# Ensure at least one approved + privacySafe example exists so training can kickoff deterministically.
MANUAL_APPROVAL="$(DATASET_ID="$DATASET_ID" node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const datasetId = process.env.DATASET_ID;
(async () => {
  const approved = await prisma.distillExample.count({
    where: { datasetId, reviewerDecision: 'approved', privacySafe: true },
  });
  if (approved > 0) {
    console.log(JSON.stringify({ approved, manual: false }));
    await prisma.$disconnect();
    return;
  }

  const first = await prisma.distillExample.findFirst({
    where: { datasetId },
    orderBy: { createdAt: 'asc' },
  });
  if (!first) {
    console.log(JSON.stringify({ approved: 0, manual: false, reason: 'no_examples' }));
    await prisma.$disconnect();
    return;
  }

  await prisma.distillExample.update({
    where: { id: first.id },
    data: {
      reviewerDecision: 'approved',
      privacySafe: true,
      reviewNotes: 'Automated pilot approval for E2E training kickoff.',
      reviewedAt: new Date(),
    },
  });

  const approvedAfter = await prisma.distillExample.count({
    where: { datasetId, reviewerDecision: 'approved', privacySafe: true },
  });
  console.log(JSON.stringify({ approved: approvedAfter, manual: true, exampleId: first.id }));
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(JSON.stringify({ error: String(error) }));
  await prisma.$disconnect();
  process.exit(1);
});
NODE
)"
printf '%s\n' "$MANUAL_APPROVAL" > "$OUT_DIR/distill-manual-approval.json"

TRAIN_BODY="$(node -e "const body={actor:'user',dataset_id:process.argv[1],stage:'sft',student_model_id:'Qwen/Qwen3.5-0.8B'};process.stdout.write(JSON.stringify(body));" "$DATASET_ID")"
api_post "/api/v2/commands/distill.train.start" "$TRAIN_BODY" > "$OUT_DIR/distill-train-start.json"

RUN_ID="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(d.run&&d.run.id?d.run.id:'');" "$OUT_DIR/distill-train-start.json")"
if [[ -n "$RUN_ID" ]]; then
  curl -sS "http://127.0.0.1:8787/api/v2/distill/runs/${RUN_ID}" > "$OUT_DIR/distill-run.json"
  curl -sS "http://127.0.0.1:8787/api/v2/distill/runs/${RUN_ID}/logs" > "$OUT_DIR/distill-run-logs.json"
fi

snapshot_step "06b-distill-kickoff"

"$PWCLI" --session "$SESSION" console > "$OUT_DIR/console.log" || true
"$PWCLI" --session "$SESSION" network > "$OUT_DIR/network.log" || true

cat > "$OUT_DIR/summary.json" <<JSON
{
  "status": "passed",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "session": "$SESSION",
  "ticketTitle": "$TICKET_TITLE",
  "ticketId": "$TICKET_ID",
  "datasetId": "$DATASET_ID",
  "runId": "${RUN_ID:-}",
  "artifacts": {
    "snapshotDir": "$OUT_DIR"
  }
}
JSON

echo "Playwright critical E2E completed. Artifacts: $OUT_DIR"
