#!/usr/bin/env python3
"""N5V item 3: mutations of the helper's two backstops, each in a scratch copy (never in the repo).
usage: n5v-mutations.py <clean tree> <scratch dir> <logdir>
For each mutation: copy host/ api/ confirm-gate/ eval/ from the clean tree, apply ONE edit (the script asserts the old
text occurs exactly once), run the helper tests and the whole host suite, and print the exit code and counts.
A mutation 'is killed' when at least one test fails (exit != 0). Exit codes are captured on their own, never through a pipe."""
import os, re, shutil, subprocess, sys
tree, scratch, logs = sys.argv[1:4]
os.makedirs(logs, exist_ok=True)
NODE = "/Users/bonorinoa/.local/bin"
env = {**os.environ, "PATH": NODE + ":" + os.environ["PATH"]}
env.pop("PYTHONPATH", None)

MUTATIONS = [
  ("M0 control: no edit", None, None),
  ("M1 remove the output check (model words never scanned)",
   'if (judgesStudent(out?.answer)) return { ...assessment, withheld: "judged" };',
   "/* mutated: output check removed */"),
  ("M2 remove the title/number backstop entirely (namedTryFirst is never consulted)",
   "const named = namedTryFirst(question, pkg.items);",
   "const named = null;"),
  ("M2a remove only the NUMBER half of the backstop",
   "    if (byNumber) return item;", "    if (false) return item;"),
  ("M2b remove only the TITLE half (whole title and two-content-words)",
   "    const title = words(topicOf(item));\n    if (title.length > 0 && qs.includes(` ${title.join(\" \")} `)) return item;",
   "    const title = words(topicOf(item));"),
  ("M2c loosen the two-content-words rule to one word (false-positive guard)",
   "if (content.length >= 2 && hits >= 2) return item;", "if (content.length >= 1 && hits >= 1) return item;"),
  ("M2d remove only the two-content-words rule (the whole-title rule stays)",
   "if (content.length >= 2 && hits >= 2) return item;", "/* mutated */"),
  ("M2e remove the whole-title rule AND the two-content-words rule (number half stays)",
   "    if (title.length > 0 && qs.includes(` ${title.join(\" \")} `)) return item;\n    const content = [...new Set(title.filter((w) => !TITLE_STOPWORDS.has(w) && w.length > 2))];\n    const hits = content.filter((w) => q.includes(w)).length;\n    if (content.length >= 2 && hits >= 2) return item;",
   "    /* mutated: title half removed */"),
  ("M3 output check never fires on a judged answer (patterns emptied)",
   "export const JUDGING_PATTERNS = [", "export const JUDGING_PATTERNS = [ /(?!)/, ]; const _unused = ["),
]

def run(cmd, cwd, name):
    p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
    open(os.path.join(logs, name), "w").write(p.stdout + p.stderr)
    out = p.stdout + p.stderr
    def num(k):
        m = re.search(r"^# %s (\d+)" % k, out, re.M); return int(m.group(1)) if m else None
    return p.returncode, num("tests"), num("pass"), num("fail")

summary = []
for i, (label, old, new) in enumerate(MUTATIONS):
    d = os.path.join(scratch, "mut%d" % i)
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for sub in ("host", "api", "confirm-gate", "eval"):
        shutil.copytree(os.path.join(tree, sub), os.path.join(d, sub), symlinks=True)
    if old is not None:
        f = os.path.join(d, "host/student.mjs"); s = open(f).read()
        assert s.count(old) == 1, (label, s.count(old))
        open(f, "w").write(s.replace(old, new))
    tag = "m%d" % i
    r_helper = run(["node", "--test", "test/n5-helper.test.mjs"], os.path.join(d, "host"), tag + "-n5-helper.log")
    r_host = run(["node", "--test"], os.path.join(d, "host"), tag + "-host.log")
    line = "%-82s | n5-helper exit=%s (tests %s pass %s fail %s) | host exit=%s (tests %s pass %s fail %s)" % ((label,) + r_helper + r_host)
    print(line, flush=True); summary.append(line)
open(os.path.join(logs, "mutations.log"), "w").write("\n".join(summary) + "\n")
