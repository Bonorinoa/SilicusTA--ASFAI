/**
 * worker.mjs — the OSS worker seam (a plan drafter).
 *
 * The mission's rule: OSS models as WORKERS, never the source of truth. This is
 * the one step in the slice that needs generation — a plan's activity prose,
 * minutes and teacher/learner moves cannot be quoted from anything the teacher
 * already said. So it goes behind this seam, which is:
 *
 *   - OFF by default (no url + model = not enabled), so the product runs and the
 *     suite passes with no model at all;
 *   - an OUTBOUND call from an otherwise loopback-only, zero-dependency host, so
 *     https-only (loopback http for the test stub) and never a token in a URL;
 *   - UNTRUSTED INPUT on the way back. The model's output is validated against
 *     the gate's own rules and refused on any violation. A worker can propose;
 *     it can never widen what the gate accepts, and it never confirms anything.
 */
import { EVIDENCE_KINDS } from "../confirm-gate/confirm-gate.mjs";

/** A worker failure that is a refusal, not a crash. */
export class WorkerError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
  }
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/** https anywhere; http only to loopback (the test stub). A worker URL is config, never a request field. */
function assertUsableUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new WorkerError("WORKER_BAD_URL", "the worker url is not a valid URL");
  }
  if (u.protocol === "https:") return u;
  if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return u;
  throw new WorkerError("WORKER_BAD_URL", "the worker url must be https, or http on loopback");
}

export class PlanWorker {
  #url;
  #model;
  #apiKey;
  #fetch;

  /**
   * @param {{url?: string|null, model?: string|null, apiKey?: string|null, fetchImpl?: typeof fetch}} [config]
   */
  constructor({ url = null, model = null, apiKey = null, fetchImpl = null } = {}) {
    this.#url = url ? assertUsableUrl(url) : null;
    this.#model = model ? String(model) : null;
    this.#apiKey = apiKey ? String(apiKey) : null;
    this.#fetch = fetchImpl ?? fetch;
  }

