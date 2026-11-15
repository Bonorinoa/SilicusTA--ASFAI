import os,re,shutil,subprocess,sys
T=os.environ['TMPDIR']; SRC=f'{T}/p2x'
M=[
 ("m1 stage1 clamp off","host/worker.mjs",'if (stage === 1 && aiStatus !== "forbidden")','if (false && aiStatus !== "forbidden")'),
 ("m2 stage2 required clamp off","host/worker.mjs",'else if (stage === 2 && aiStatus === "required")','else if (false)'),
 ("m3 stage3 required clamp off","host/worker.mjs",'else if (stage === 3 && aiStatus === "required")','else if (false)'),
 ("m4 no-ages aiStatus kept","host/worker.mjs",'if (stage === null) {\n        notes.push("dropped aiStatus: this course has no structured ages.");','if (false) {\n        notes.push("dropped aiStatus: this course has no structured ages.");'),
 ("m5 stage1-2 aiPolicy not replaced","host/worker.mjs",'aiPolicy = STAGE_AI_POLICY[stage];\n        notes.push','aiPolicy = proposed;\n        notes.push'),
 ("m6 model's audience sets stage","host/worker.mjs",'const stage = stageForAges(ages);\n  const notes = [];','const stage = stageForAges(ages) ?? (spec?.audience?.ageRangeStart != null ? stageForAges({ min: spec.audience.ageRangeStart }) : null);\n  const notes = [];'),
 ("m7 stage4 over-clamped","host/worker.mjs",'else if (stage === 3 && aiStatus === "required")','else if (stage >= 3 && aiStatus === "required")'),
 ("m8 stage3-4 aiPolicy kept","host/worker.mjs",'notes.push("dropped aiPolicy: only stages 1 and 2 carry a plan-level AI line.");','aiPolicy = proposed;'),
 ("m9 enum values not validated","host/worker.mjs",'if (allowed.includes(value)) return value;','return value;'),
 ("m10 stage boundary 11->12","host/ages.mjs",'if (m <= 11) return 2;','if (m <= 12) return 2;'),
 ("m11 no-ages aiPolicy kept","host/worker.mjs",'} else if (stage === null) {\n      notes.push("dropped aiPolicy: this course has no structured ages.");','} else if (false) {\n      notes.push("dropped aiPolicy: this course has no structured ages.");'),
 ("m12 stage3 'permitted' no first-try note off","host/worker.mjs",'if (stage === 3 && aiStatus !== "forbidden" && !learnerFirst)','if (false)'),
 ("m13 session dup/negative accepted","host/worker.mjs",'value >= minInclusive &&','true &&'),
 ("m14 v1 plan gains notes key","host/worker.mjs",'...(dedupedNotes.length > 0 ? { notes: dedupedNotes } : {}),','notes: dedupedNotes,'),
]
def run(tree,cmd,env=None):
    r=subprocess.run(cmd,cwd=tree,capture_output=True,text=True,env={**os.environ,**(env or {})});return r.returncode
print(f"{'mutant':45s} producer_tests  my_probe")
for name,f,a,b in M:
    d=f'{T}/mut'; shutil.rmtree(d,ignore_errors=True); shutil.copytree(SRC,d,ignore=shutil.ignore_patterns('node_modules'))
    s=open(f'{d}/{f}').read()
    if a not in s: print(f"{name:45s} PATTERN NOT FOUND"); continue
    open(f'{d}/{f}','w').write(s.replace(a,b,1))
    rc1=run(f'{d}/host',['node','--test','test/plan-schema-v2.test.mjs','test/ages.test.mjs','test/worker.test.mjs'])
    rc2=run(f'{T}/p2probe',['node','probe.mjs'],{'TREE':d})
    print(f"{name:45s} {'KILLED' if rc1 else 'SURVIVED':14s} {'KILLED' if rc2 else 'SURVIVED'}")
