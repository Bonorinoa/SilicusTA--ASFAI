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
import { useEffect, useRef, useState } from "react";
import { DecisionCard } from "../components/DecisionCard";
import { AiWaiting, answerText, materialNamesOf, planReceipt, proposalsReceipt, type ReceiptView, type WaitingPhase, type WaitingStep } from "../components/AiWaiting";
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
import type { DecisionIntent } from "../gate/types";
import { OnboardingChat } from "./OnboardingChat";
import { MaterialsPanel } from "./MaterialsPanel";
import { StudentChat } from "./StudentChat";
import { RevisionPanel } from "./RevisionPanel";
import { CourseLibrary } from "./CourseLibrary";
import { buildHandoutHtml, handoutFilename } from "./handout";
import { VersionDiffPanel } from "./VersionDiffPanel";
import styles from "./LiveCourse.module.css";
/** One AI step in flight, or just finished: what the waiting card shows. `receipt` is computed from the resulting view. */
interface Waiting { id: number; step: WaitingStep; phase: WaitingPhase; receipt: string[] }

const CHECKPOINT_LABEL: Record<string, string> = {
  files: "Materials", outline: "Outline", objectives: "Objectives", plan: "Plan", publish: "Publish",
};
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
    materialNames: materialNamesOf(view.course.materials),
    referenceNotes: !BROWSER_MODE,
  };
}

/** A refusal message as a sentence: capitalised, ending in a full stop. */
const sentence = (m: string) => { const t = m.trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : ""; };

