#!/usr/bin/env python3
"""N5V item 4: compare the two hosts' plan.edited log lines from the real-Chrome walks. usage: n5v-compare.py <out dir>
The two smokes plan different courses (the Node host's scripted worker plans 2 activities, the browser run's 3), so the
lines cannot be byte-identical here. This compares what the edits recorded WITHOUT the course's own words: the event kind,
the field names of the event, the edit paths and the operation, in order. The byte-for-byte check is the vitest parity test."""
import json, sys, os
d = sys.argv[1]
def shape(host):
    j = json.load(open(os.path.join(d, host + ".json")))
    rows = []
    for line in j["events"]:
        rec = json.loads(line)
        ev = rec.get("event", rec)
        if ev.get("kind") != "plan.edited": continue
        edits = ev.get("edits") or []
        rows.append({"keys": sorted(ev.keys()), "paths": [ (e.get("path") if isinstance(e, dict) else str(e)) for e in edits ], "editKeys": sorted({k for e in edits if isinstance(e, dict) for k in e.keys()})})
    return rows, j
b, bj = shape("browser"); n, nj = shape("node")
print("plan.edited lines: browser host", len(b), "| Node host", len(n))
for i in range(max(len(b), len(n))):
    print(i, "browser", json.dumps(b[i]) if i < len(b) else None)
    print(i, "node   ", json.dumps(n[i]) if i < len(n) else None)
norm = lambda rows: [ {**r, "paths": [p if not p[:11] == "activities." else "activities." + ("N." + p.split(".", 2)[2] if p.split(".")[1].isdigit() else p.split(".", 1)[1]) for p in r["paths"]]} for r in rows]
print("same count and same shapes after folding the activity index:", len(b) == len(n) and norm(b) == norm(n))
steps = lambda j: [(r["step"], r.get("ok")) for r in j["res"] if "step" in r and r["step"] not in ("press log",)]
print("browser steps ok:", [s for s in steps(bj)]); print("node steps ok:", [s for s in steps(nj)])
