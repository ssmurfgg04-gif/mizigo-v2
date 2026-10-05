#!/bin/bash
# MIZIGO Netlify cold-start simulation:
#   build (NETLIFY=1) → kill any stale :3100 server → fresh /tmp SQLite →
#   production server on :3100 → full e2e suite against it.
# Usage: bash scripts/prod_sim.sh [keep]   (keep = don't run e2e, leave server up)
set -e
cd "$(dirname "$0")/.."

echo "── killing stale :3100 servers ──"
# lsof can miss sockets in this environment — kill by cmdline pattern instead
for pid in $(ps -eo pid,cmd | rg "next start|next-server" | rg -v "rg next|next dev" | awk '{print $1}'); do
  kill -9 "$pid" 2>/dev/null || true
done
sleep 1
if curl -s -o /dev/null --max-time 2 http://localhost:3100/; then echo "ERROR: port 3100 still busy"; exit 1; fi
echo "port 3100 free"

echo "── building (NETLIFY=1) ──"
rm -rf .next
NETLIFY=1 npx next build 2>&1 | tail -2

echo "── fresh /tmp SQLite + production server on :3100 ──"
rm -f /tmp/mizigo.db
NETLIFY=1 DATABASE_URL="file:/tmp/mizigo.db" NODE_ENV=production \
  nohup node node_modules/next/dist/bin/next start -p 3100 > server.log 2>&1 &
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/api/bootstrap --max-time 60)
  if [ "$code" = "200" ]; then echo "prod server up (cold-start bootstrap OK)"; break; fi
  sleep 2
done
if [ "${code:-000}" != "200" ]; then echo "ERROR: server did not come up"; tail -20 server.log; exit 1; fi

if [ "$1" = "keep" ]; then
  echo "server left running on :3100"
  exit 0
fi

echo "── full e2e suite against the production server ──"
MIZIGO_BASE=http://localhost:3100 python3 scripts/e2e_test.py
RESULT=$?
if [ $RESULT -eq 0 ]; then
  echo "── done: shutting the sim down ──"
  for pid in $(ps -eo pid,cmd | rg "next start|next-server" | rg -v "rg next|next dev" | awk '{print $1}'); do
    kill -9 "$pid" 2>/dev/null || true
  done
fi

# NOTE: the build above wiped .next — restart the dev server (its turbopack
# cache can't survive that) and let it reseed a fresh dev DB.
echo "── restarting the dev server on :3000 (fresh cache) ──"
for pid in $(ps -eo pid,cmd | rg "next dev|next-server" | rg -v rg | awk '{print $1}'); do
  kill -9 "$pid" 2>/dev/null || true
done
sleep 1
rm -f db/custom.db
nohup node node_modules/next/dist/bin/next dev -p 3000 > dev.log 2>&1 &
echo "dev server restarting (first compile takes a few seconds)"
exit $RESULT
