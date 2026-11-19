#!/usr/bin/env python3
"""N5V item 4: build two real-Chrome probes from a clean feat/n5 tree by INSERTING my walk (n5v-walk.mjs) into
copies of the two existing smokes, just before the plan is confirmed. The originals are not modified.
  frontend/scripts/n5v-browser-probe.mjs   <- studio-smoke.mjs      (browser host, IndexedDB, mock functions)
  frontend/scripts/n5v-node-probe.mjs      <- live-host-smoke.mjs    (Node host process, files on disk, Vite dev server)
usage: n5v-make-probes.py <tree> <probe dir holding n5v-walk.mjs>"""
import os, sys
tree, probe = sys.argv[1:3]
walk_url = "file://" + os.path.abspath(os.path.join(probe, "n5v-walk.mjs"))

def insert(src, dst, anchor, code):
    s = open(os.path.join(tree, "frontend/scripts", src)).read()
    assert s.count(anchor) >= 1, (src, "anchor missing")
    i = s.index(anchor)
    open(os.path.join(tree, "frontend/scripts", dst), "w").write(s[:i] + code + s[i:])

BROWSER = f'''
  // ---- N5V: the teacher's walk over the plan's shape, in real Chrome, browser host
  {{
    const {{ walk }} = await import("{walk_url}");
    const fs = await import("node:fs");
    const res = await walk(page, "browser");
    const st = await stored();
    fs.mkdirSync(process.env.N5V_OUT, {{ recursive: true }});
    fs.writeFileSync(join(process.env.N5V_OUT, "browser.json"), JSON.stringify({{ res, events: st.events.sort((a, b) => a.seq - b.seq).map((e) => e.line) }}, null, 1));
    console.log("N5V walk (browser host): " + res.length + " snapshots written");
  }}
'''
insert("studio-smoke.mjs", "n5v-browser-probe.mjs", '  await clickBy("Confirm the lesson plan");', BROWSER)

NODE = f'''
// ---- N5V: the teacher's walk over the plan's shape, in real Chrome, Node host
{{
  const {{ walk }} = await import("{walk_url}");
  const fs = await import("node:fs");
  const res = await walk(page, "node");
  const lf = join(DATA, courseId.replace(/[^A-Za-z0-9._-]/g, "_"), "events.ndjson");
  fs.mkdirSync(process.env.N5V_OUT, {{ recursive: true }});
  fs.writeFileSync(join(process.env.N5V_OUT, "node.json"), JSON.stringify({{ res, events: fs.readFileSync(lf, "utf8").split("\\n").filter(Boolean) }}, null, 1));
  console.log("N5V walk (Node host): " + res.length + " snapshots written");
}}
'''
insert("live-host-smoke.mjs", "n5v-node-probe.mjs", 'await clickPrimary("Confirm the lesson plan");', NODE)
print("ok")
