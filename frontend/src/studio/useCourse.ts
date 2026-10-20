/**
 * useCourse — one course over the real host, for the Studio screens.
 *
 * The same thin-client contract as LiveCourse: read the host's view, post intents. A refusal becomes three plain
 * parts from the one table (lib/refusals.ts, R5) with the host's own words kept for a closed Details. Nothing
 * here decides anything; every verb still leaves as an intent and the gate still decides.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { describeIntent } from "../gate/harness";
import { listPins, pinVersion } from "../gate/pin";
import { host, type HostView, type MaterialInput } from "../gate/transport";
import type { DecisionIntent, TypicalSeconds } from "../gate/types";
import { onPasscodeAsking } from "../browser/passcode";
import { MESSAGES } from "../browser/site";
import { plural } from "../lib/plural";
import { heldFor, keepForCourse, type HeldFile } from "../materials/session";
import { explainRefusal, type Act, type Explained } from "../lib/refusals";
import { recordedNames, type Skipped } from "./sourceUse";

export type WaitKind = "objectives" | "suggest" | "plan";
/**
 * The waiting state ONE step can be in. "passcode" is its own honest phase: the keeper's prompt is open and
 * the teacher, not the model, is the one being waited for — the status line says so and no clock runs.
 * "working" starts the clock at the moment the request actually left, which is after any passcode prompt
 * resolved, never before.
 */
export interface Waiting { kind: WaitKind; phase: "passcode" | "working"; startedAt: number; what: string }
export interface WorkerInfo { configured: boolean; zdr?: boolean; model?: string | null; typicalSeconds?: TypicalSeconds; passcodeRequired?: boolean }


/**
 * B5: a passcode prompt the teacher dismisses ("Not now") is not a failure — nothing was sent and the
 * step is still theirs. The site reports it with the same PASSCODE_REQUIRED code as a wrong code, so the
 * cancelled refusal is recognised by its own sentence (browser/site.ts MESSAGES.cancelled). Suppressing
 * its notice leaves the ONE status line as the only polite live region; a rejected code keeps its notice.
 */
const isPasscodeCancelled = (e: unknown): boolean => {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === "PASSCODE_REQUIRED" && err?.message === MESSAGES.cancelled;
};

/**
 * The teacher-turn words that ride with recorded brief answers. One definition, so the brief step and the
 * onboarding wizard send the SAME intent for the same answers.
 */
