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
  sessions: [
    { session: 1, evidence: { kind: "work-product", whatLearnerProduces: "Each child's sorted card strip with one written reason." } },
  ],
  spacedReviews: [
    { afterDays: 7, form: "far-transfer", whatChanges: "new examples in a picture of a shop instead of the lesson's cards", prompt: "Spot the AI in this shop picture and say how you know." },
  ],
  aiPolicy: "AI in this course: teacher-led and projected to the whole class, only after children state their own view first; no child uses AI alone.",
  activities: [
    {
      title: "What do we think it is?",
      minutes: 10,
      objectiveIds: ["urn:uuid:aaa"],
      learnerDoes: "Look at two pictures, one with a face-recognition camera, and say which uses AI and why.",
      teacherDoes: "Ask each pair what they think before saying anything about either device.",
      evidenceIfAny: "observation",
      phase: 1,
      targetOperation: "distinguish an AI use from a non-AI one",
      operationDoneBy: "learner",
      learnerFirst: "Each pair gives a guess and its reason.",
      helpAfter: "teacher",
      aiStatus: "forbidden",
      decisionAfterHelp: "Each pair keeps or changes its guess after the teacher explains, and says why.",
      channels: ["speaking", "discussion"],
      session: 1,
    },
    {
      title: "Sort the examples",
      minutes: 20,
      objectiveIds: ["urn:uuid:bbb"],
      learnerDoes: "Sort five everyday cards into AI and not AI, then fix the sorts the class disagrees on.",
      teacherDoes: "Project the sorted cards and the class checks each one.",
      evidenceIfAny: "work-product",
      phase: 2,
      supportingPhase: 3,
      targetOperation: "apply the rule behind which devices decide",
      operationDoneBy: "learner",
      learnerFirst: "Each pair sorts the cards alone first.",
      helpAfter: "worked-example",
      aiStatus: "permitted",
      noAiAlternative: "The same sorting with paper cards only.",
      decisionAfterHelp: "Each pair keeps or changes each card after the class check and says why.",
      channels: ["handling", "writing"],
      session: 1,
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
