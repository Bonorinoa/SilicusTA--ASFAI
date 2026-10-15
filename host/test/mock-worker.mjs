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

export async function startMockWorker({ reply = DEFAULT_PLAN, status = 200, shape = "openai", finishReason = undefined } = {}) {
  const st = { calls: 0, lastPrompt: null, lastAuth: null, lastBody: null, lastHeaders: null };

  const srv = createServer(async (req, res) => {
    const raw = await new Promise((r) => {
      const chunks = [];
      req.on("data", (d) => chunks.push(d));
      req.on("end", () => r(Buffer.concat(chunks).toString("utf8")));
    });
    st.calls += 1;
    st.lastAuth = req.headers.authorization ?? null;
    st.lastHeaders = req.headers;
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
    // "anthropic" speaks the Messages API: typed content blocks (a thinking block may precede the text).
    res.end(JSON.stringify(shape === "anthropic"
      ? { id: "msg_test", type: "message", role: "assistant", content: [{ type: "thinking", thinking: "..." }, { type: "text", text: content }], stop_reason: "end_turn" }
      : { choices: [{ message: { content }, ...(finishReason ? { finish_reason: finishReason } : {}) }] }));
  });

  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  return { st, url: `${origin}/v1/chat/completions`, close() { srv.closeAllConnections?.(); srv.close(); } };
}
