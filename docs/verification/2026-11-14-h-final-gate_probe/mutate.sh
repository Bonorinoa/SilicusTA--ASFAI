#!/bin/bash
# HV: mutation check. Copy a clean export (EXPORT, already npm-ci'd) to a scratch clone, break one guard at a time,
# run the suite that should catch it, restore the file. A surviving mutation = a guard with no test.
EXPORT=${EXPORT:-/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/hv}
W=${W:-/Users/bonorinoa/.hermes/profiles/verifier/cache/scratch/hv-mut}
export PATH=/Users/bonorinoa/.hermes/node/bin:$PATH
rm -rf $W; cp -c -R $EXPORT $W; cd $W
mut(){ python3 - "$1" "$2" "$3" <<'PY'
import sys
p,old,new=sys.argv[1:4]
t=open(p).read(); assert old in t, "pattern not found: "+p; open(p,'w').write(t.replace(old,new,1))
PY
}
orig(){ cp -c $EXPORT/$1 $W/$1; }
host(){ (cd host && node --test "$@" > /dev/null 2>$W/err.txt; true); (cd host && node --test "$@" 2>&1 | grep -E "^# (tests|pass|fail)" | tr '\n' ' '); }
fe(){ (cd frontend && npx vitest run "$1" 2>&1 | grep -E "Tests  " ); }
echo "M1 PlanCard: credit removed from Suggested alignment"
mut frontend/src/components/PlanCard/PlanCard.tsx '{plan.citations.some((c) => c.source === "marble") ? <MarbleCredit className={styles.alignmentCredit} /> : null}' ''; fe src/components/PlanCard; orig frontend/src/components/PlanCard/PlanCard.tsx
echo "M2 SkillMap: tooltip shows the mt_ id"
mut frontend/src/studio/graph/SkillMap.tsx '<title>{`${n.node.name}. ${ages(' '<title>{`${n.node.name} ${n.node.id}. ${ages('; fe src/studio/graph; orig frontend/src/studio/graph/SkillMap.tsx
echo "M3 empty-state line reworded"
mut frontend/src/studio/graph/SkillMap.tsx 'No skill-map topics for these ages. Write your own objectives.' 'Nothing here.'; fe src/studio/graph; orig frontend/src/studio/graph/SkillMap.tsx
echo "M4 stage-3 permitted-without-first-try rule removed"
mut host/worker.mjs 'if (stage === 3 && aiStatus === "permitted" && !learnerFirst) {' 'if (false) {'; host; echo; orig host/worker.mjs
echo "M5 host ceiling removed"
mut host/worker.mjs 'Math.min(Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS, MAX_TOKENS_CEILING)' '(Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS)'; host test/worker.test.mjs; echo; orig host/worker.mjs
echo "M6 api ceiling removed"
mut api/_lib/worker.mjs 'Math.min(cap, MAX_TOKENS_CEILING)' 'cap'; node --test api/test/ 2>&1 | grep -E "^# (tests|pass|fail)" | tr '\n' ' '; echo; orig api/_lib/worker.mjs
echo "M7 anchor/ages overlap refusal removed"
mut host/handler.mjs 'b.ages && Number.isFinite(anchorAges.min)' 'false && Number.isFinite(anchorAges.min)'; host; echo; orig host/handler.mjs
echo "M8 non-string marbleAnchor refusal removed"
mut host/handler.mjs 'typeof b.marbleAnchor !== "string") {' 'false) {'; host; echo; orig host/handler.mjs
echo "restore check:"; diff -rq $EXPORT/host host && diff -rq $EXPORT/api api && diff -rq $EXPORT/frontend/src frontend/src && echo "clone identical to export"