export function LiveCourse() {
  const [view, setView] = useState<HostView | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [asfai, setAsfai] = useState<AsfaiStatus | null>(null);
  const [worker, setWorker] = useState<{ configured: boolean; zdr?: boolean; typicalSeconds?: unknown } | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [passcodeOpen, setPasscodeOpen] = useState(false);
  const waitIds = useRef(0);
  // ASFAI is a local-app feature. The host says so (available: false) and the UI then offers no ASFAI button.
  const asfaiOffered = asfai?.available !== false;
  const [library, setLibrary] = useState<CourseSummary[]>([]);
  const [pins, setPins] = useState<CoursePin[]>([]);
  const [pinReport, setPinReport] = useState<{ version: number; status: string; detail: string }[]>([]);
  const [recordStatus, setRecordStatus] = useState<RecordStatus>(null);

  // Discover an existing course on load. NEVER writes on load.
  useEffect(() => {
    void (async () => {
      try {
        const { courses } = await host.listCourses();
        setLibrary(courses);
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
    setWaiting({ id, step, phase: "running", receipt: [] });
    return id;
  };
  /** It ends: a receipt computed from the view the host just returned, or an honest "stopped". */
  const finishWait = (id: number | null, ok: boolean, fresh: ReceiptView | null, receiptOf: (v: ReceiptView) => string[]) => {
    if (id === null) return;
    setWaiting((w) => (w && w.id === id ? { ...w, phase: ok ? "done" : "failed", receipt: ok && fresh ? receiptOf(fresh) : [] } : w));
  };

  const cp = view?.checkpoints ?? {};
  const is = (id: string, status: string) => cp[id]?.status === status;

  const startCourse = (b: { owner: string; title: string; materials: { name: string }[] }) => run(async () => {
    const created = await host.createCourse(b);
    setCourseId(created.courseId);
    setView(created.view);
    void host.listCourses().then((r) => setLibrary(r.courses)).catch(() => {});
    setNotice("Course recorded. Confirm the material list when it is right.");
  });

  /** Open another course from the library. Nothing is written: this only changes which record is shown. */
  const openCourse = (id: string) => run(async () => {
    setNotice(null); setPinReport([]);
    setView(await host.getCourse(id));
    setCourseId(id);
    setPins(listPins(id));
  });
  /** Show the naming conversation again. The new course exists only once the teacher records it. */
  const newCourse = () => { setView(null); setCourseId(null); setNotice(null); setPinReport([]); setWaiting(null); };

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
    try { await host.callIntake(courseId!); }
    catch (e) { setNotice(`ASFAI: ${(e as Error).message}`); }
    finally { await reload(); }
  });

  /** Ask ASFAI to format-check the drafted plan. A signal only; confirming is still the teacher's act. */
  const checkPlan = () => run(async () => {
    try { await host.validatePlan(courseId!); }
    catch (e) { setNotice(`ASFAI: ${(e as Error).message}`); }
    finally { await reload(); }
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
      setNotice(r.skipped.length ? `Some material was skipped: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}` : null);
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
          setNotice(`Version ${r.version.version} sealed and pinned on this device.`);
        } else {
          setNotice(`Version ${r.version.version} sealed.`);
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

  if (!view) {
    return (
      <div className={styles.live}>
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
        <CourseLibrary courses={library} currentId={null} busy={busy} onOpen={openCourse} onNew={newCourse} open />
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

  return (
    <div className={styles.live}>
      {passcodeDialog}
      <CourseLibrary courses={library} currentId={view.course.courseId} busy={busy} onOpen={openCourse} onNew={newCourse} />
      <header className={styles.stageHeader}>
        <div className={styles.stageMeta}>
          <h1 className={styles.title}>{view.course.title}</h1>
          <p className={styles.sub}>
            {BROWSER_MODE ? "kept in this browser" : "host"} · {view.course.owner} · course {view.course.courseId.slice(0, 18)}… · log {plural(view.integrity.events, "event")}
          </p>
        </div>
        <ol className={styles.chips} aria-label="Checkpoints">
          {["files", "outline", "objectives", "plan", "publish"].map((id) => (
            <li key={id} className={styles.chip} data-status={cp[id]?.status ?? "pending"}>
              <span className={styles.chipLabel}>{CHECKPOINT_LABEL[id]}</span>
              <span className={styles.chipState}>{cp[id]?.status ?? "pending"}</span>
            </li>
          ))}
        </ol>
      </header>

      {(is("files", "pending") || is("files", "open") || ((is("outline", "pending") || is("outline", "open")) && !view.intake.outlineAuthorized)) ? (
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

      {waiting ? (
        <div className={styles.waiting}>
          <AiWaiting
            key={waiting.id}
            step={waiting.step}
            phase={waiting.phase}
            receipt={waiting.receipt}
            typicalSeconds={worker?.typicalSeconds}
            zdr={worker?.zdr ?? null}
            paused={passcodeOpen}
          />
        </div>
      ) : null}

      <div className={styles.actions}>
        {is("files", "confirmed") && (is("outline", "pending") || is("outline", "open")) && view.intake.outlineAuthorized ? (
          <button type="button" className={styles.primaryButton} onClick={confirmOutline} disabled={busy}>
            Confirm the outline
          </button>
        ) : null}
        {is("outline", "confirmed") && view.proposals.length === 0 && view.intake.answers?.outcomes_from === "materials" ? (
          <MaterialsPanel busy={busy} zdr={worker?.zdr ?? null} youtube={!BROWSER_MODE} onPropose={proposeFromMaterials} />
        ) : null}
        {is("outline", "confirmed") && view.proposals.length === 0 && view.intake.answers?.outcomes_from !== "materials" ? (
          <button type="button" className={styles.ghostButton} onClick={proposeObjectives} disabled={busy}>
            Propose objectives from your answers
          </button>
        ) : null}
        {is("objectives", "confirmed") && !plan ? (
          worker && !worker.configured ? (
            <p className={styles.aside}>
              {BROWSER_MODE
                ? "AI drafting is not set up on this site, so the plan cannot be drafted here. Everything else still works."
                : "No drafting worker is configured on this host, so the plan cannot be drafted here. Everything else still works."}
            </p>
          ) : (
            <button type="button" className={styles.ghostButton} onClick={draftPlan} disabled={busy}>
              Draft the plan from your confirmed objectives
            </button>
          )
        ) : null}
        {plan && plan.status === "draft" ? (
          <>
            {asfaiOffered ? (
              <button type="button" className={styles.ghostButton} onClick={checkPlan} disabled={busy || asfai?.connected === false}>
                Check the plan with ASFAI
              </button>
            ) : null}
            <button type="button" className={styles.primaryButton} onClick={confirmPlan} disabled={busy}>
              Confirm the lesson plan
            </button>
          </>
        ) : null}
        {plan && (view.validations ?? []).filter((v) => v.planId === plan.id).slice(-1).map((v) => (
          <p key={v.at} className={styles.intakeNote} role="status">
            {v.valid
              ? "ASFAI found the plan structurally sound. That is a format check, not a review — the decision is still yours."
              : `ASFAI flagged the plan format: ${v.issues.join("; ") || "no detail given"}. Nothing is blocked; you decide.`}
          </p>
        ))}
        {plan && plan.status === "invalidated" ? (
          <button type="button" className={styles.primaryButton} onClick={confirmPlan} disabled={busy}>
            Re-confirm the lesson plan
          </button>
        ) : null}
        {/* A reword keeps the plan valid but leaves its text older than the wording: reading it again and
            confirming is the teacher's own act, never automatic. */}
        {plan && plan.status === "confirmed" && view.planWording?.stale ? (
          <button type="button" className={styles.ghostButton} onClick={confirmPlan} disabled={busy}>
            Confirm the plan as it reads
          </button>
        ) : null}
        {/* An invalidated plan cites a revoked objective, and a revoked objective cannot come back: the way
            forward is a new plan. (Once a version is sealed the revision panel carries this button instead.) */}
        {plan && plan.status === "invalidated" && !published && worker?.configured !== false ? (
          <button type="button" className={styles.ghostButton} onClick={draftPlan} disabled={busy}>
            Draft a new plan from your confirmed objectives
          </button>
        ) : null}
        <button type="button" className={styles.textButton} onClick={verifyLog} disabled={busy}>
          Verify the event log
        </button>
        {published ? (
          <>
            <button type="button" className={styles.ghostButton} onClick={downloadHandout} disabled={busy}>
              Download student handout
            </button>
            {BROWSER_MODE ? null : (
              <button type="button" className={styles.textButton} onClick={archiveCourse} disabled={busy}>
                Archive the export
              </button>
            )}
          </>
        ) : null}
      </div>

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

      {published && view.revision ? (
        <RevisionPanel
          revision={view.revision}
          workerConfigured={worker?.configured !== false}
          planReworded={view.planWording?.objectives ?? []}
          busy={busy}
          onDraftPlan={draftPlan}
        />
      ) : null}

      <div className={styles.grid}>
        {/* One course-level notice, shown once. It used to be echoed by every card it was passed to. */}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        <DecisionCard
          canRedraftPlan={worker?.configured !== false}
          rows={view.proposals}
          onDispatch={dispatch}
          checkpointStatus={cp.objectives?.status}
          courseLabel={view.course.title}
        />
      </div>

      {plan ? (
        <div className={styles.grid}>
          <PlanCard
            plan={plan}
            objectives={objectives}
            teacher={{ name: view.course.owner, confirmedAt: cp.plan?.status === "confirmed" ? new Date() : undefined }}
            onPrint={() => window.print()}
            invalidation={view.invalidation}
            rewordedSince={view.planWording?.objectives}
          />
        </div>
      ) : null}

      <div className={styles.grid}>
        <PublishCard
          courseLabel={view.course.title}
          courseId={view.course.courseId}
          title={plan?.title ?? view.course.title}
          status={view.publish}
          objectives={objectives}
          activities={plan?.activities ?? []}
          totalMinutes={(plan?.activities ?? []).reduce((n, a) => n + a.minutes, 0)}
          plan={plan}
          published={published}
          unpublishedChanges={cp.publish?.status === "pending" && published !== null}
          teacherName={view.course.owner}
          onPublish={publish}
          onExport={exportPackage}
        />
      </div>

      {published ? <div className={styles.grid}><VersionDiffPanel versions={view.versions} courseId={view.course.courseId} /></div> : null}

      {published ? (
        <div className={styles.grid}>
          <StudentChat
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
          />
        </div>
      ) : null}

      {view.timeline.length > 0 ? (
        <div className={styles.grid}>
          <TimelineCard events={view.timeline} courseLabel={view.course.title} />
        </div>
      ) : null}

      {browserRecord}
    </div>
  );
}

export default LiveCourse;
