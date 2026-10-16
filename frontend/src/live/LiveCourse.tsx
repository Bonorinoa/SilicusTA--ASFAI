/**
 * LiveCourse.tsx — the one-teacher story over the REAL host.
 *
 * Everything here is a thin client of the Silicus host: it reads a course view
 * and posts intents. It never constructs a gate, never mints provenance, and
 * never decides anything locally — a refusal surfaces the gate's own message.
 * The AI's moves (propose) are labelled as the assistant's; the teacher's moves
 * (accept / rename / drop / add / confirm / publish) all go through the host's
 * inbound-message hook, which is the only place a teacher turn can be recorded.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DecisionCard } from "../components/DecisionCard";
import { AiWaiting, newWaitClock, stopWaitClock, answerText, describeStep, materialNamesOf, planReceipt, proposalsReceipt, type ReceiptView, type WaitClock, type WaitingPhase, type WaitingStep } from "../components/AiWaiting";
import { ActivityRail } from "../components/ActivityRail";
import { FirstRunTour } from "../components/FirstRunTour";
import { PlanCard } from "../components/PlanCard";
import { PublishCard } from "../components/PublishCard";
import { TimelineCard } from "../components/TimelineCard";
import { describeIntent } from "../gate/harness";
import { comparePin, listPins, pinVersion, type CoursePin } from "../gate/pin";
import { host, type AsfaiStatus, type CourseSummary, type HostView, type MaterialInput } from "../gate/transport";
import { BROWSER_MODE } from "../gate/mode";
import { plural } from "../lib/plural";
import { BrowserRecord, type RecordStatus } from "../browser/BrowserRecord";
import { PasscodeDialog } from "../browser/PasscodeDialog";
import type { ActivityActor, DecisionIntent } from "../gate/types";
import { OnboardingChat } from "./OnboardingChat";
import { MaterialsPanel } from "./MaterialsPanel";
import { StudentChat } from "./StudentChat";
import { RevisionPanel } from "./RevisionPanel";
import { CourseLibrary } from "./CourseLibrary";
import { buildHandoutHtml, handoutFilename } from "./handout";
import { VersionDiffPanel } from "./VersionDiffPanel";
import { stageOf, type Stage } from "./stage";
import { StepIndex, STEPS, workStep, type StepId } from "./StepIndex";
import { StageBar } from "./StageBar";
import { EarlierSteps, type EarlierStep } from "./EarlierSteps";
import { PublishedMoment } from "./PublishedMoment";
import { RecordDetails } from "./RecordDetails";
import styles from "./LiveCourse.module.css";
import stageStyles from "./Stage.module.css";
/** One AI step in flight, or just finished: what the waiting card shows. `receipt` is computed from the resulting view. */
/** `clock` is the step's own: the card is remounted in whichever stage is open, so the card cannot own the time. */
interface Waiting { id: number; step: WaitingStep; phase: WaitingPhase; receipt: string[]; startedAt: number; clock: WaitClock }
/** A step in flight that has no waiting card of its own (ASFAI's, a student's answer): the rail still says who is working. */
interface Working { actor: ActivityActor; label: string; startedAt: number }

/** Move the page. A no-op where there is no layout to move (the test DOM). */
const scrollToY = (y: number): void => { if (!/jsdom/i.test(navigator.userAgent)) window.scrollTo({ top: y, left: 0 }); };
/** Where "Back" goes, in the teacher's words, by the stage the work is in. */
const BACK_LABEL: Record<Stage, string> = {
  intake: "Back to the brief", material: "Back to the material", objectives: "Back to the objectives",
  plan: "Back to the plan", publish: "Back to publishing", published: "Back to the published version",
};

const STUDENT_INPUT_ID = "student-question";
const TOUR_SEEN = "silicus.tour.seen";
/** The tour's "seen" flag lives on this device, never in the record. A browser that will not store it just shows the tour again. */
const tourSeen = (): boolean => { try { return window.localStorage.getItem(TOUR_SEEN) === "1"; } catch { return false; } };
const markTourSeen = (): void => { try { window.localStorage.setItem(TOUR_SEEN, "1"); } catch { /* shown again next time; harmless */ } };
/** What "propose objectives" sends, read from the page: the material in memory plus what the teacher already told the host. */
function objectivesStep(materials: MaterialInput[], view: HostView): WaitingStep {
  const answers = view.intake.answers ?? {};
  return {
    kind: "objectives",
    materials: materials.map((m) => ("url" in m ? { kind: "link" as const, url: m.url } : { kind: "text" as const, name: m.name, chars: m.text.length })),
    topic: answerText(answers.topic),
    course: answers.course === undefined ? view.course.title : answerText(answers.course),
  };
}

/** What "draft the plan" sends: the confirmed objective statements, the topic, and the NAMES of the listed materials. */
function planStep(view: HostView): WaitingStep {
  return {
    kind: "plan",
    objectives: view.objectives.map((o) => o.statement),
    topic: answerText(view.intake.answers?.topic),
    // The host puts the teacher's course answer (its length, its audience) in the prompt, so the disclosure lists it too.
    course: answerText(view.intake.answers?.course),
    materialNames: materialNamesOf(view.course.materials),
    referenceNotes: !BROWSER_MODE,
  };
}

