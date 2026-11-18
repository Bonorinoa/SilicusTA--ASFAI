// G2V host-side probe. Recomputes every number from the pinned snapshot with its OWN code, then compares to the routes.
// Run from the repo root: node docs/verification/2026-11-14-g2-verifier_probe/host-probe.mjs   (Node v22.22.3)
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../host/server.mjs";
import { createMarbleService } from "../../../host/marble/marble-graph.mjs";
import { MarbleSource } from "../../../host/sources/marble.mjs";

const SNAP = new URL("../../../host/data/marble/marble-snapshot.json", import.meta.url).pathname;
const raw = readFileSync(SNAP, "utf8");
const snap = JSON.parse(raw);
let fails = 0, passes = 0;
const check = (n, ok, d = "") => { if (ok) { passes++; console.log("PASS", n, d); } else { fails++; console.log("FAIL", n, d); } };

const marble = createMarbleService(async () => raw);
const app = createApp({ dataDir: mkdtempSync(join(tmpdir(), "g2v-")), sources: [], marble });
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`;
const call = async (p, o = {}) => { const r = await fetch(base + p, o); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
const post = (p, b) => call(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

// ---- own coverage
const topics = snap.topics;
const own = (lo, hi) => topics.filter((t) => t.ageRangeStart <= hi && t.ageRangeEnd >= lo).length;
for (const [lo, hi] of [[9, 10], [19, 22], [5, 12], [3, 15], [15, 22], [16, 18], [3, 3], [12, 14]]) {
  const r = await call(`/api/knowledge/marble/coverage?min=${lo}&max=${hi}`);
  const keys = r.j ? Object.keys(r.j).join(",") : "";
  const n = r.j?.overlapping ?? r.j?.count ?? r.j?.overlap ?? r.j?.topics;
  check(`coverage ${lo}-${hi} route == own count`, r.s === 200 && n === own(lo, hi), `route=${n} own=${own(lo, hi)} keys=${keys}`);
}
{ const r = await call(`/api/knowledge/marble/coverage?min=9&max=10`);
  const strip = r.j?.perAge ?? r.j?.strip ?? r.j?.byAge;
  const ok = Array.isArray(strip) ? strip.length === 23 && strip.every((x) => x.count === own(x.age, x.age)) : (strip && Object.keys(strip).length === 23 && Object.entries(strip).every(([a, c]) => c === own(+a, +a)));
  check("coverage strip is 3..25 and each age equals own single-age count", !!ok, JSON.stringify(strip)?.slice(0, 200)); }
for (const q of ["min=2&max=5", "min=10&max=5", "min=a&max=b", "min=3&max=100", "min=3.5&max=9"]) {
  const r = await call(`/api/knowledge/marble/coverage?${q}`); check(`coverage bad input ${q} -> 400`, r.s === 400, String(r.s)); }

// ---- own neighbourhood BFS
const deps = snap.dependencies;
const up = new Map(), down = new Map();
for (const d of deps) { (up.get(d.topicId) ?? up.set(d.topicId, []).get(d.topicId)).push(d.prerequisiteId); (down.get(d.prerequisiteId) ?? down.set(d.prerequisiteId, []).get(d.prerequisiteId)).push(d.topicId); }
const hop = (start, map, n) => { const seen = new Map(); let f = [start]; for (let h = 1; h <= n; h++) { const nx = []; for (const x of f) for (const y of map.get(x) ?? []) if (y !== start && !seen.has(y)) { seen.set(y, h); nx.push(y); } f = nx; } return seen; };
for (const id of ["mt_AzTrT5ySCx", "mt_WRRv1ABECC", "mt_kH1DzOPsXG", topics[100].id, topics[900].id, topics[1500].id]) {
  const r = await call(`/api/knowledge/marble/neighbourhood/${id}`);
  const P = hop(id, up, 2), D = hop(id, down, 1);
  const rp = new Map((r.j?.prerequisites ?? []).map((x) => [x.id, x.hops])), rd = new Map((r.j?.dependents ?? []).map((x) => [x.id, x.hops]));
  const same = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
  check(`neighbourhood ${id} prereqs(2 hops) equal own BFS`, same(P, rp), `route=${rp.size} own=${P.size}`);
  check(`neighbourhood ${id} dependents(1 hop) equal own BFS`, same(D, rd), `route=${rd.size} own=${D.size}`);
  const idsInView = new Set([id, ...rp.keys(), ...rd.keys()]);
  const edgesOk = (r.j?.edges ?? []).every((e) => idsInView.has(e.from) && idsInView.has(e.to) && deps.some((d) => d.prerequisiteId === e.from && d.topicId === e.to && d.strength === e.strength));
  check(`neighbourhood ${id} every edge is a real snapshot dependency with its strength`, edgesOk, `edges=${r.j?.edges?.length}`);
}
{ const r = await call("/api/knowledge/marble/neighbourhood/mt_nope"); check("neighbourhood unknown id -> 404", r.s === 404, String(r.s)); }
{ const r = await call("/api/knowledge/marble/neighbourhood/%E0%A4%A"); check("neighbourhood malformed % -> 400", r.s === 400, String(r.s)); }

// ---- Roman case + structured ages beat text
const src = new MarbleSource({ marble });
const A = "mt_AzTrT5ySCx";
const lab = (o) => o.map((c) => c.label);
const bad = (o) => o.filter((c) => /Roman|Britain|rainforest/i.test(c.label));
for (const ages of [{ min: 8, max: 10 }, { min: 5, max: 12 }, { min: 9, max: 10 }, { min: 3, max: 15 }]) {
  for (const topic of ["AI in daily life", "daily life", "army and conquest", "life in a town", "smart devices"]) {
    const o = await src.retrieve({ topic, ages, anchor: A, limit: 12 });
    const out = o.filter((c) => { const id = String(c.ref ?? "").replace(/^marble:/, ""); const t = topics.find((x) => x.id === id); return !t || (t.subject !== "Computing" && t.domain !== "Artificial Intelligence"); });
    check(`anchored Computing/AI ${JSON.stringify(ages)} "${topic}": no Roman/Britain/rainforest, none outside subject+domain`, bad(o).length === 0 && out.length === 0, `n=${o.length} bad=${bad(o).map((c) => c.label)} out=${out.map((c) => c.label)}`);
  }
}
{ const o = await src.retrieve({ topic: "AI in daily life", ages: { min: 8, max: 10 }, limit: 12 }); check("control: without anchor the Roman topics still appear (so the guard is what removes them)", bad(o).length >= 2, lab(o).join(" | ")); }
{ const o = await src.retrieve({ topic: "AI in daily life", ages: { min: 8, max: 10 }, course: "ages 19 and up, graduate econometrics", limit: 8 }); check("structured ages 8-10 beat free text 'ages 19 and up' (suggestions present)", o.length > 0, `n=${o.length}`); }
{ const o = await src.retrieve({ topic: "AI in daily life", ages: { min: 19, max: 22 }, course: "ages 9-10 grade 4", limit: 8 }); check("structured ages 19-22 beat free text 'ages 9-10' (no suggestions)", o.length === 0, `n=${o.length}`); }
{ const o = await src.retrieve({ topic: "AI in daily life", ages: { min: 19, max: 22 }, anchor: A, limit: 8 }); check("19-22 with an anchor: still no suggestions", o.length === 0); }
{ const o = await src.retrieve({ topic: "AI in daily life", ages: { min: 20, max: 10 }, limit: 8 }); check("malformed ages fail closed, never to words", o.length === 0); }
{ const o = await src.retrieve({ topic: "AI in daily life", course: "Grade 4 science", limit: 8 }); check("legacy (no ages): free text without a readable band fails closed", o.length === 0); }
{ const o = await src.retrieve({ topic: "AI in daily life", course: "ages 9-10", limit: 8 }); check("legacy (no ages): free text 'ages 9-10' is still read (unchanged G1b behaviour)", o.length > 0, `n=${o.length}`); }
{ const o = await src.retrieve({ topic: "AI in daily life", ages: { min: 8, max: 10 }, anchor: "mt_doesnotexist", limit: 8 }); check("anchor missing from snapshot fails closed", o.length === 0); }
{ const o = await src.retrieve({ topic: "AI in daily life", ages: { min: 15, max: 22 }, limit: 8 }); check("ages 15-22 (overlaps 15 only) still return only topics that overlap 15..22", o.every((c) => { const t = topics.find((x) => "marble:" + x.id === c.ref); return t && t.ageRangeEnd >= 15; }), `n=${o.length}`); }

// ---- course creation validation, no provenance from clients, stage table
const mk = (b) => post("/api/courses", { owner: "teacher:t", title: "t", ...b });
for (const [b, want, name] of [
  [{ ages: { min: 2, max: 9 } }, 400, "min 2"], [{ ages: { min: 5, max: 100 } }, 400, "max 100"], [{ ages: { min: 10, max: 5 } }, 400, "min>max"],
  [{ ages: "8-10" }, 400, "string"], [{ ages: { min: 8.5, max: 10 } }, 400, "fraction"], [{ ages: { min: "8", max: "10" } }, 400, "numeric strings"],
  [{ ages: [8, 10] }, 400, "array"], [{ ages: { min: 8, max: 10 }, marbleAnchor: "mt_nope" }, 400, "unknown anchor"], [{ ages: { min: 8, max: 10 }, marbleAnchor: "../etc" }, 400, "path-like anchor"],
  [{ ages: { min: 8, max: 10 }, marbleAnchor: A }, 201, "good"], [{}, 201, "legacy no ages"],
]) { const r = await mk(b); check(`create ${name} -> ${want}`, r.s === want, String(r.s) + " " + JSON.stringify(r.j?.error ?? r.j?.message ?? "").slice(0, 100)); }
{ const r = await mk({ ages: { min: 8, max: 10 }, marbleAnchor: 12345 }); check("OBS non-string anchor 12345 (not a 400?)", true, `status=${r.s} anchor=${r.j?.view?.course?.marbleAnchor}`); }
for (const [m, st] of [[3, 1], [7, 1], [8, 2], [11, 2], [12, 3], [14, 3], [15, 4], [18, 4], [99, 4]]) {
  const r = await mk({ ages: { min: m, max: Math.max(m, 99) } }); check(`stage for youngest ${m} = ${st}`, r.j?.view?.course?.stage === st, `got ${r.j?.view?.course?.stage}`); }
{ const r = await mk({ ages: { min: 8, max: 10 }, stage: 1, marbleAnchor: A, objectives: [{ id: "mt_X" }], skillMap: { anchor: "mt_X" } }); check("client-sent stage is ignored (derived 2)", r.j?.view?.course?.stage === 2, `got ${r.j?.view?.course?.stage}`); }
{ const r = await mk({}); const v = r.j?.view; check("legacy course view carries no ages/stage/anchor", v && v.course.ages === undefined && v.course.stage === undefined && v.course.marbleAnchor === undefined, JSON.stringify(v?.course).slice(0, 160)); }

app.closeAllConnections?.(); app.close();
console.log(`\n${passes} PASS, ${fails} FAIL`); process.exit(fails ? 1 : 0);
