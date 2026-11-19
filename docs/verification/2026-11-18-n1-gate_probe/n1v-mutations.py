#!/usr/bin/env python3
"""N1V mutation matrix for N3/N4 (and the N1 /16 widening). Usage: n1v-mutations.py <extracted-feat/n-tree> <repo-for-git-show>
Each mutation edits ONE line in a scratch copy, runs named tests with Node v22.22.3, reports EXIT and failing-test names,
then restores the file from `git show feat/n:<path>`. A mutation is KILLED when at least one test fails (exit != 0)."""
import subprocess, sys, os, re
tree, repo = os.path.realpath(sys.argv[1]), sys.argv[2]
NODE = "/Users/bonorinoa/.local/bin/node"
MUTS = [
 ("N1 widen /24 back to /16", "host/materials.mjs", '["192.0.0.0", 24], // IETF', '["192.0.0.0", 16], // IETF',
  ["host", ["--test", "test/n1-address-policy.test.mjs"]]),
 ("N4 age switch: every course is adult", "host/student.mjs", "return Number.isFinite(pkg?.minAge) && pkg.minAge >= ADULT_AGE;", "return true;",
  ["host", ["--test", "test/n4-student-age.test.mjs"]]),
 ("N4 age switch: no course is adult", "host/student.mjs", "return Number.isFinite(pkg?.minAge) && pkg.minAge >= ADULT_AGE;", "return false;",
  ["host", ["--test", "test/n4-student-age.test.mjs"]]),
 ("N4 age switch: threshold 18 -> 16", "host/student.mjs", "export const ADULT_AGE = 18;", "export const ADULT_AGE = 16;",
  ["host", ["--test", "test/n4-student-age.test.mjs"]]),
 ("N4 age switch: no recorded ages counts as adult", "host/student.mjs", "return Number.isFinite(pkg?.minAge) && pkg.minAge >= ADULT_AGE;", "return !Number.isFinite(pkg?.minAge) || pkg.minAge >= ADULT_AGE;",
  ["host", ["--test", "test/n4-student-age.test.mjs"]]),
 ("N4 under-18 attempt-first branch removed", "host/student.mjs", "if (tryFirst && !adult) {", "if (false) {",
  ["host", ["--test", "test/n4-student-age.test.mjs"]]),
 ("N4 assessment net off (looksLikeAssessment -> false)", "host/student.mjs", "function looksLikeAssessment(question) {", "function looksLikeAssessment(question) { return false;",
  ["host", ["--test", "test/assessment-net.test.mjs", "test/student.test.mjs", "test/redteam.test.mjs", "test/student-kinds.test.mjs", "test/n4-student-age.test.mjs"]]),
 ("N4 assessment net runs after the adult general branch (order swapped)", "host/student.mjs", "if (looksLikeAssessment(question)) return assessment;", "if (!(adultCourse(pkg) && out?.basis === 'general') && looksLikeAssessment(question)) return assessment;",
  ["host", ["--test", "test/assessment-net.test.mjs", "test/student.test.mjs", "test/redteam.test.mjs", "test/student-kinds.test.mjs", "test/n4-student-age.test.mjs"]]),
 ("N4 under-18 cite check loosened (unknown cite accepted)", "host/student.mjs", "const ids = [...new Set(raw)].filter((id) => byId.has(id));\n  if (ids.length === 0) return offTopic(pkg);", "const ids = [...new Set(raw)].filter((id) => byId.has(id));\n  if (raw.length === 0) return offTopic(pkg);",
  ["host", ["--test", "test/n4-student-age.test.mjs", "test/student.test.mjs", "test/student-kinds.test.mjs", "test/redteam.test.mjs"]]),
 ("N3 re-clamp a teacher's AI status to the stage rule", "host/plan-edit.mjs", "if (rule) a.teacherOverride =", "if (rule) { a.aiStatus = rule; delete a.teacherOverride; } else if (false) a.teacherOverride =",
  ["host", ["--test", "test/n3-plan-edit.test.mjs"]]),
 ("N3 teacher override mark dropped", "host/plan-edit.mjs", "if (rule) a.teacherOverride =", "if (false) a.teacherOverride =",
  ["host", ["--test", "test/n3-plan-edit.test.mjs"]]),
]
def run(cwd, args):
    p = subprocess.run([NODE] + args, cwd=os.path.join(tree, cwd), capture_output=True, text=True, timeout=300)
    fails = re.findall(r"^not ok \d+ - (.*)$", p.stdout, re.M)
    tot = re.search(r"# tests (\d+)", p.stdout); fl = re.search(r"# fail (\d+)", p.stdout)
    return p.returncode, (tot.group(1) if tot else "?"), (fl.group(1) if fl else "?"), fails
base = {}
for name, path, old, new, (cwd, args) in MUTS:
    key = (cwd, tuple(args))
    if key not in base:
        base[key] = run(cwd, args); print(f"BASELINE {args[1:]} -> exit {base[key][0]}, tests {base[key][1]}, fail {base[key][2]}", flush=True)
    full = os.path.join(tree, path)
    orig = subprocess.run(["git", "-C", repo, "show", f"feat/n:{path}"], capture_output=True, text=True, check=True).stdout
    assert old in orig, f"mutation anchor not found for: {name}"
    open(full, "w").write(orig.replace(old, new, 1))
    try:
        code, tot, fl, fails = run(cwd, args)
    finally:
        open(full, "w").write(orig)
    verdict = "KILLED" if code != 0 else "SURVIVED"
    print(f"{verdict:8} | {name} | exit {code}, {fl}/{tot} failed | e.g. {fails[:2]}", flush=True)
