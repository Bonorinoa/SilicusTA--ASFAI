#!/bin/bash
# G2V: clean export of feat/g2, every STATUS section 3 suite on Node 22. Exit codes captured per suite, never through a pipe.
ROOT=${ROOT:-/Users/bonorinoa/Hermes/Projects/silicus-wt/G2V}
BR=${BR:-feat/g2}
S=${SCRATCH:-/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch}
X=$S/g2v; L=$S/g2v-logs
export PATH=/Users/bonorinoa/.hermes/node/bin:$PATH
rm -rf $X $L; mkdir -p $X $L
(cd $ROOT && git archive $BR | tar -x -C $X)
cd $X; echo "export sha: $(cd $ROOT && git rev-parse $BR)" > $L/summary.txt; ls -A | tr '\n' ' ' >> $L/summary.txt; echo >> $L/summary.txt
node -v > $L/node.txt; case "$(node -v)" in v22.22.3) ;; *) echo "WRONG NODE" >> $L/summary.txt; exit 9;; esac
run(){ name=$1; shift; "$@" > $L/$name.log 2>&1; s=$?; echo "$name EXIT=$s" >> $L/summary.txt; }
run npm-ci bash -c '(cd frontend && npm ci)'
run confirm-gate bash -c '(cd confirm-gate && node --test)'
run api node --test api/test/
run host bash -c '(cd host && node --test)'
run e2e bash -c '(cd host && node scripts/e2e-restart.mjs)'
run fe-test bash -c '(cd frontend && npm test)'
run fe-build bash -c '(cd frontend && npm run build)'
run studio node frontend/scripts/studio-smoke.mjs
run browser-mode node frontend/scripts/browser-mode-smoke.mjs
run live-host node frontend/scripts/live-host-smoke.mjs
run narrow node frontend/scripts/narrow-shell.mjs
echo DONE >> $L/summary.txt
