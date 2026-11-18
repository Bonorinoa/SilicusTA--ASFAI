#!/bin/bash
cd $TMPDIR/h3v/tree
node -v > ../node.txt
r(){ name=$1; shift; "$@" > ../log-$name.txt 2>&1; s=$?; echo "$name EXIT=$s" >> ../exits.txt; }
: > ../exits.txt
(cd frontend && npm ci > ../../log-npmci.txt 2>&1; s=$?; echo "npm-ci EXIT=$s" >> ../exits.txt)
r confirm-gate bash -c 'cd confirm-gate && node --test'
r api node --test api/test/
r host bash -c 'cd host && node --test'
r e2e-restart bash -c 'cd host && node scripts/e2e-restart.mjs'
r frontend-test bash -c 'cd frontend && npm test'
r frontend-build bash -c 'cd frontend && npm run build'
r browser-mode-smoke node frontend/scripts/browser-mode-smoke.mjs
r studio-smoke node frontend/scripts/studio-smoke.mjs
r live-host-smoke node frontend/scripts/live-host-smoke.mjs
r narrow-shell node frontend/scripts/narrow-shell.mjs
echo DONE >> ../exits.txt
