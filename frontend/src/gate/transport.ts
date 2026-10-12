/**
 * transport.ts — the Silicus host client.
 *
 * The UI's ONLY way to touch a real course. Every teacher action leaves as an
 * INTENT ({ verb, proposalId, statement, text }) posted to the host, which mints
 * the teacher turn and runs the confirm-gate. The UI never holds the gate, never
 * mints provenance, and never decides anything locally — a refusal comes back as
 * an error carrying the gate's own code/message.
 */
import type { CourseAnchor } from "./pin";
import type {
  LessonPlanView, ObjectiveCiteView, PackageVersionView, PlanInvalidationView,
  ProposalView, PublishStatusView, TimelineEvent,
} from "./types";

export interface HostCheckpoint {
  id: string;
  status: "pending" | "open" | "confirmed";
  provenance: unknown;
  note: string | null;
}

export interface HostLedgerTurn {
  id: string;
  index: number;
  role: "teacher" | "assistant";
  actorId: string;
  channel: string;
  origin: string;
  text: string;
  at: number;
}

export interface HostCourseMeta {
  courseId: string;
  owner: string;
  title: string;
  description: string;
  materials: unknown[];
  createdAt: number;
}

/** Checkpoint 2's host-side gate: the ASFAI intake round, driven by the host. */
export interface IntakeStatus {
  courseId: string;
  guardState: string;
  observedState: "clarifying" | "ready_to_draft" | null;
  roundOpened: boolean;
  roundAnswered: boolean;
  questions: { id: string; prompt: string; reason: string | null }[];
  answeredKeys?: string[];
  /** Teacher words already recorded, keyed by the question id ASFAI asked. */
  answers?: Record<string, string | string[]>;
  draftAuthorization: boolean;
  outlineAuthorized: boolean;
  mayCallPrepareOutline: boolean;
  refusal: { code: string; reason: string } | null;
}

/** The host's course view: gate state, derived rows, ledger and log fingerprint. */
export interface HostView {
  course: HostCourseMeta;
  checkpoints: Record<string, HostCheckpoint>;
  intake: IntakeStatus;
  validations?: PlanValidation[];
  proposals: ProposalView[];
  objectives: ObjectiveCiteView[];
  decisions: unknown[];
  plan: LessonPlanView | null;
  invalidation: PlanInvalidationView;
  publish: PublishStatusView;
  versions: PackageVersionView[];
  timeline: TimelineEvent[];
  ledger: HostLedgerTurn[];
  integrity: { events: number; head: string };
}

export interface AsfaiStatus { connected: boolean; expiresAt: number | null; scope: string | null; canRefresh: boolean }
export interface PlanValidation { planId: string; valid: boolean; issues: string[]; at: number }

export class HostError extends Error {
  code?: string;
  blockers?: string[];
  constructor(message: string, code?: string, blockers?: string[]) {
    super(message);
    this.name = "HostError";
    this.code = code;
    this.blockers = blockers;
  }
}

const BASE = "/api";

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    throw new HostError(
      String(json?.message ?? `${res.status} ${res.statusText}`),
      json?.code ? String(json.code) : undefined,
      Array.isArray(json?.blockers) ? (json.blockers as string[]) : undefined,
    );
  }
  return json as unknown as T;
}

const enc = encodeURIComponent;

export const host = {
  health: () => call<{ ok: boolean; courses: number }>("GET", "/health"),
  listCourses: () => call<{ courses: { courseId: string; owner: string; title: string; createdAt: number }[] }>("GET", "/courses"),
  createCourse: (b: { owner: string; title: string; description?: string; materials?: { name: string }[] }) =>
    call<{ ok: true; courseId: string; view: HostView }>("POST", "/courses", b),
  getCourse: (id: string) => call<HostView>("GET", `/courses/${enc(id)}`),
  exportCourse: (id: string) => call<Record<string, unknown>>("GET", `/courses/${enc(id)}/export`),
  verify: (id: string) => call<{ ok: boolean; events: number; head: string }>("GET", `/courses/${enc(id)}/verify`),
  confirmCheckpoint: (id: string, b: { id: "files" | "outline"; text: string; note?: string }) =>
    call("POST", `/courses/${enc(id)}/checkpoints`, b),
  intake: (id: string) => call<IntakeStatus>("GET", `/courses/${enc(id)}/intake`),
  /** The HOST calls ASFAI's prepare_outline; the UI sends no fields, so none can be smuggled in. */
  callIntake: (id: string) => call<IntakeStatus>("POST", `/courses/${enc(id)}/intake/call`, {}),
  /** The teacher's words, per question id. These are the only source of the second call's fields. */
  answerIntake: (id: string, b: { text?: string; answers?: Record<string, string | string[]> }) =>
    call<IntakeStatus>("POST", `/courses/${enc(id)}/intake/answer`, b),
  validatePlan: (id: string) => call<{ validation: PlanValidation }>("POST", `/courses/${enc(id)}/plan/validate`, {}),
  asfaiStatus: () => call<AsfaiStatus>("GET", "/asfai/status"),
  asfaiConnect: () => call<{ authorizeUrl: string }>("POST", "/asfai/connect", {}),
  anchor: (id: string, version: number) =>
    call<{ anchor: CourseAnchor | null }>("GET", `/courses/${enc(id)}/anchor/${version}`),
  archiveCourse: (id: string, ref?: string) =>
    call<{ saved: boolean; verified: boolean; ref: string; digest: string }>("POST", `/courses/${enc(id)}/archive`, { ref }),
  archives: () => call<{ refs: string[] }>("GET", "/archives"),
  /** The HOST derives the objectives from the teacher's recorded answers; the UI sends no body. */
  proposeObjectives: (id: string) =>
    call<{ proposals: ProposalView[] }>("POST", `/courses/${enc(id)}/objectives`, {}),
  decide: (id: string, b: { decisions: unknown[]; text: string }) =>
    call<{ decisions: unknown[] }>("POST", `/courses/${enc(id)}/decisions`, b),
  proposePlan: (id: string, b: { spec: unknown; assistantText?: string }) =>
    call("POST", `/courses/${enc(id)}/plan`, b),
  confirmPlan: (id: string, b: { text: string; planId?: string }) =>
    call("POST", `/courses/${enc(id)}/plan/confirm`, b),
  publish: (id: string, b: { text: string; note?: string }) =>
    call<{ version: PackageVersionView }>("POST", `/courses/${enc(id)}/publish`, b),
};
