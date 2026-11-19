#!/bin/bash
# usage: runsuites.sh <tree> <logdir> [main|ports]
#   main  = the suites that take no fixed port
#   ports = e2e-restart (8791) and live-host-smoke (8787 + 5173); run when those ports are free
# Each exit code is captured on its own line, never through a pipe.
export PATH=/Users/bonorinoa/.local/bin:$PATH
T=$1; L=$2; MODE=${3:-main}; mkdir -p $L; cd $T
run() { name=$1; shift; "$@" > $L/$name.log 2>&1; s=$?; echo "$name EXIT=$s" | tee -a $L/summary-$MODE.txt; }
: > $L/summary-$MODE.txt
node -v >> $L/summary-$MODE.txt
if [ "$MODE" = main ]; then
run confirm-gate bash -c 'cd confirm-gate && node --test'
run api node --test api/test/
run host bash -c 'cd host && node --test'
run frontend-test bash -c 'cd frontend && npm test'
run frontend-build bash -c 'cd frontend && npm run build'
run browser-mode-smoke node frontend/scripts/browser-mode-smoke.mjs
run studio-smoke node frontend/scripts/studio-smoke.mjs
run narrow-shell node frontend/scripts/narrow-shell.mjs
else
# Another card (L2) may hold 8791, 8787 and 5173. Never kill it: move this run to free ports instead.
# e2e-restart hard-codes 8791, so a scratch copy of the script with only PORT changed is run when 8791 is busy.
if nc -z -G 2 -w 2 127.0.0.1 8791 >/dev/null 2>&1; then
  sed 's/^const PORT = 8791;/const PORT = 8891;/' host/scripts/e2e-restart.mjs > host/scripts/e2e-restart-8891.mjs
  diff <(cat host/scripts/e2e-restart.mjs) host/scripts/e2e-restart-8891.mjs > $L/e2e-port-diff.txt
  run e2e-restart bash -c 'cd host && node scripts/e2e-restart-8891.mjs'
else
  run e2e-restart bash -c 'cd host && node scripts/e2e-restart.mjs'
fi
if nc -z -G 2 -w 2 127.0.0.1 8787 >/dev/null 2>&1 || nc -z -G 2 -w 2 127.0.0.1 5173 >/dev/null 2>&1; then
  SMOKE_HOST_PORT=8887 SMOKE_APP_PORT=5273 run live-host-smoke node frontend/scripts/live-host-smoke.mjs
else
  run live-host-smoke node frontend/scripts/live-host-smoke.mjs
fi
fi
echo DONE >> $L/summary-$MODE.txt
