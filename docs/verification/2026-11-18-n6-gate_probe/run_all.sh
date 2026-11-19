#!/bin/bash
# N6V reproduction. usage: run_all.sh  (from anywhere; Node v22.22.3; writes only under $TMPDIR)
set -u
export PATH=/Users/bonorinoa/.local/bin:$PATH
REPO=/Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff
P="$(cd "$(dirname "$0")" && pwd)"
T=$TMPDIR/n6x; O=$TMPDIR/oldx; D=$TMPDIR/d42x
rm -rf $T $O $D; mkdir -p $T $O $D
git -C $REPO archive feat/n6 | tar -x -C $T            # clean export of the artifact
git -C $REPO archive 437f053 | tar -x -C $O            # 437f053 era (no plan-edit route yet)
git -C $REPO archive d4258aa | tar -x -C $D            # N6's base: pre-N6 with plan edit
(cd $T/confirm-gate && node --test) ; echo "confirm-gate EXIT=$?"
(cd $T/frontend && npm ci) ; echo "npm ci EXIT=$?"
node --test $T/api/test/ ; echo "api EXIT=$?"
(cd $T/host && node --test) ; echo "host EXIT=$?"
(cd $T/host && node scripts/e2e-restart.mjs) ; echo "e2e EXIT=$?"
(cd $T/frontend && npm test) ; echo "vitest EXIT=$?"
(cd $T/frontend && npm run build) ; echo "build EXIT=$?"
for s in browser-mode-smoke studio-smoke live-host-smoke narrow-shell; do node $T/frontend/scripts/$s.mjs; echo "$s EXIT=$?"; done
# item 4 / 5 probes
node $P/n6v_run_course.mjs $O $TMPDIR/old-run.json
node $P/n6v_run_course.mjs $D $TMPDIR/d42-run.json
node $P/n6v_run_course.mjs $T $TMPDIR/new-run.json
node $P/n6v_compare.mjs $T $TMPDIR/old-run.json $TMPDIR/d42-run.json $TMPDIR/new-run.json ; echo "compare EXIT=$?"
node $P/n6v_authority_probe.mjs $T ; echo "authority EXIT=$?"
python3 $P/n6v_mutations.py $T $TMPDIR            # prints exit codes per mutation (expected non-zero except M7, M10, M12 survivors)
cp $P/n6v_parity.test.ts $TMPDIR/n6mut/frontend/src/browser/
(cd $TMPDIR/n6mut/frontend && N6V_RUNNER=$P/n6v_run_course.mjs npx vitest run src/browser/n6v_parity.test.ts) ; echo "parity EXIT=$?"
