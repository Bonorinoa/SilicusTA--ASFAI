/**
 * useCourse — one course over the real host, for the Studio screens.
 *
 * The same thin-client contract as LiveCourse: read the host's view, post intents, show refusals in the host's
 * own words. Nothing here decides anything; every verb still leaves as an intent and the gate still decides.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { describeIntent } from "../gate/harness";
import { listPins, pinVersion } from "../gate/pin";
import { host, type HostView, type MaterialInput } from "../gate/transport";
import type { DecisionIntent, TypicalSeconds } from "../gate/types";
import { onPasscodeAsking } from "../browser/passcode";
import { plural } from "../lib/plural";
import { heldFor, keepForCourse, type HeldFile } from "../materials/session";
import { suggestRefusalText } from "../live/suggest";

export type WaitKind = "objectives" | "suggest" | "plan";
/**
 * The waiting state ONE step can be in. "passcode" is its own honest phase: the keeper's prompt is open and
 * the teacher, not the model, is the one being waited for — the status line says so and no clock runs.
 * "working" starts the clock at the moment the request actually left, which is after any passcode prompt
 * resolved, never before.
 */
export interface Waiting { kind: WaitKind; phase: "passcode" | "working"; startedAt: number; what: string }
export interface WorkerInfo { configured: boolean; zdr?: boolean; model?: string | null; typicalSeconds?: TypicalSeconds; passcodeRequired?: boolean }

const sentence = (m: string) => { const t = m.trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : ""; };
const messageOf = (e: unknown) => sentence(e instanceof Error ? e.message : String(e));

/** The worker's status, shared by every Studio screen. */
export function useWorker(): WorkerInfo | null {
  const [worker, setWorker] = useState<WorkerInfo | null>(null);
  useEffect(() => {
    void host.workerStatus().then((w) => setWorker(w as WorkerInfo)).catch(() => setWorker({ configured: false }));
  }, []);
  return worker;
}

