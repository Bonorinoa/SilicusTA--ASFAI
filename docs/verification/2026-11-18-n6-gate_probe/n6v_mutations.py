#!/usr/bin/env python3
"""N6V mutation probe. Copies a clean feat/n6 export, applies ONE in-memory-style edit at a time to the copy
(never the repo), runs the guarding suite, prints exit code + failing-test count, restores the file.
usage: n6v_mutations.py <clean-export-dir> <scratch-dir> [M-ids, e.g. M9 M10]   (node = /Users/bonorinoa/.local/bin/node)"""
import os, re, shutil, subprocess, sys
src, scratch = sys.argv[1], sys.argv[2]
work = os.path.join(scratch, "n6mut")
shutil.rmtree(work, ignore_errors=True)
shutil.copytree(src, work, ignore=shutil.ignore_patterns("node_modules"), symlinks=True)
os.symlink(os.path.join(src, "frontend", "node_modules"), os.path.join(work, "frontend", "node_modules"))
env = dict(os.environ, PATH="/Users/bonorinoa/.local/bin:" + os.environ["PATH"])
env.pop("PYTHONPATH", None)

def run(cmd, cwd):
    r = subprocess.run(cmd, cwd=os.path.join(work, cwd), env=env, capture_output=True, text=True, shell=True)
    out = r.stdout + r.stderr
    fails = re.findall(r"^# fail (\d+)", out, re.M)
    vt = re.findall(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    names = re.findall(r"^not ok \d+ - (.+)$", out, re.M)[:4] or re.findall(r"FAIL\s+(\S+ >.*)", out)[:3]
    return r.returncode, (fails[0] if fails else (vt[0][0] or "0") if vt else "?"), names

MUT = [
 ("M1 default author -> 'teacher' (gate, both sites)", "confirm-gate/confirm-gate.mjs",
  [('item?.proposedBy ?? "ai"', 'item?.proposedBy ?? "teacher"'), ('item.proposedBy ?? "ai"', 'item.proposedBy ?? "teacher"')],
  [("confirm-gate", "node --test"), ("host", "node --test")]),
 ("M2 drop the gate's edit marker (editedByTeacher/teacherEditCount never set)", "confirm-gate/confirm-gate.mjs",
  [("      entry.record.editedByTeacher = true;\n      entry.record.teacherEditCount = teacherEditCount;\n", "")],
  [("confirm-gate", "node --test"), ("host", "node --test")]),
 ("M2b host never writes teacherEditCount on plan.confirmed", "host/course.mjs",
  [("...(teacherEditCount > 0 ? { teacherEditCount } : {}),", "")],
  [("host", "node --test")]),
 ("M3 bad proposedBy fails OPEN (validation loop removed)", "confirm-gate/confirm-gate.mjs",
  [('if (proposedBy !== "ai" && proposedBy !== "teacher") {', 'if (false) {')],
  [("confirm-gate", "node --test")]),
 ("M4 host #rows filter reverted to AI-only", "host/course.mjs",
  [("      if (!proposal) continue;\n      seen.add(id);", '      if (!proposal || proposal.proposedBy !== "ai") continue;\n      seen.add(id);')],
  [("host", "node --test")]),
 ("M5 harness.views filter reverted to AI-only", "frontend/src/gate/harness.ts",
  [("p !== null && !addedIds.has(p.id)", 'p !== null && p.proposedBy === "ai"')],
  [("frontend", "npx vitest run src/gate src/browser")]),
 ("M6 harness.views row label forced 'ai'", "frontend/src/gate/harness.ts",
  [("by: proposal.proposedBy,", 'by: "ai",')],
  [("frontend", "npx vitest run src/gate src/browser")]),
 ("M7 DecisionCard queue reverted to by==='ai'", "frontend/src/components/DecisionCard/DecisionCard.tsx",
  [('rows.filter((r) => r.status !== "added")', 'rows.filter((r) => r.by === "ai")')],
  [("frontend", "npx vitest run")]),
 ("M8 harness.summary reverted to by==='ai'", "frontend/src/gate/harness.ts",
  [('const proposals = rows.filter((r) => r.status !== "added");\n    const decided', 'const proposals = rows.filter((r) => r.by === "ai");\n    const decided')],
  [("frontend", "npx vitest run src/gate src/browser")]),
]
MUT += [
 ("M9 ObjectivesStep tray condition reverted (teacher-typed proposals no longer open the decision tray)", "frontend/src/studio/steps/ObjectivesStep.tsx",
  [('(rows.length > 0 || drafting)', '(rows.some((r) => r.by !== "teacher") || drafting)')],
  [("frontend", "npx vitest run src/studio"), (".", "node frontend/scripts/studio-smoke.mjs")]),
 ("M10 objectivesOffer: wizard lines count as a proposal round again", "frontend/src/studio/steps/objectivesOffer.ts",
  [('const anyProposalRound = rows.some((r) => r.by !== "teacher");', 'const anyProposalRound = rows.length > 0;')],
  [("frontend", "npx vitest run src/studio")]),
]
ONLY = sys.argv[3:] 
for title, rel, edits, cmds in MUT:
    if ONLY and not any(title.startswith(o + " ") for o in ONLY): continue
    path = os.path.join(work, rel); orig = open(path).read(); s = orig
    for a, b in edits:
        assert a in s, f"{title}: pattern not found: {a[:50]!r}"
        s = s.replace(a, b)
    open(path, "w").write(s)
    try:
        res = [f"{d}:{c.split()[0]}.. exit={code} failed={n} {names}" for d, c in cmds for code, n, names in [run(c, d)]]
        print(f"{title}\n    " + "\n    ".join(res), flush=True)
    finally:
        open(path, "w").write(orig)
# control: the unmutated copy must be green
print("CONTROL (no mutation):", [f"{d} exit={run(c, d)[0]}" for d, c in [("confirm-gate", "node --test"), ("frontend", "npx vitest run src/gate src/browser")]])
