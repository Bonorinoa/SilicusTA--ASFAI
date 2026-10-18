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
import { heldFor, keepForCourse, type HeldFile } from "../materials/session";
import { suggestRefusalText } from "../live/suggest";

export type WaitKind = "objectives" | "suggest" | "plan";
export interface Waiting { kind: WaitKind; startedAt: number }
export interface WorkerInfo { configured: boolean; zdr?: boolean; model?: string | null; typicalSeconds?: TypicalSeconds }

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

  /** An AI step: the same, plus the waiting state the skeletons read. */
  const runAi = (kind: WaitKind, fn: () => Promise<unknown>, onError: (e: unknown) => string) => {
    setBusy(true);
    setNotice(null);
    setWaiting({ kind, startedAt: Date.now() });
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