/** A refusal message as a sentence: capitalised, ending in a full stop. */
const sentence = (m: string) => { const t = m.trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : ""; };

export function LiveCourse() {
  const [view, setView] = useState<HostView | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  // A notice belongs to the stage that raised it: it clears when the stage changes (D8). `survive` is for a notice
  // raised by the very act that moves the page on ("Version 1 sealed"), which must outlive that one change.
  const [noticeState, setNoticeState] = useState<{ text: string; survive: boolean } | null>(null);
  const notice = noticeState?.text ?? null;
  const setNotice = (text: string | null, survive = false) => setNoticeState(text === null ? null : { text, survive });
  const [tourOpen, setTourOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [working, setWorking] = useState<Working | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [asfai, setAsfai] = useState<AsfaiStatus | null>(null);
  const [worker, setWorker] = useState<{ configured: boolean; zdr?: boolean; typicalSeconds?: unknown } | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [passcodeOpen, setPasscodeOpen] = useState(false);
  const waitIds = useRef(0);
  const [library, setLibrary] = useState<CourseSummary[]>([]);
  const [pins, setPins] = useState<CoursePin[]>([]);
  const [pinReport, setPinReport] = useState<{ version: number; status: string; detail: string }[]>([]);
  const [recordStatus, setRecordStatus] = useState<RecordStatus>(null);
  // Looking at another step than the one the work is in (from the navigator, or "Edit objectives"). A look is never an act.
  const [viewing, setViewing] = useState<StepId | null>(null);
  const cameFromY = useRef(0);          // where the page was scrolled when the look began
  const pendingY = useRef<number | null>(null); // where to put it once the next view is on screen
  const lastStageKey = useRef("");

  // Discover an existing course on load. NEVER writes on load.
  useEffect(() => {
    void (async () => {
      try {
        const { courses } = await host.listCourses();
        setLibrary(courses);
        // A teacher's first visit, before any course: the tour opens once. (On this device; never in the record.)
        if (courses.length === 0 && !tourSeen()) setTourOpen(true);
        if (courses.length > 0) {
          setCourseId(courses[0].courseId);
          setView(await host.getCourse(courses[0].courseId));
          setPins(listPins(courses[0].courseId));
        }
      } catch {
        setOffline(true);
      }
    })();
  }, []);

  const reload = async (id = courseId): Promise<HostView | null> => {
    let fresh: HostView | null = null;
    if (id) { fresh = await host.getCourse(id); setView(fresh); }
    try { setLibrary((await host.listCourses()).courses); } catch { /* the library is a convenience; the course view is what matters */ }
    try { setAsfai(await host.asfaiStatus()); } catch { /* an old host: leave unknown */ }
    return fresh;
  };
  useEffect(() => { void host.asfaiStatus().then(setAsfai).catch(() => {}); }, []);
  useEffect(() => { void host.workerStatus().then(setWorker).catch(() => {}); }, []);
  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    // A receipt is true only until the teacher's next act (accepting a proposal makes "none is confirmed" false).
    setWaiting((w) => (w && w.phase !== "running" ? null : w));
    fn()
      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  /** An AI step begins: the page shows what is happening, from data it already holds. */
  const startWait = (step: WaitingStep): number => {
    const id = (waitIds.current += 1);
    const startedAt = Date.now();
    setWaiting({ id, step, phase: "running", receipt: [], startedAt, clock: newWaitClock(startedAt) });
    return id;
  };
  /** It ends: a receipt computed from the view the host just returned, or an honest "stopped". */
  const finishWait = (id: number | null, ok: boolean, fresh: ReceiptView | null, receiptOf: (v: ReceiptView) => string[]) => {
    if (id === null) return;
    const finishedAt = Date.now(); // the real finish, whether or not a card is mounted right now
    setWaiting((w) => {
      if (!w || w.id !== id) return w;
      stopWaitClock(w.clock, finishedAt);
      return { ...w, phase: ok ? "done" : "failed", receipt: ok && fresh ? receiptOf(fresh) : [] };
    });
  };

  const cp = view?.checkpoints ?? {};
  const is = (id: string, status: string) => cp[id]?.status === status;
  const asfaiAvailable = !BROWSER_MODE && asfai?.available !== false;

  // D8: when the stage changes, last stage's notice goes (one raised by the act that moved the page on survives that one change).
  const stageKey = view ? `${stageOf(view)}:${is("files", "confirmed")}` : "";
  useEffect(() => { setNoticeState((n) => (n && n.survive ? { ...n, survive: false } : null)); }, [stageKey]);
  // A new stage opens at its top, with the viewing of another step ended; the stage bar then holds its primary in view.
  useEffect(() => {
    if (lastStageKey.current && stageKey && lastStageKey.current !== stageKey) { setViewing(null); scrollToY(0); }
    if (stageKey) lastStageKey.current = stageKey;
  }, [stageKey]);
  // A look at another step starts at the top; coming back puts the page exactly where it was.
  useLayoutEffect(() => {
    if (pendingY.current === null) return;
    scrollToY(pendingY.current);
    pendingY.current = null;
  }, [viewing]);

  // After the tour, the cursor goes to the first question, unless focus already went somewhere meaningful (the tour's opener).
  const [focusReply, setFocusReply] = useState(false);
  useEffect(() => {
    if (!focusReply) return;
    setFocusReply(false);
    if (!document.activeElement || document.activeElement === document.body) document.getElementById("onboarding-reply")?.focus();
  }, [focusReply]);
  const closeTour = () => { markTourSeen(); setTourOpen(false); setFocusReply(true); };
  const tryAsStudent = () => {
    const box = document.getElementById(STUDENT_INPUT_ID);
    box?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    box?.focus({ preventScroll: true });
  };

  const startCourse = (b: { owner: string; title: string; materials: { name: string }[] }) => run(async () => {
    const created = await host.createCourse(b);
    setCourseId(created.courseId);
    setView(created.view);
    void host.listCourses().then((r) => setLibrary(r.courses)).catch(() => {});
    setNotice("Course recorded. Confirm the material list when it is right.", true);
  });

  /** Open another course from the library. Nothing is written: this only changes which record is shown. */
  const openCourse = (id: string) => run(async () => {
    setNotice(null); setPinReport([]); setViewing(null);
    setView(await host.getCourse(id));
    setCourseId(id);
    setPins(listPins(id));
  });
  /** Show the naming conversation again. The new course exists only once the teacher records it. */
  const newCourse = () => { setViewing(null); setView(null); setCourseId(null); setNotice(null); setPinReport([]); setWaiting(null); setRevisionOpen(false); };

  const confirmFiles = (text: string) => run(async () => {
    await host.confirmCheckpoint(courseId!, { id: "files", text });
    await reload();
  });
  const confirmOutline = () => run(async () => {
    await host.confirmCheckpoint(courseId!, { id: "outline", text: "Confirm the outline." });
    await reload();
  });

  /** Ask ASFAI for the clarifying questions (round 1) or send the teacher's answers (round 2). */
  const askAsfai = () => run(async () => {
    setWorking({ actor: "asfai", label: "Asking ASFAI for its questions about your course", startedAt: Date.now() });
    try { await host.callIntake(courseId!); }
    catch (e) { setNotice(`ASFAI: ${(e as Error).message}`); }
    finally { try { await reload(); } finally { setWorking(null); } }
  });

  /** Ask ASFAI to format-check the drafted plan. A signal only; confirming is still the teacher's act. */
  const checkPlan = () => run(async () => {
    setWorking({ actor: "asfai", label: "Checking the format of your lesson plan", startedAt: Date.now() });
    try { await host.validatePlan(courseId!); }
    catch (e) { setNotice(`ASFAI: ${(e as Error).message}`); }
    finally { try { await reload(); } finally { setWorking(null); } }
  });

  /** Open ASFAI's consent screen in a new tab. Nothing is connected until the teacher clicks there. */
  const connectAsfai = () => run(async () => {
    const { authorizeUrl } = await host.asfaiConnect();
    window.open(authorizeUrl, "_blank", "noopener");
    setNotice("Approve ASFAI in the new tab, then come back and press “I approved it”.");
  });

  /** The teacher's reply to the ASFAI clarifying questions, one answer per question. It is what unblocks the outline. */
  const sendAnswer = (given: Record<string, string>) => run(async () => {
    try {
      await host.answerIntake(courseId!, {
        text: given.outcomes_from === "materials" ? "Propose the outcomes from my materials." : Object.values(given)[0] ?? "",
        answers: given,
      });
    } catch (e) {
      setNotice(`Refused by the intake gate: ${(e as Error).message}`);
    } finally {
      await reload();
    }
  });

  /** Re-check every pin this device holds against the host's current account. */
  const checkPins = () => run(async () => {
    const held = listPins(courseId!);
    const report: { version: number; status: string; detail: string }[] = [];
    for (const pin of held) {
      const { anchor } = await host.anchor(courseId!, pin.version);
      const cmp = comparePin(pin, anchor);
      report.push({ version: pin.version, status: cmp.status, detail: cmp.detail });
    }
    setPinReport(report);
    setNotice(
      report.every((r) => r.status === "ok" || r.status === "advanced")
        ? "Every pinned version still matches this device's copy."
        : "A pinned version does NOT match this device's copy — investigate.",
    );
  });

  /** Sprint 2a: archive the export (atomic write + read-back verified digest). */
  const archiveCourse = () => run(async () => {
    try {
      const r = await host.archiveCourse(courseId!);
      setNotice(r.verified ? `Archived and read back — digest ${String(r.digest).slice(0, 16)}…` : "The archive did not verify.");
    } catch (e) {
      setNotice(`Archive failed: ${(e as Error).message}`);
    }
  });

  /** The HOST derives the proposals from the teacher's own recorded answers; the UI sends nothing. */
  const proposeObjectives = () => run(async () => {
    try {
      await host.proposeObjectives(courseId!);
    } catch (e) {
      setNotice(`Nothing to propose: ${(e as Error).message}`);
    } finally {
      await reload();
    }
  });

  /** The material goes to the host once; a WORKER proposes objectives from it. The teacher decides each one. */
  const proposeFromMaterials = (materials: MaterialInput[]) => run(async () => {
    const wait = view ? startWait(objectivesStep(materials, view)) : null;
    let ok = false;
    try {
      const r = await host.proposeFromMaterials(courseId!, { materials });
      ok = true;
      setNotice(r.skipped.length ? `Some material was skipped: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}` : null, true);
    } catch (e) {
      setNotice(`Nothing was proposed. ${sentence((e as Error).message)}`);
    } finally {
      let fresh: HostView | null = null;
      try { fresh = await reload(); } finally { finishWait(wait, ok, fresh, proposalsReceipt); }
    }
  });

  const dispatch = (intent: DecisionIntent) => {
    void run(async () => {
      try {
        await host.decide(courseId!, { decisions: [intent], text: describeIntent(intent) });
      } catch (e) {
        setNotice(`Refused by the confirm-gate: ${(e as Error).message}`);
      } finally {
        await reload();
      }
    });
  };

  /** The WORKER drafts from the teacher's CONFIRMED objectives; the UI supplies no content. */
  const draftPlan = () => run(async () => {
    const wait = view ? startWait(planStep(view)) : null;
    let ok = false;
    try {
      await host.proposePlan(courseId!);
      ok = true;
    } catch (e) {
      setNotice(`No plan was drafted: ${(e as Error).message}`);
    } finally {
      let fresh: HostView | null = null;
      try { fresh = await reload(); } finally { finishWait(wait, ok, fresh, planReceipt); }
    }
  });

  const confirmPlan = () => run(async () => {
    await host.confirmPlan(courseId!, { text: "Confirm this lesson plan." });
    await reload();
  });

  const publish = () => {
    void run(async () => {
      try {
        const r = await host.publish(courseId!, { text: "Publish the course package." });
        // Pin the sealed version on THIS device: the out-of-band reference the
        // host's own verify() can never be.
        const { anchor } = await host.anchor(courseId!, r.version.version);
        if (anchor && pinVersion(anchor)) {
          setPins(listPins(courseId!));
          setNotice(`Version ${r.version.version} sealed and pinned on this device.`, true);
        } else {
          setNotice(`Version ${r.version.version} sealed.`, true);
        }
      } catch (e) {
        setNotice(`Refused by the confirm-gate: ${(e as Error).message}`);
      } finally {
        await reload();
      }
    });
  };

  const exportPackage = () => run(async () => {
    const pkg = await host.exportCourse(courseId!);
    const url = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `silicus-course-${view?.versions.at(-1)?.version ?? 0}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setNotice("Exported the course package (tamper-evident JSON).");
  });

  /** A standalone student page from the SEALED version. No AI, no host needed to read it. */
  const downloadHandout = () => {
    const sealed = view?.versions.at(-1);
    if (!sealed) return;
    const url = URL.createObjectURL(new Blob([buildHandoutHtml(sealed)], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = handoutFilename(sealed);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setNotice("Downloaded the student handout: a single page you can print or share.");
  };

  const verifyLog = () => run(async () => {
    const r = await host.verify(courseId!);
    setNotice(r.ok ? `Event log verified — ${plural(r.events, "event")}, chain intact.` : "The event log does NOT verify.");
  });

  if (offline) {
    return (
      <div className={styles.live}>
        {BROWSER_MODE ? (
          <div className={styles.offline} role="alert">
            <p className={styles.offlineTitle}>This window cannot keep a record for Silicus</p>
            <p className={styles.offlineText}>
              This browser would not open its storage for Silicus, so no course can be kept here. Private windows
              and some privacy settings block it; a regular window usually works.
            </p>
          </div>
        ) : (
          <div className={styles.offline} role="alert">
            <p className={styles.offlineTitle}>The Silicus host is not running</p>
            <p className={styles.offlineText}>
              The Silicus host is not reachable. Start it with{" "}
              <code>cd host && npm start</code> (listens on 127.0.0.1:8787), then reload.
            </p>
          </div>
        )}
      </div>
    );
  }

  /** After an import or a delete-all: show what this browser now holds. Nothing is written here. */
  const afterRecordChange = () => run(async () => {
    const { courses } = await host.listCourses();
    setLibrary(courses);
    setPinReport([]);
    if (courseId && !courses.some((c) => c.courseId === courseId)) { setView(null); setCourseId(null); setPins([]); }
    else if (!courseId && courses.length > 0) { setCourseId(courses[0].courseId); setView(await host.getCourse(courses[0].courseId)); setPins(listPins(courses[0].courseId)); }
    else if (courseId) setPins(listPins(courseId));
  });
  const browserRecord = BROWSER_MODE ? <BrowserRecord hasCourses={library.length > 0} onChanged={afterRecordChange} status={recordStatus} onStatus={setRecordStatus} /> : null;
  const passcodeDialog = BROWSER_MODE ? <PasscodeDialog onAsking={setPasscodeOpen} /> : null;
  const tour = <FirstRunTour open={tourOpen} onClose={closeTour} asfaiAvailable={asfaiAvailable} />;
  const howItWorks = <button type="button" className={styles.howItWorks} onClick={() => setTourOpen(true)}>How it works</button>;

  if (!view) {
    return (
      <div className={styles.live}>
        {tour}
        <div className={styles.topbar}>{howItWorks}</div>
        {BROWSER_MODE ? (
          <header className={styles.hero}>
            <p className={styles.kicker}>Course authoring, teacher in the loop</p>
            <h1 className={styles.heroTitle}>Build a course, one decision at a time.</h1>
            <p className={styles.heroLede}>
              Bring your material. An AI proposes learning objectives and drafts a lesson plan; you confirm every step.
              Publishing seals a version, and a student can ask questions answered only from what you sealed.
            </p>
            <ol className={styles.moves} aria-label="How it goes">
              <li>Bring your material</li>
              <li>Confirm the objectives</li>
              <li>Confirm the plan</li>
              <li>Publish a sealed version</li>
            </ol>
            <p className={styles.assure}>
              Your words stay on this record. Nothing leaves this browser until you ask the AI for a draft,
              and nothing is decided without you.
            </p>
          </header>
        ) : (
          <header className={styles.intro}>
            <h1 className={styles.title}>Name this course</h1>
            <p className={styles.lede}>
              Your words stay on this record. ASFAI asks its own questions later, and
              only your answers to those are sent. Nothing is decided in this browser.
            </p>
          </header>
        )}
        <CourseLibrary courses={library} currentId={null} busy={busy} onOpen={openCourse} onNew={newCourse} />
        <OnboardingChat
          view={null}
          asfai={asfai}
          busy={busy}
          onCreate={startCourse}
          onConfirmFiles={() => {}}
          onAsk={() => {}}
          onAnswer={() => {}}
          onSendToAsfai={() => {}}
          onConnect={connectAsfai}
          onRefresh={() => run(reload)}
        />
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        {browserRecord}
      </div>
    );
  }

  const plan = view.plan;
  const published = view.versions.at(-1) ?? null;
  const objectives = view.objectives;
  const stage = stageOf(view);
  const workerMissing = worker !== null && !worker.configured;
  // Revising a sealed course: the teacher pressed Revise (or the host says a draft of the next version exists).
  const revising = published !== null && (revisionOpen || view.revision?.drafting === true);
  const aiProposals = view.proposals.filter((p) => p.by === "ai").length;

  const stepsDone = (id: string) => cp[id]?.status === "confirmed";
  const materialNames = materialNamesOf(view.course.materials);
  const answers = view.intake.answers ?? {};

  // ---- looking at another step (the navigator, "Edit objectives") ----
  const work = workStep(stage, view);
  // The stage's own card already shows these: asking for them is just "go to the stage".
  const isTheStage = (id: StepId) => id === work || (stage === "plan" && !plan && id === "objectives") || (stage === "published" && id === "publish");
  const openStep = (id: StepId) => {
    if (isTheStage(id)) { if (viewing !== null) { pendingY.current = cameFromY.current; setViewing(null); } else scrollToY(0); return; }
    if (viewing === null) cameFromY.current = window.scrollY;
    pendingY.current = 0;
    setViewing(id);
  };
  const backToStage = () => { pendingY.current = cameFromY.current; setViewing(null); };
  const look = viewing !== null && !isTheStage(viewing) ? viewing : null;
  // Objectives can be edited from the plan while nothing is published, or while a revision is open; otherwise a look is only a look.
  const objectivesEditable = revising || (!published && stage === "plan");

  // The step in flight, for the Behind-the-scenes rail: the drafting model's (from the waiting card), or ASFAI's / a student's answer.
  const now = waiting && waiting.phase === "running"
    ? { actor: "worker" as const, label: describeStep(waiting.step).title, startedAt: waiting.startedAt }
    : working;

  const objectivesCard = (o: { readOnly?: boolean; hideBar?: boolean; onConfirm?: () => void }) => (
    <DecisionCard
      canRedraftPlan={worker?.configured !== false}
      rows={view.proposals}
      onDispatch={dispatch}
      checkpointStatus={cp.objectives?.status}
      {...o}
    />
  );

  const waitingCard = waiting ? (
    <div className={styles.waiting}>
      <AiWaiting
        key={waiting.id}
        step={waiting.step}
        phase={waiting.phase}
        receipt={waiting.receipt}
        typicalSeconds={worker?.typicalSeconds}
        zdr={worker?.zdr ?? null}
        paused={passcodeOpen}
        clock={waiting.clock}
      />
    </div>
  ) : null;

  const planCard = (p: NonNullable<typeof plan>, confirmedAt?: Date) => (
    <PlanCard
      plan={p}
      objectives={objectives}
      teacher={{ name: view.course.owner, confirmedAt }}
      onPrint={() => window.print()}
      invalidation={view.invalidation}
      rewordedSince={view.planWording?.objectives}
      ids="record"
    />
  );

  const validationNote = plan && (view.validations ?? []).filter((v) => v.planId === plan.id).slice(-1).map((v) => (
    <p key={v.at} className={styles.intakeNote} role="status">
      {v.valid
        ? "ASFAI found the plan structurally sound. That is a format check, not a review — the decision is still yours."
        : `ASFAI flagged the plan format: ${v.issues.join("; ") || "no detail given"}. Nothing is blocked; you decide.`}
    </p>
  ));

  /** A reword keeps the plan valid but leaves its text older than the wording: reading it again and confirming is the teacher's own act, never automatic. */
  const staleConfirm = plan && plan.status === "confirmed" && view.planWording?.stale ? (
    <div className={styles.actions}>
      <button type="button" className={styles.ghostButton} onClick={confirmPlan} disabled={busy}>Confirm the plan as it reads</button>
    </div>
  ) : null;

  const showOnboarding = is("files", "pending") || is("files", "open") || ((is("outline", "pending") || is("outline", "open")) && !view.intake.outlineAuthorized);

  // ---- the stage's own card -------------------------------------------------------------------------------
  let body: React.ReactNode = null;
  if (stage === "intake") {
    body = (
      <>
        {showOnboarding ? (
          <OnboardingChat
            view={view}
            asfai={asfai}
            busy={busy}
            workerConfigured={worker?.configured === true}
            onCreate={startCourse}
            onConfirmFiles={confirmFiles}
            onAsk={askAsfai}
            onAnswer={sendAnswer}
            onSendToAsfai={askAsfai}
            onConnect={connectAsfai}
            onRefresh={() => run(reload)}
          />
        ) : null}
        {is("files", "confirmed") && !showOnboarding ? (
          <StageBar status="Your answers are on the record. Confirm to go on to the objectives.">
            <button type="button" className={styles.primaryButton} data-primary="true" onClick={confirmOutline} disabled={busy}>
              Confirm the outline
            </button>
          </StageBar>
        ) : null}
      </>
    );
  } else if (stage === "material") {
    body = (
      <>
        <MaterialsPanel busy={busy} zdr={worker?.zdr ?? null} youtube={!BROWSER_MODE} onPropose={proposeFromMaterials} />
        {waitingCard}
      </>
    );
  } else if (stage === "objectives") {
    body = view.proposals.length === 0 ? (
      <>
        {objectivesCard({ hideBar: true })}
        <StageBar status="Nothing is proposed yet. Silicus lists objectives from your own answers; you decide each one.">
          <button type="button" className={styles.primaryButton} data-primary="true" onClick={proposeObjectives} disabled={busy}>
            Propose objectives from your answers
          </button>
        </StageBar>
        {waitingCard}
      </>
    ) : (
      <>
        {objectivesCard({})}
        {waitingCard}
      </>
    );
  } else if (stage === "plan" && !plan) {
    // The objectives are decided. The confirm bar under them is the one primary here, and it builds the plan (D1).
    body = (
      <>
        {objectivesCard({ hideBar: workerMissing || aiProposals === 0, onConfirm: workerMissing ? undefined : draftPlan })}
        {workerMissing ? (
          <p className={styles.aside}>
            {BROWSER_MODE
              ? "AI drafting is not set up on this site, so the plan cannot be drafted here. Everything else still works."
              : "No drafting worker is configured on this host, so the plan cannot be drafted here. Everything else still works."}
          </p>
        ) : aiProposals === 0 ? (
          // Objectives the teacher wrote themselves have no proposal bar to arm: the same act, plainly offered.
          <StageBar status="Your objectives are confirmed. The next step drafts a lesson plan from them; you confirm the plan.">
            <button type="button" className={styles.primaryButton} data-primary="true" onClick={draftPlan} disabled={busy}>
              Draft the plan from your confirmed objectives
            </button>
          </StageBar>
        ) : null}
        {waitingCard}
      </>
    );
  } else if (stage === "plan" && plan) {
    // A draft, or one that cites an objective the teacher revoked. The plan once, then what happened, then the act.
    const invalid = plan.status === "invalidated";
    const draftIsPrimary = invalid && worker?.configured !== false;
    body = (
      <>
        {planCard(plan)}
        {waitingCard}
        {validationNote}
        <StageBar status={invalid
          ? "This plan cites an objective you dropped, so it cannot be published as it is."
          : `Draft plan · ${plural(plan.activities.length, "activity", "activities")}, ${plan.activities.reduce((n, a) => n + a.minutes, 0)} min. It is a draft until you confirm it.`}>
          {objectivesEditable ? (
            <button type="button" className={styles.ghostButton} onClick={() => openStep("objectives")} disabled={busy}>Edit objectives</button>
          ) : null}
          {plan.status === "draft" && asfaiAvailable ? (
            <button type="button" className={styles.ghostButton} onClick={checkPlan} disabled={busy || asfai?.connected === false}>
              Check the plan with ASFAI
            </button>
          ) : null}
          {invalid && !published && worker?.configured !== false ? (
            // An invalidated plan cites a revoked objective, and a revoked objective cannot come back: the way
            // forward is a new plan. (Once a version is sealed the revision panel carries this button instead.)
            <button type="button" className={styles.primaryButton} data-primary="true" onClick={draftPlan} disabled={busy}>
              Draft a new plan from your confirmed objectives
            </button>
          ) : null}
          <button
            type="button"
            className={draftIsPrimary ? styles.ghostButton : styles.primaryButton}
            data-primary={draftIsPrimary ? undefined : "true"}
            onClick={confirmPlan}
            disabled={busy}
          >
            {invalid ? "Re-confirm the lesson plan" : "Confirm the lesson plan"}
          </button>
        </StageBar>
      </>
    );
  } else if (stage === "publish") {
    body = (
      <>
        <PublishCard
          courseId={view.course.courseId}
          title={plan?.title ?? view.course.title}
          heading="Review and publish"
          status={view.publish}
          objectives={objectives}
          activities={plan?.activities ?? []}
          totalMinutes={(plan?.activities ?? []).reduce((n, a) => n + a.minutes, 0)}
          plan={plan}
          published={published}
          unpublishedChanges={published !== null}
          teacherName={view.course.owner}
          onPublish={publish}
          onExport={exportPackage}
          invalidation={view.invalidation}
          rewordedSince={view.planWording?.objectives}
        />
        {staleConfirm}
      </>
    );
  } else if (stage === "published" && published) {
    const sealedPlan = published.lessonPlan ?? plan;
    body = (
      <>
        <PublishedMoment version={published} teacher={view.course.owner} busy={busy} onTry={tryAsStudent} onHandout={downloadHandout} onExport={exportPackage}>
          {view.revision ? (
            <RevisionPanel
              bare
              revision={view.revision}
              workerConfigured={worker?.configured !== false}
              planReworded={view.planWording?.objectives ?? []}
              busy={busy}
              onDraftPlan={draftPlan}
              onOpenChange={setRevisionOpen}
            />
          ) : null}
        </PublishedMoment>
        <StudentChat
          inputId={STUDENT_INPUT_ID}
          courseId={view.course.courseId}
          courseTitle={view.course.title}
          sealed={{
            version: published.version,
            title: published.title ?? view.course.title,
            objectives: published.objectiveRefs?.length ?? 0,
            activities: published.lessonPlan?.activities?.length ?? 0,
          }}
          typicalSeconds={worker?.typicalSeconds}
          zdr={worker?.zdr ?? null}
          paused={passcodeOpen}
          onWorking={(w) => setWorking(w ? { actor: "worker", ...w } : null)}
        />
        {sealedPlan ? planCard(sealedPlan, new Date(published.publishedAt)) : null}
      </>
    );
  }

  // ---- a look at another step: what it holds, and one way back ----
  if (look !== null) {
    const label = STEPS.find((x) => x.id === look)!.label;
    const told: [string, string][] = [
      ["Topic", answerText(answers.topic)], ["Course", answerText(answers.course)],
      ["Outcomes", Array.isArray(answers.learning_outcomes) ? answers.learning_outcomes.join("\n") : answerText(answers.learning_outcomes)],
    ];
    const lookPlan = look === "plan" ? (plan ?? published?.lessonPlan ?? null) : null;
    const editing = look === "objectives" && objectivesEditable;
    let lookBody: React.ReactNode = null;
    if (look === "files") {
      lookBody = materialNames.length > 0
        ? <ul className={stageStyles.earlierNames}>{materialNames.map((n) => <li key={n}>{n}</li>)}</ul>
        : <p className={styles.notice}>No materials were listed.</p>;
    } else if (look === "outline") {
      const rows = told.filter(([, v]) => v);
      lookBody = rows.length > 0
        ? <dl className={stageStyles.earlierFacts}>{rows.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        : <p className={styles.notice}>No answers are on the record.</p>;
    } else if (look === "objectives") {
      lookBody = objectivesCard({ readOnly: !editing, hideBar: true });
    } else if (look === "plan") {
      lookBody = lookPlan ? planCard(lookPlan, published?.lessonPlan === lookPlan ? new Date(published.publishedAt) : undefined) : null;
    } else if (published) {
      lookBody = <p className={styles.notice}>Version {published.version} is published. It can{"\u2019"}t be changed; changes become version {published.version + 1}.</p>;
    }
    body = (
      <>
        {lookBody}
        <StageBar status={editing ? "Reword or drop an objective here; nothing changes until you do." : `A look at your ${label.toLowerCase()}. Nothing here changes.`}>
          <button type="button" className={styles.primaryButton} data-primary="true" onClick={backToStage}>{BACK_LABEL[stage]}</button>
        </StageBar>
      </>
    );
  }

  // ---- finished stages, one line each --------------------------------------------------------------------
  const objectivesIsStage = stage === "objectives" || (stage === "plan" && !plan);
  const earlier: EarlierStep[] = [];
  if (stage !== "intake" && stepsDone("files")) {
    earlier.push({
      id: "files",
      line: `Material list confirmed · ${materialNames.length === 0 ? "no materials" : plural(materialNames.length, "material")}`,
      body: materialNames.length > 0 ? <ul className={stageStyles.earlierNames}>{materialNames.map((n) => <li key={n}>{n}</li>)}</ul> : undefined,
    });
  }
  if (stage !== "intake" && stepsDone("outline")) {
    const rows: [string, string][] = [
      ["Topic", answerText(answers.topic)], ["Course", answerText(answers.course)],
      ["Outcomes", Array.isArray(answers.learning_outcomes) ? answers.learning_outcomes.join("\n") : answerText(answers.learning_outcomes)],
    ];
    const told = rows.filter(([, v]) => v);
    earlier.push({
      id: "outline",
      line: "Outline confirmed",
      body: told.length > 0 ? <dl className={stageStyles.earlierFacts}>{told.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : undefined,
    });
  }
  if (stepsDone("objectives") && !objectivesIsStage) {
    earlier.push({
      id: "objectives",
      line: `Objectives decided · ${plural(objectives.length, "objective")}`,
      // Read-only until the teacher chooses to revise: the verbs are the same, they are just not offered.
      body: objectivesCard({ readOnly: !revising, hideBar: true }),
      forceOpen: revising,
    });
  }
  if (plan && plan.status === "confirmed" && (stage === "publish" || stage === "published")) {
    const minutes = plan.activities.reduce((n, a) => n + a.minutes, 0);
    earlier.push({ id: "plan", line: `Lesson plan confirmed · ${plural(plan.activities.length, "activity", "activities")}, ${plural(minutes, "minute")}` });
  }

  const gateMessages = view.publish.canPublish ? [] : view.publish.blockers;
  const recordDetails = (
    <RecordDetails
      courseId={view.course.courseId}
      planId={plan?.id ?? null}
      events={view.integrity.events}
      busy={busy}
      onVerify={verifyLog}
      gateMessages={gateMessages}
      intakeGuard={view.intake.refusal?.reason ?? null}
    >
      {pins.length > 0 ? (
        <section className={styles.pins} aria-label="Pinned copies on this device">
          <h2 className={styles.pinTitle}>Pinned on this device</h2>
          {BROWSER_MODE ? (
            <p className={styles.pinNote}>
              Your own copies of each sealed version, kept in this browser apart from the course record. Re-check
              them to detect a record that was rewritten or shortened — the record’s own check cannot tell you that.
              Both live in this browser, so export to keep a copy elsewhere.
            </p>
          ) : (
            <p className={styles.pinNote}>
              Your own copies of each sealed version, held outside the host. Re-check them to
              detect a record that was rewritten or shortened — the host cannot tell you that.
            </p>
          )}
          <ul className={styles.pinList}>
            {pins.map((p) => {
              const r = pinReport.find((x) => x.version === p.version);
              return (
                <li key={p.version} className={styles.pinRow} data-status={r ? r.status : "unchecked"}>
                  <span className={styles.pinVersion}>v{p.version}</span>
                  <span className={styles.pinDigest}>{p.versionDigest.slice(0, 12)}…</span>
                  <span className={styles.pinStatus}>{r ? r.status : "not checked"}</span>
                  {r ? <span className={styles.pinDetail}>{r.detail}</span> : null}
                </li>
              );
            })}
          </ul>
          <button type="button" className={styles.ghostButton} onClick={checkPins} disabled={busy}>
            Check my pinned copies
          </button>
        </section>
      ) : null}
      {published && !BROWSER_MODE ? (
        <button type="button" className={styles.textButton} onClick={archiveCourse} disabled={busy}>Archive the export</button>
      ) : null}
      {published ? <VersionDiffPanel versions={view.versions} courseId={view.course.courseId} /> : null}
      {view.timeline.length > 0 ? <TimelineCard events={view.timeline} courseLabel={view.course.title} /> : null}
    </RecordDetails>
  );

  const rail = (view.activity?.length ?? 0) > 0 || now ? (
    <div className={styles.side}>
      <ActivityRail
        key={view.course.courseId}
        items={view.activity ?? []}
        now={now}
        worker={{ zdr: worker?.zdr ?? null }}
        asfaiAvailable={asfaiAvailable}
      />
    </div>
  ) : null;

  return (
    <div className={styles.live} data-wide="true" data-stage={stage}>
      {passcodeDialog}
      {tour}
      <div className={styles.shell}>
        <div className={styles.nav}>
          <div className={styles.topbar}>
            <CourseLibrary courses={library} currentId={view.course.courseId} busy={busy} onOpen={openCourse} onNew={newCourse} />
            {howItWorks}
          </div>
          <header className={styles.stageHeader}>
            <div className={styles.stageMeta}>
              <h1 className={styles.title}>{view.course.title}</h1>
              <p className={styles.sub}>{view.course.owner} · {BROWSER_MODE ? "kept in this browser" : "kept on this computer"}</p>
            </div>
            <StepIndex view={view} stage={stage} open={look ?? work} onOpen={openStep} />
          </header>
        </div>

        <div className={styles.main}>
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
          {published && stage !== "published" && view.revision ? (
            <RevisionPanel
              revision={view.revision}
              workerConfigured={worker?.configured !== false}
              planReworded={view.planWording?.objectives ?? []}
              busy={busy}
              onDraftPlan={draftPlan}
              onOpenChange={setRevisionOpen}
            />
          ) : null}
          {body}
          <EarlierSteps steps={earlier} />
          {recordDetails}
          {browserRecord}
        </div>
        {rail}
      </div>
    </div>
  );
}

export default LiveCourse;
