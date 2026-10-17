#!/usr/bin/env node
/**
 * mock-worker.mjs — DEV ONLY. A stand-in for the site's /api/worker so the browser-mode app can be designed
 * locally without a model or a passcode. It answers on 127.0.0.1:8787, where `vite dev` proxies /api.
 *
 *   node scripts/mock-worker.mjs            # 2.5 s delay per call, so waiting states are visible
 *   MOCK_DELAY=0 node scripts/mock-worker.mjs
 *
 * The answers are canned and obviously fake ("[mock]"). The real host still validates every reply exactly as it
 * would a model's: the mock only replaces the model, never the rules. Never deploy this.
 */
import http from "node:http";

const PORT = 8787;
const DELAY = Number(process.env.MOCK_DELAY ?? 2500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function reply(text) {
  const prompt = text;
  // Plan: cite the objective ids exactly as the host listed them.
  if (prompt.startsWith("Draft one lesson plan")) {
    const ids = [...prompt.matchAll(/^- (\S+): /gm)].map((m) => m[1]);
    const a = ids[0], b = ids[1] ?? ids[0];
    return {
      title: "How plants eat",
      audience: { ageRangeStart: 9, ageRangeEnd: 10 },
      activities: [
        { title: "Leaf detectives", minutes: 10, objectiveIds: [a], learnerDoes: "Look closely at a real leaf with a hand lens and draw what they see.", teacherDoes: "Ask what the leaf might need from its surroundings.", evidenceIfAny: "observation" },
        { title: "The plant's recipe", minutes: 20, objectiveIds: [b], learnerDoes: "Sort picture cards into what a plant takes in and what it makes.", teacherDoes: "Name sunlight, water and carbon dioxide as the three ingredients.", evidenceIfAny: "work-product" },
        { title: "Explain it to a friend", minutes: 15, objectiveIds: [...new Set([a, b])], learnerDoes: "Explain to a partner how a plant makes its food, using the three ingredients.", teacherDoes: "Listen in and note who uses all three words.", evidenceIfAny: "observation" },
      ],
    };
  }
  if (prompt.startsWith("SUGGEST")) {
    return { objectives: [{ statement: "Students can describe where the oxygen we breathe comes from." }, { statement: "Students can label the parts of a leaf." }] };
  }
  if (prompt.startsWith("Propose learning objectives")) {
    const name = (prompt.match(/^=== MATERIAL: (.+) ===$/m) ?? [])[1]?.trim();
    const from = name ? [name] : [];
    return {
      objectives: [
        { statement: "Students can explain how a plant makes its food.", from },
        { statement: "Students can name what a plant needs to make sugar.", from },
        { statement: "Students can describe where the oxygen we breathe comes from.", from },
      ],
    };
  }
  if (prompt.startsWith("You are a study helper")) {
    const q = (prompt.trim().split("\n").at(-1) ?? "").replace(/^Student:\s*/, "").toLowerCase();
    if (/grade|pass|how am i doing|score|mark/.test(q)) return { inScope: false, basis: "plan", refusal: "assessment", answer: "", cites: [] };
    if (/game|ignore|instructions|address|my name/.test(q)) return { inScope: false, basis: "plan", refusal: "off_topic", answer: "", cites: [] };
    if (/what (is|does|are)|mean/.test(q)) return { inScope: true, basis: "explanation", refusal: null, answer: "[mock] It's the way a plant turns sunlight, water and air into its own food, in its leaves.", cites: ["objective:1"] };
    return { inScope: true, basis: "plan", refusal: null, answer: "[mock] A plant needs sunlight, water and carbon dioxide from the air. It uses them in its leaves to make sugar.", cites: ["objective:1", "activity:2"] };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "GET" && req.url === "/api/worker/status") {
    return send(200, { configured: true, zdr: false, provider: "mock", passcodeRequired: false, model: "mock", typicalSeconds: { objectives: [3, 15], plan: [5, 25], answer: [2, 8] } });
  }
  if (req.method === "POST" && req.url === "/api/worker") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const text = (body.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
    const out = reply(text);
    await sleep(DELAY);
    if (!out) return send(502, { ok: false, code: "UPSTREAM_ERROR" });
    return send(200, { choices: [{ message: { role: "assistant", content: JSON.stringify(out) }, finish_reason: "stop" }] });
  }
  if (req.url?.startsWith("/api/fetch")) return send(501, { ok: false, code: "NOT_IN_MOCK", message: "The mock worker doesn't fetch web pages." });
  send(404, { ok: false, code: "NOT_FOUND" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock worker on http://127.0.0.1:${PORT} (delay ${DELAY} ms) — dev only`));
