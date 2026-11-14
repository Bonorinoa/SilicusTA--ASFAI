#!/bin/bash
# G1bV mutation run: remove each C1 / L1 guard on a scratch copy of feat/marble-source and require the tests to FAIL.
# Run from anywhere; set ROOT (a checkout with feat/marble-source) and SCRATCH. Node 22 is required.
ROOT=${ROOT:-/Users/bonorinoa/Hermes/Projects/silicus-wt/G1bV}
P=${SCRATCH:-/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch}
export PATH=/Users/bonorinoa/.hermes/node/bin:$PATH; node -v
fresh(){ rm -rf $P/mut; mkdir -p $P/mut; (cd $ROOT && git archive feat/marble-source host confirm-gate | tar -x -C $P/mut); cd $P/mut/host; }
run(){ node --test "$@" > $P/mut-run.log 2>&1; s=$?; echo "   EXIT=$s $(grep -E '^# (tests|pass|fail)' $P/mut-run.log | tr '\n' ' ')"; grep -E "^\s*not ok" $P/mut-run.log | sed 's/^ *//' | sort -u | head -8; MUTS=$((MUTS+1)); if [ $s -eq 0 ]; then echo "   >>> SURVIVED"; SURV=$((SURV+1)); fi; }
rep(){ python3 - "$1" "$2" "$3" <<'X'
import sys
p,a,b=sys.argv[1:4]; s=open(p).read(); assert a in s, "pattern not found: "+a; open(p,'w').write(s.replace(a,b,1))
X
}
T="test/marble-graph.test.mjs test/marble-routes.test.mjs test/source-marble.test.mjs test/marble-in-course.test.mjs test/http.test.mjs"
MUTS=0; SURV=0
fresh; echo "baseline (expect EXIT=0)"; run $T; MUTS=0; SURV=0
fresh; echo "C1-a fail-open again: null band -> whole 3-15 band"
rep sources/marble.mjs 'const band = audienceAges(course);' 'const band = audienceAges(course) ?? { min: MARBLE_MIN_AGE, max: MARBLE_MAX_AGE };'; run $T
fresh; echo "C1-b drop 'if (!band) return []' (null band -> crash/ whole band)"
rep sources/marble.mjs 'if (!band) return [];' ''; run $T
fresh; echo "C1-c parser: remove 'N to M year olds' (spaced) pattern"
rep marble/marble-graph.mjs '(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s+year\s+olds?' 'ZZNEVER'; run $T
fresh; echo "C1-d parser: remove 'N and M year olds' pattern"
rep marble/marble-graph.mjs '(\d{1,2})\s+and\s+(\d{1,2})\s+year\s+olds?' 'ZZNEVER'; run $T
fresh; echo "C1-e parser: remove single '19 year olds' (space) pattern"
rep marble/marble-graph.mjs '(\d{1,2})\s+year\s+olds?/i);' 'ZZNEVER/i);'; run $T
fresh; echo "C1-f original G1: fail-open AND parser reverted (all three widenings gone)"
rep sources/marble.mjs 'const band = audienceAges(course);' 'const band = audienceAges(course) ?? { min: MARBLE_MIN_AGE, max: MARBLE_MAX_AGE };'
rep marble/marble-graph.mjs '(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s+year\s+olds?' 'ZZNEVER'
rep marble/marble-graph.mjs '(\d{1,2})\s+and\s+(\d{1,2})\s+year\s+olds?' 'ZZNEVER'
rep marble/marble-graph.mjs '(\d{1,2})\s+year\s+olds?/i);' 'ZZNEVER/i);'; run $T
fresh; echo "L1-a topic route: raw decodeURIComponent"
rep handler.mjs 'const id = decodeSegment(parts[4]);' 'const id = decodeURIComponent(parts[4]);'; run $T
fresh; echo "L1-b course-id route: raw decodeURIComponent"
rep handler.mjs 'const courseId = decodeSegment(parts[2]);' 'const courseId = decodeURIComponent(parts[2]);'; run $T
fresh; echo "L1-c archive-ref route: raw decodeURIComponent"
rep handler.mjs 'const ref = decodeSegment(tail.slice("archive/".length));' 'const ref = decodeURIComponent(tail.slice("archive/".length));'; run $T
fresh; echo "L1-d decodeSegment itself rethrows (all three routes)"
rep handler.mjs 'throw new HttpError(400, "BAD_URI", "malformed percent-encoding in the uri");' 'throw new Error("URI malformed");'; run $T
echo "mutants run: $MUTS, survived: $SURV"