  /** A worker is configured or it is not. Not configured is a state, never an outage. */
  get enabled() {
    return Boolean(this.#url && this.#model);
  }

  /**
   * Draft a plan from the teacher's CONFIRMED objectives. The returned spec is
   * unvalidated by the gate at this point; the caller proposes it and the gate
   * has the last word.
   *
   * @param {{objectives: {id: string, statement: string}[], topic?: string, materials?: string[]}} input
   */
  async draft({ objectives = [], topic = "", materials = [] } = {}) {
    if (!this.enabled) {
      throw new WorkerError(
        "WORKER_NOT_CONFIGURED",
        "no drafting worker is configured (set SILICUS_WORKER_URL and SILICUS_WORKER_MODEL)",
      );
    }
    if (objectives.length === 0) {
      throw new WorkerError("NO_CONFIRMED_OBJECTIVES", "there are no confirmed objectives to draft from");
    }

    const body = {
      model: this.#model,
      messages: [{ role: "user", content: buildPrompt({ objectives, topic, materials }) }],
    };
    const headers = { "content-type": "application/json" };
    if (this.#apiKey) headers.authorization = `Bearer ${this.#apiKey}`;

    let res;
    try {
      res = await this.#fetch(this.#url, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new WorkerError("WORKER_UNREACHABLE", `the drafting worker could not be reached: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new WorkerError("WORKER_UNREACHABLE", `the drafting worker answered ${res.status}`);

    let payload;
    try {
      payload = await res.json();
    } catch {
      throw new WorkerError("WORKER_BAD_OUTPUT", "the worker's response was not JSON");
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new WorkerError("WORKER_BAD_OUTPUT", "the worker returned no message content");

    let spec;
    try {
      spec = JSON.parse(stripFence(content));
    } catch {
      throw new WorkerError("WORKER_BAD_OUTPUT", "the worker's message was not a JSON plan");
    }
    return validateSpec(spec, objectives);
  }
}

/** Models like to wrap JSON in a markdown fence. Accept it, then validate hard. */
function stripFence(s) {
  const t = String(s).trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

function buildPrompt({ objectives, topic, materials }) {
  return [
    "Draft one lesson plan for a teacher, using ONLY the objectives below.",
    "Cite each activity's objectiveIds exactly as given. Do not invent objectives.",
    "Answer with JSON only, no prose, in this shape:",
    '{"title": string, "audience": {"ageRangeStart": number, "ageRangeEnd": number},',
    ' "activities": [{"title": string, "minutes": number, "objectiveIds": [string],',
    '  "learnerDoes": string, "teacherDoes": string, "evidenceIfAny": "none"|"observation"|"work-product"}]}',
    `evidenceIfAny must be one of: ${EVIDENCE_KINDS.join(", ")}.`,
    "Student chat is never evidence of learning.",
    "",
    `Topic: ${topic || "(not given)"}`,
    `Materials: ${materials.length ? materials.join("; ") : "(none named)"}`,
    "Objectives:",
    ...objectives.map((o) => `- ${o.id}: ${o.statement}`),
  ].join("\n");
}

/**
 * The gate's rules, applied to a model's output BEFORE it is proposed. A worker
 * that violates them produces a refusal, not a course with a broken plan in it.
 */
function validateSpec(spec, objectives) {
  if (!spec || typeof spec !== "object") throw new WorkerError("WORKER_BAD_OUTPUT", "the worker returned no plan object");
  const title = typeof spec.title === "string" ? spec.title.trim() : "";
  if (!title) throw new WorkerError("WORKER_BAD_OUTPUT", "the worker's plan has no title");

  const activities = Array.isArray(spec.activities) ? spec.activities : [];
  if (activities.length === 0) throw new WorkerError("WORKER_BAD_OUTPUT", "the worker's plan has no activities");

  const known = new Set(objectives.map((o) => o.id));
  const normalized = activities.map((a) => {
    if (!a || typeof a !== "object") throw new WorkerError("WORKER_BAD_OUTPUT", "an activity is not an object");
    const ids = Array.isArray(a.objectiveIds) ? a.objectiveIds.map(String) : [];
    if (ids.length === 0) throw new WorkerError("WORKER_BAD_OUTPUT", `activity "${String(a.title)}" cites no objective`);
    for (const id of ids) {
      if (!known.has(id)) {
        throw new WorkerError("WORKER_BAD_OUTPUT", `activity cites an objective we did not send: ${id}`);
      }
    }
    const evidenceIfAny = a.evidenceIfAny ?? "none";
    if (!EVIDENCE_KINDS.includes(evidenceIfAny)) {
      throw new WorkerError("WORKER_BAD_OUTPUT", `evidenceIfAny must be one of ${EVIDENCE_KINDS.join("|")}, got: ${String(evidenceIfAny)}`);
    }
    const learnerDoes = typeof a.learnerDoes === "string" ? a.learnerDoes.trim() : "";
    const teacherDoes = typeof a.teacherDoes === "string" ? a.teacherDoes.trim() : "";
    if (!learnerDoes) throw new WorkerError("WORKER_BAD_OUTPUT", `activity "${String(a.title)}" says nothing the learner does`);
    if (!teacherDoes) throw new WorkerError("WORKER_BAD_OUTPUT", `activity "${String(a.title)}" says nothing the teacher does`);
    return {
      title: String(a.title ?? "").trim() || "Untitled activity",
      minutes: Number.isFinite(a.minutes) ? a.minutes : 0,
      objectiveIds: ids,
      learnerDoes,
      teacherDoes,
      evidenceIfAny,
    };
  });

  const audience = spec.audience && typeof spec.audience === "object" ? { ...spec.audience } : undefined;
  return { title, ...(audience ? { audience } : {}), activities: normalized };
}
