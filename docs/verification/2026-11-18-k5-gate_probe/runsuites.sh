#!/bin/bash
export PATH=/Users/bonorinoa/.local/bin:$PATH
T=$1; L=$2; mkdir -p $L; cd $T
run() { name=$1; shift; "$@" > $L/$name.log 2>&1; s=$?; echo "$name EXIT=$s" | tee -a $L/summary.txt; }
: > $L/summary.txt
node -v >> $L/summary.txt
run confirm-gate bash -c 'cd confirm-gate && node --test'
run api node --test api/test/
run host bash -c 'cd host && node --test'
run e2e-restart bash -c 'cd host && node scripts/e2e-restart.mjs'
run frontend-test bash -c 'cd frontend && npm test'
run frontend-build bash -c 'cd frontend && npm run build'
run browser-mode-smoke node frontend/scripts/browser-mode-smoke.mjs
run studio-smoke node frontend/scripts/studio-smoke.mjs
run narrow-shell node frontend/scripts/narrow-shell.mjs
echo DONE >> $L/summary.txt