export const intakeText = (answers: Record<string, string>): string =>
  answers.outcomes_from === "materials" ? "Propose the outcomes from my materials." : Object.values(answers).join("\n");

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
  // A plain notice (good news, skipped sources) and a refusal (three parts + Details) never show together.
  const [notice, setNoticeText] = useState<string | null>(null);
  const [problem, setProblem] = useState<Explained | null>(null);
  const setNotice = (text: string | null) => { setNoticeText(text); setProblem(null); };
  const refuse = (e: unknown, act: Act) => { setNoticeText(null); setProblem(explainRefusal(e, act)); };
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  // Material text lives in this tab only (materials/session.ts): never in the record, never in storage.
  const [sources, setSourcesState] = useState<HeldFile[]>(() => heldFor(courseId));
  // R6: the sources the host skipped in the last round from sources, so each row can say why. Tab-only, like the text.
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  // ...and the name the host recorded for each source it read (a web page's own title for a link).
  const [recordedAs, setRecordedAs] = useState<Record<string, string>>({});
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

  useEffect(() => { setView(null); setSkipped([]); setRecordedAs({}); setSourcesState(heldFor(courseId)); void reload(); }, [courseId, reload]);

  const setSources = (next: HeldFile[]) => { keepForCourse(courseId, next); setSourcesState(heldFor(courseId)); };

  /** Run one act: busy while it runs, a refusal explained in plain parts, the view reloaded after. */
  const run = (fn: () => Promise<unknown>, act: Act = "other") => {
    setBusy(true);
    setNotice(null);
    return fn()
      .catch((e) => refuse(e, act))
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
  const runAi = (kind: WaitKind, fn: () => Promise<unknown>, act: Act) => {
    setBusy(true);
    setNotice(null);
    setWaiting({ kind, phase: "working", startedAt: Date.now(), what: waitingWhat(kind) });
    return fn()
      .catch((e) => { if (!isPasscodeCancelled(e)) refuse(e, act); })
      .finally(async () => { await reload(); if (live.current) { setWaiting(null); setBusy(false); } });
  };

  const actions = {
    confirmSources: () => run(() => host.confirmCheckpoint(courseId, { id: "files", text: "Confirm the source list." }), "confirm"),
    answerBrief: (answers: Record<string, string>) =>
      run(() => host.answerIntake(courseId, {
        text: intakeText(answers),
        answers,
      }), "brief"),
    confirmBrief: () => run(() => host.confirmCheckpoint(courseId, { id: "outline", text: "Confirm the brief." }), "brief"),
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
            text: intakeText(answers),
            answers,
          });
        }
        if (sources) await host.confirmCheckpoint(courseId, { id: "files", text: "Confirm the source list." });
        await host.confirmCheckpoint(courseId, { id: "outline", text: "Confirm the brief." });
      }, "brief"),
    proposeFromAnswers: () => run(() => host.proposeObjectives(courseId), "propose"),
    proposeFromSources: (materials: MaterialInput[]) =>
      runAi("objectives", async () => {
        const r = await host.proposeFromMaterials(courseId, { materials });
        setSkipped(r.skipped);
        setRecordedAs(recordedNames(materials as { name?: string; url?: string }[], r.skipped, r.materials ?? []));
        if (r.skipped.length) setNotice(`${plural(r.skipped.length, "source was", "sources were")} skipped. Each one says why under Sources.`);
      }, "propose"),
    suggestMore: () => runAi("suggest", () => host.suggestObjectives(courseId), "suggest"),
    /** R4: the teacher's own close of the objectives on an explicit course. The host refuses it while one waits. */
    confirmObjectives: () => run(() => host.confirmObjectives(courseId, { text: "Confirm the objectives." }), "confirm"),
    decide: (intent: DecisionIntent) =>
      run(() => host.decide(courseId, { decisions: [intent], text: describeIntent(intent) }), "decide"),
    draftPlan: () => runAi("plan", () => host.proposePlan(courseId), "plan"),
    confirmPlan: () => run(() => host.confirmPlan(courseId, { text: "Confirm this lesson plan." }), "confirm"),
    publish: () => run(async () => {
      const r = await host.publish(courseId, { text: "Publish the course package." });
      // Pin the published version on this device, as the live page does.
      const { anchor } = await host.anchor(courseId, r.version.version);
      // The published step says so itself; no notice on top of it.
      if (anchor && r.version) pinVersion(anchor);
    }, "publish"),
    exportVersion: () => run(async () => {
      const pkg = await host.exportCourse(courseId);
      download(new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" }), `silicus-course-${view?.versions.at(-1)?.version ?? 0}.json`);
    }),
    pins: () => listPins(courseId),
  };

  return { view, missing, busy, notice, problem, setNotice, waiting, sources, setSources, skipped, recordedAs, reload, actions };
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
  // The brief is one decision: the questions are on screen from the start and one button confirms the
  // source list, the answers and the brief together, so one phrase covers both checkpoints.
  if (!st("files") || !st("outline")) return "Your turn: answer the three questions, then confirm the brief";
  if (!st("objectives")) {
    if (v.proposals.some((p) => p.status === "proposed")) return "Your turn: accept, edit or drop each proposal";
    // R4: an explicit course waits for the teacher's own confirm once something is decided.
    if (v.objectivesMode === "explicit" && v.proposals.some((p) => p.status !== "dropped")) return "Your turn: add more, or confirm the objectives";
    return "Your turn: choose where the first proposals come from";
  }
  if (!v.plan || v.plan.status !== "confirmed") {
    if (!v.plan) return "Your turn: draft the lesson plan";
    if (v.plan.status === "invalidated") return "Your turn: draft a new plan";
    return "Your turn: read the plan, then confirm it";
  }
  // Published with nothing pending: the step is done, so say so instead of asking to publish again.
  const latest = v.versions.at(-1);
  if (latest && v.revision?.drafting !== true) return `Version ${latest.version} is published. Preview it or revise.`;
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
