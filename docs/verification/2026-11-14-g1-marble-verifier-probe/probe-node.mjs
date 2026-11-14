// G1V probe, Node host. Run: node --import ./net-block.mjs probe-node.mjs  (cwd anywhere; ROOT = tree under test)
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.env.ROOT;
const { createApp } = await import(`${ROOT}/host/server.mjs`);
const { MarbleSource } = await import(`${ROOT}/host/sources/marble.mjs`);
const { createMarbleService, audienceAges } = await import(`${ROOT}/host/marble/marble-graph.mjs`);

const dir = mkdtempSync(join(process.env.SCRATCH, "g1v-data-"));
const app = createApp({ dataDir: dir, workerEnv: {} });           // default sources: asfai, local-ontology, marble
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`;
const get = async (p, init) => { const r = await fetch(base + p, init); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j }; };
const post = (p, b) => get(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

const snapshotDir = () => {
  const out = {}; const walk = (d) => readdirSync(d).forEach((n) => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : (out[p.slice(dir.length)] = createHash("sha256").update(readFileSync(p)).digest("hex") + ":" + statSync(p).size); });
  walk(dir); return out;
};

console.log("== status");
const st = await get("/api/knowledge/status"); console.log(JSON.stringify(st));
const c = await post("/api/courses", { owner: "teacher:tk-1", title: "probe course" });
console.log("course", c.status);
const before = snapshotDir(); console.log("files before", Object.keys(before));

console.log("== demo edges (Node host routes)");
for (const id of ["mt_WRRv1ABECC", "mt_AzTrT5ySCx", "mt_u6SYiVx7FX", "mt_kH1DzOPsXG"]) {
  const t = await get(`/api/knowledge/marble/topics/${id}`);
  console.log(id, t.status, t.json.name, `ages ${t.json.ageRangeStart}-${t.json.ageRangeEnd}`,
    "hard-prereq:", (t.json.prerequisites?.hard ?? []).map((x) => x.topicId).join(",") || "-",
    "soft-prereq:", (t.json.prerequisites?.soft ?? []).map((x) => x.topicId).join(",") || "-",
    "dependents:", (t.json.dependents ?? []).map((x) => `${x.topicId}/${x.strength}`).join(",") || "-");
}
console.log("== search AI in daily life ages 5-12");
const s1 = await get("/api/knowledge/marble/search?q=AI%20in%20daily%20life&ageMin=5&ageMax=12&limit=5");
console.log(s1.status, s1.json.hits.map((h) => `${h.id}:${h.name}:${h.ageRangeStart}-${h.ageRangeEnd}:${h.score}`));
console.log("== age filter: ages 3-4 only, 'AI in daily life'");
const s2 = await get("/api/knowledge/marble/search?q=AI%20in%20daily%20life&ageMin=3&ageMax=4&limit=5");
console.log(s2.status, s2.json.hits.map((h) => `${h.name}:${h.ageRangeStart}-${h.ageRangeEnd}`), "every hit overlaps 3-4:", s2.json.hits.every((h) => h.ageRangeStart <= 4 && h.ageRangeEnd >= 3));
console.log("== maximum likelihood, route, ages 19-25");
const ml19 = await get("/api/knowledge/marble/search?q=maximum%20likelihood&ageMin=19&ageMax=25");
console.log(ml19.status, "hits:", ml19.json.hits.length);
const ml = await get("/api/knowledge/marble/search?q=maximum%20likelihood");
console.log("same, default 3-15 ages:", ml.json.hits.map((h) => `${h.name} ${h.ageRangeStart}-${h.ageRangeEnd}`));

console.log("== edge cases");
for (const p of ["/api/knowledge/marble/topics/%", "/api/knowledge/marble/topics/%E0%A4%A", "/api/knowledge/marble/topics/", "/api/knowledge/marble/search?q=x&ageMin=abc&ageMax=&limit=-5", "/api/knowledge/marble/search?q=x&ageMin=12&ageMax=5", "/api/knowledge/marble/nope", "/api/knowledge/marble/topics/__proto__", "/api/knowledge/marble/topics/constructor"]) {
  const r = await get(p); console.log(p, "->", r.status, typeof r.json === "string" ? r.json.slice(0, 80) : JSON.stringify(r.json).slice(0, 120));
}
const pr = await post("/api/knowledge/marble/search?q=AI", { q: "x" }); console.log("POST search ->", pr.status, JSON.stringify(pr.json).slice(0, 100));

const after = snapshotDir();
console.log("== course dir unchanged by all the route calls:", JSON.stringify(before) === JSON.stringify(after));

console.log("== MarbleSource retrieve at the audience boundary (real snapshot, network blocked)");
const marble = createMarbleService(async () => readFileSync(`${ROOT}/host/data/marble/marble-snapshot.json`, "utf8"));
const src = new MarbleSource({ marble });
console.log("egress", src.egress, "canVerify", src.canVerify, "enabled", src.enabled, "id", src.id, "namespace", src.namespace);
const cases = [
  ["maximum likelihood", "University econometrics, ages 19 and up"],
  ["maximum likelihood", "a 19-year-old course"],
  ["maximum likelihood", "aged 19"],
  ["maximum likelihood", "ages 19-22"],
  ["maximum likelihood", "ages 8-10"],
  ["maximum likelihood", "How machines notice things"],
  ["maximum likelihood", "University econometrics"],
  ["maximum likelihood", "undergraduate econometrics, college sophomores"],
  ["maximum likelihood", "Year 13 students"],
  ["maximum likelihood", "grade 12, 17 and 18 year olds"],
  ["maximum likelihood", "16 to 18 year olds"],
  ["maximum likelihood", "adult learners"],
  ["maximum likelihood", ""],
  ["AI in daily life", "12 to 17 year olds"],
  ["AI in daily life", "3 to 5 year olds"],
  ["AI in daily life", "ages 16-18"],
];
for (const [topic, course] of cases) {
  const out = await src.retrieve({ topic, objectives: [], course, limit: 8 });
  console.log(JSON.stringify(course).padEnd(52), "band", JSON.stringify(audienceAges(course)), "->", out.length, out.slice(0, 3).map((x) => x.label).join(" | "));
}
console.log("== an AI-in-daily-life course ages 8-10: all retrieved refs, in order");
const rr = await src.retrieve({ topic: "AI in daily life", objectives: [{ id: "x", statement: "name a smart device" }], course: "AI literacy, ages 8-10", limit: 8 });
rr.forEach((x) => console.log("  ", x.ref, x.label));

console.log("== network attempts so far:", JSON.stringify(globalThis.__attempts));
app.closeAllConnections?.(); app.close();
