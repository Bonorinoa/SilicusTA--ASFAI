#!/bin/bash
P=/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch
fresh(){ rm -rf $P/mut; mkdir -p $P/mut; (cd /Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff && git archive feat/marble-source host confirm-gate | tar -x -C $P/mut); cd $P/mut/host; }
run(){ node --test "$@" > $P/mut-run.log 2>&1; s=$?; echo "   EXIT=$s $(grep -E '^# (tests|pass|fail)' $P/mut-run.log | tr '\n' ' ')"; grep -E "^not ok" $P/mut-run.log | head -5; }
T="test/marble-graph.test.mjs test/marble-routes.test.mjs test/source-marble.test.mjs test/marble-in-course.test.mjs"
fresh; echo "baseline"; run $T
fresh; echo "M1 drop early-return grain guard (sources/marble.mjs)"
python3 - <<'X'
p='sources/marble.mjs'; s=open(p).read(); a='if (band && !overlaps(band, { min: MARBLE_MIN_AGE, max: MARBLE_MAX_AGE })) return [];'; assert a in s; open(p,'w').write(s.replace(a,'/*m*/'))
X
run $T
fresh; echo "M2 drop age-overlap filter (marble-graph.search)"
python3 - <<'X'
p='marble/marble-graph.mjs'; s=open(p).read(); a='if (lo > ageMax || hi < ageMin) continue;'; assert a in s; open(p,'w').write(s.replace(a,'/*m*/'))
X
run $T
fresh; echo "M3 both"
python3 - <<'X'
p='marble/marble-graph.mjs'; s=open(p).read(); s=s.replace('if (lo > ageMax || hi < ageMin) continue;','/*m*/'); open(p,'w').write(s)
p='sources/marble.mjs'; s=open(p).read(); s=s.replace('if (band && !overlaps(band, { min: MARBLE_MIN_AGE, max: MARBLE_MAX_AGE })) return [];','/*m*/'); open(p,'w').write(s)
X
run $T
fresh; echo "M4 egress -> non-null"
python3 - <<'X'
p='sources/marble.mjs'; s=open(p).read(); a='get egress() { return null; }'; assert a in s; open(p,'w').write(s.replace(a,'get egress() { return "marble.example"; }'))
X
run $T
fresh; echo "M5 inBand re-check in pushTopic removed (neighbour age guard)"
python3 - <<'X'
p='sources/marble.mjs'; s=open(p).read(); a='if (!full || !inBand(full)) return;'; assert a in s; open(p,'w').write(s.replace(a,'if (!full) return;'))
X
run $T
fresh; echo "M6 snapshot hash tamper (change one topic name in committed file)"
python3 - <<'X'
p='data/marble/marble-snapshot.json'; s=open(p).read(); s=s.replace('"topicsSha256":"fd96ce59','"topicsSha256":"00000000',1); open(p,'w').write(s)
X
run $T
fresh; echo "M7 all three age guards removed (early return, search filter, inBand)"
python3 - <<'X'
p='marble/marble-graph.mjs'; s=open(p).read(); s=s.replace('if (lo > ageMax || hi < ageMin) continue;','/*m*/'); open(p,'w').write(s)
p='sources/marble.mjs'; s=open(p).read(); s=s.replace('if (band && !overlaps(band, { min: MARBLE_MIN_AGE, max: MARBLE_MAX_AGE })) return [];','/*m*/').replace('if (!full || !inBand(full)) return;','if (!full) return;'); open(p,'w').write(s)
X
run test/source-marble.test.mjs test/marble-in-course.test.mjs