export function useCourse(courseId: string) {
  const [view, setView] = useState<HostView | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  // Material text lives in this tab only (materials/session.ts): never in the record, never in storage.
  const [sources, setSourcesState] = useState<HeldFile[]>(() => heldFor(courseId));
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const reload = useCallback(async (): Promise<HostView | null> => {
    try {
      const fresh = await host.getCourse(courseId);
      if (live.current) { setView(fresh); setMissing(false); }
      return fresh;
    } catch {
      if (live.current) setMissing(true);
      return null;
    }
  }, [courseId]);

  useEffect(() => { setView(null); setSourcesState(heldFor(courseId)); void reload(); }, [courseId, reload]);

  const setSources = (next: HeldFile[]) => { keepForCourse(courseId, next); setSourcesState(heldFor(courseId)); };

  /** Run one act: busy while it runs, refusal as the notice, the view reloaded after. */
  const run = (fn: () => Promise<unknown>, prefix = "") => {
    setBusy(true);
    setNotice(null);
    return fn()
      .catch((e) => setNotice(prefix ? `${prefix} ${messageOf(e)}` : messageOf(e)))
      .finally(async () => { await reload(); if (live.current) setBusy(false); });
  };

  /** The status line's doing-phrase for one AI step, counted from data already in hand — never invented. */
  const waitingWhat = (kind: WaitKind): string => {
    if (kind === "plan") return `drafting from ${plural(view?.objectives.length ?? 0, "confirmed objective")}`;
    if (kind === "suggest") return "finding objectives that round out yours";
    return sources.length > 0 ? `reading ${plural(sources.length, "source")}` : "reading your sources";
  };

  // B1: in the online build the passcode prompt is awaited inside the worker fetch. While a prompt is open
  // the step is in the "passcode" phase (no clock); when it resolves the clock starts — the moment the
  // request actually leaves. Only the boolean leaves passcode.ts; the value never does.
  useEffect(() => onPasscodeAsking((open) => {
    if (!live.current) return;
    if (open) setWaiting((w) => w && w.phase === "working" ? { ...w, phase: "passcode" } : w);
    else setWaiting((w) => w && w.phase === "passcode" ? { ...w, phase: "working", startedAt: Date.now() } : w);
  }), []);

  /** An AI step: the same, plus the waiting state the one status line reads. */
  const runAi = (kind: WaitKind, fn: () => Promise<unknown>, onError: (e: unknown) => string) => {
    setBusy(true);
    setNotice(null);
    setWaiting({ kind, phase: "working", startedAt: Date.now(), what: waitingWhat(kind) });
    return fn()
      .catch((e) => setNotice(onError(e)))
      .finally(async () => { await reload(); if (live.current) { setWaiting(null); setBusy(false); } });
  };

  const actions = {
    confirmSources: () => run(() => host.confirmCheckpoint(courseId, { id: "files", text: "Confirm the source list." })),
    answerBrief: (answers: Record<string, string>) =>
      run(() => host.answerIntake(courseId, {
        text: answers.outcomes_from === "materials" ? "Propose the outcomes from my materials." : Object.values(answers).join("\n"),
        answers,
      }), "Not saved."),
    confirmBrief: () => run(() => host.confirmCheckpoint(courseId, { id: "outline", text: "Confirm the brief." })),
    /**
     * One click, up to three intents, stopping at the first refusal: record the answers (when anything
     * is unsaved or changed), confirm the source list (when it is not on the record yet), then confirm
     * the outline. The host requires files before outline but accepts intake answers before 'files', so
     * the order above is the honest one. Every step is still a normal intent; nothing is decided here.
     */
    confirmTheBrief: (answers: Record<string, string> | null, { sources = false }: { sources?: boolean } = {}) =>
      run(async () => {
        if (answers) {
          await host.answerIntake(courseId, {
            text: answers.outcomes_from === "materials" ? "Propose the outcomes from my materials." : Object.values(answers).join("\n"),
            answers,
          });
        }
        if (sources) await host.confirmCheckpoint(courseId, { id: "files", text: "Confirm the source list." });
        await host.confirmCheckpoint(courseId, { id: "outline", text: "Confirm the brief." });
      }, "The brief wasn't confirmed."),
    proposeFromAnswers: () => run(() => host.proposeObjectives(courseId), "Nothing was proposed."),
    proposeFromSources: (materials: MaterialInput[]) =>
      runAi("objectives", async () => {
        const r = await host.proposeFromMaterials(courseId, { materials });
        if (r.skipped.length) setNotice(`Some material was skipped: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}`);
      }, (e) => `Nothing was proposed. ${messageOf(e)}`),
    suggestMore: () => runAi("suggest", () => host.suggestObjectives(courseId), suggestRefusalText),
    decide: (intent: DecisionIntent) =>
      run(() => host.decide(courseId, { decisions: [intent], text: describeIntent(intent) }), "Not recorded."),
    draftPlan: () => runAi("plan", () => host.proposePlan(courseId), (e) => `No plan was drafted. ${messageOf(e)}`),
    confirmPlan: () => run(() => host.confirmPlan(courseId, { text: "Confirm this lesson plan." })),
    publish: () => run(async () => {
      const r = await host.publish(courseId, { text: "Publish the course package." });
      // Pin the published version on this device, as the live page does.
      const { anchor } = await host.anchor(courseId, r.version.version);
      // The published step says so itself; no notice on top of it.
      if (anchor && r.version) pinVersion(anchor);
    }),
    exportVersion: () => run(async () => {
      const pkg = await host.exportCourse(courseId);
      download(new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" }), `silicus-course-${view?.versions.at(-1)?.version ?? 0}.json`);
    }),
    pins: () => listPins(courseId),
  };

  return { view, missing, busy, notice, setNotice, waiting, sources, setSources, reload, actions };
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Display-only: which of the four steps the work is in. The host still decides what is allowed. */
export type StepId = "brief" | "objectives" | "plan" | "publish";
export const STEP_LIST: { id: StepId; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "objectives", label: "Objectives" },
  { id: "plan", label: "Plan" },
  { id: "publish", label: "Publish" },
];

export function currentStep(v: HostView): StepId {
  const st = (id: string) => v.checkpoints[id]?.status;
  if (st("files") !== "confirmed" || st("outline") !== "confirmed") return "brief";
  if (st("objectives") !== "confirmed") return "objectives";
  if (!v.plan || v.plan.status !== "confirmed") return v.plan || v.objectives.length > 0 ? "plan" : "objectives";
  return "publish";
}

export function stepDone(v: HostView, id: StepId): boolean {
  const st = (k: string) => v.checkpoints[k]?.status === "confirmed";
  if (id === "brief") return st("files") && st("outline");
  if (id === "objectives") return st("objectives");
  if (id === "plan") return v.plan?.status === "confirmed";
  return v.versions.length > 0 && v.revision?.drafting !== true;
}

/**
 * The one status line when the teacher must act (B2). A short "Your turn: …" naming what the host view
 * says is expected now, derived ONLY from the view: no tab state, no form state, nothing promised.
 */
export function turnPhrase(v: HostView): string {
  const st = (id: string) => v.checkpoints[id]?.status === "confirmed";
  if (!st("files")) return "Your turn: confirm the source list";
  if (!st("outline")) return "Your turn: answer the three questions";
  if (!st("objectives")) {
    return v.proposals.some((p) => p.status === "proposed")
      ? "Your turn: accept, edit or drop each proposal"
      : "Your turn: choose where the first proposals come from";
  }
  if (!v.plan || v.plan.status !== "confirmed") {
    if (!v.plan) return "Your turn: draft the lesson plan";
    if (v.plan.status === "invalidated") return "Your turn: draft a new plan";
    return "Your turn: read the plan, then confirm it";
  }
  return "Your turn: review and publish";
}

/**
 * One spoken sentence for a step transition (B4), announced once through the status line when the work
 * moves on — objectives confirmed, the brief confirmed, the plan confirmed. Anything else is silent.
 */
export function stepTransition(from: StepId, to: StepId): string {
  if (from === "brief" && to === "objectives") return "The brief is confirmed. On to the objectives.";
  if (from === "objectives" && to === "plan") return "Objectives confirmed. On to the plan.";
  if (from === "plan" && to === "publish") return "The plan is confirmed. On to publish.";
  return "";
}
