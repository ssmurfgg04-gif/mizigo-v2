#!/bin/bash
# Supabase production verification: boot the NETLIFY=1 standalone build against
# the real Supabase Postgres and run both suites against it. Detached runner —
# writes progress to /tmp/supa_verify.log
set -u
cd "$(dirname "$0")/.."
LOG=/tmp/supa_verify.log
# Credential comes from the environment (GitHub secret SUPABASE_DATABASE_URL
# locally) — never hardcoded. Example shape:
#   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?schema=mizigo&sslmode=require
: "${DATABASE_URL:?Set DATABASE_URL to the Supabase session-pooler URL (see docs/NETLIFY_PRODUCTION.md)}"

for pid in $(ps -eo pid,cmd | grep "next start\|next-server" | grep -v grep | awk '{print $1}'); do kill -9 "$pid" 2>/dev/null; done
sleep 1

echo "── booting prod server on Supabase Postgres ──" > "$LOG"
NETLIFY=1 NODE_ENV=production nohup node node_modules/next/dist/bin/next start -p 3100 >> server.log 2>&1 &
code=000
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/api/bootstrap --max-time 60)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "bootstrap=$code" >> "$LOG"
if [ "$code" != "200" ]; then echo "SERVER FAILED" >> "$LOG"; exit 1; fi

echo "── e2e suite (remote DB — slow, be patient) ──" >> "$LOG"
MIZIGO_BASE=http://localhost:3100 python3 scripts/e2e_test.py >> "$LOG" 2>&1
echo "E2E_EXIT=$?" >> "$LOG"

echo "── demo walkthrough ──" >> "$LOG"
MIZIGO_BASE=http://localhost:3100 python3 scripts/demo_walkthrough.py >> "$LOG" 2>&1
echo "WALKTHROUGH_EXIT=$?" >> "$LOG"

echo "ALL_DONE" >> "$LOG"
