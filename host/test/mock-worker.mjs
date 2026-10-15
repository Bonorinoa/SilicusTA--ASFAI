/**
 * mock-worker.mjs — an in-process fake OSS worker over real loopback HTTP.
 *
 * Same discipline as mock-asfai.mjs: the stub speaks the real wire shape so the
 * client is exercised for real, with no network and no model. `reply` is what the
 * "model" answers; `status` forces a transport failure.
 */
import { createServer } from "node:http";

const DEFAULT_PLAN = {
  title: "A drafted lesson",
  audience: { ageRangeStart: 8, ageRangeEnd: 10 },
  activities: [
    {
      title: "Drafted activity",
      minutes: 20,
      objectiveIds: [],
      learnerDoes: "Do the thing the objective describes.",
      teacherDoes: "Ask what would count as evidence for it.",
      evidenceIfAny: "observation",
    },
  ],
};

export async function startMockWorker({ reply = DEFAULT_PLAN, status = 200 } = {}) {
  const st = { calls: 0, lastPrompt: null, lastAuth: null, lastBody: null };

  const srv = createServer(async (req, res) => {
    const raw = await new Promise((r) => {
      const chunks = [];
      req.on("data", (d) => chunks.push(d));
      req.on("end", () => r(Buffer.concat(chunks).toString("utf8")));
    });
    st.calls += 1;
    st.lastAuth = req.headers.authorization ?? null;
    try {
      st.lastBody = JSON.parse(raw || "{}");
      st.lastPrompt = st.lastBody?.messages?.[0]?.content ?? null;
    } catch {
      st.lastBody = null;
      st.lastPrompt = null;
    }
    // `reply` may be a value, a raw string, or a function of { prompt, body } so a test
    // can echo back the objective ids the client actually sent.
    let content;
    if (typeof reply === "function") {
      const out = await reply({ prompt: st.lastPrompt, body: JSON.parse(raw || "{}") });
      content = typeof out === "string" ? out : JSON.stringify(out);
    } else {
      content = typeof reply === "string" ? reply : JSON.stringify(reply);
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });

  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  return { st, url: `${origin}/v1/chat/completions`, close() { srv.closeAllConnections?.(); srv.close(); } };
}
