#!/bin/bash
export PATH=/Users/bonorinoa/.hermes/node/bin:$PATH
cd /Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/g1v
L=/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/g1v-logs; mkdir -p $L
node -v > $L/node.txt; case "$(node -v)" in v22.22.3) ;; *) echo "WRONG NODE" >> $L/summary.txt; exit 9;; esac
run(){ name=$1; shift; "$@" > $L/$name.log 2>&1; s=$?; echo "$name EXIT=$s" >> $L/summary.txt; }
: > $L/summary.txt
(cd frontend && npm ci) > $L/npm-ci.log 2>&1; s=$?; echo "npm-ci EXIT=$s" >> $L/summary.txt
run confirm-gate bash -c '(cd confirm-gate && node --test)'
run api node --test api/test/
run host bash -c '(cd host && node --test)'
run e2e bash -c '(cd host && node scripts/e2e-restart.mjs)'
run fe-test bash -c '(cd frontend && npm test)'
run fe-build bash -c '(cd frontend && npm run build)'
run studio node frontend/scripts/studio-smoke.mjs
run browser-mode node frontend/scripts/browser-mode-smoke.mjs
echo DONE >> $L/summary.txt
