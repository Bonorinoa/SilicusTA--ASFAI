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
import { useEffect, useState } from "react";
import { DecisionCard } from "../components/DecisionCard";
import { PlanCard } from "../components/PlanCard";
import { PublishCard } from "../components/PublishCard";
import { TimelineCard } from "../components/TimelineCard";
import { describeIntent } from "../gate/harness";
import { comparePin, listPins, pinVersion, type CoursePin } from "../gate/pin";
import { host, type AsfaiStatus, type HostView } from "../gate/transport";
import type { DecisionIntent } from "../gate/types";
import styles from "./LiveCourse.module.css";

const OWNER = "teacher:tk-1";
const COURSE_TITLE = "Lesson 3 · AI literacy";
const CHECKPOINT_LABEL: Record<string, string> = {
  files: "Materials", outline: "Outline", objectives: "Objectives", plan: "Plan", publish: "Publish",
};
const SEED_ITEMS = [
  { kind: "local", statement: "Students can explain what an algorithm is, in their own words." },
  { kind: "public", publicId: "mt_alpha", statement: "Learners can find the claim in an AI answer." },
  { kind: "public", publicId: "mt_beta", statement: "Learners can ask one question about how the tool works." },
];
const SEED_SOURCES = ["from your slides p.4", "suggested match", "suggested match"];

function planSpec(view: HostView) {
  const ids = view.objectives.map((o) => o.id);
  if (ids.length === 0) return null;
  const earlier = ids.slice(0, Math.max(1, ids.length - 1));
  const last = ids[ids.length - 1];
  return {
    title: "Seeing the claim: how AI answers are built",
    audience: { ageRangeStart: 8, ageRangeEnd: 10 },
    activities: [
      { title: "Spotting the claim", minutes: 20, objectiveIds: earlier,
        learnerDoes: "Read one AI answer and mark the sentence that makes a claim.",
        teacherDoes: "Ask what would count as evidence for it.", evidenceIfAny: "observation" },
      { title: "Ask one honest question", minutes: 20, objectiveIds: [last],
        learnerDoes: "Write one question about how the tool reached its answer.",
        teacherDoes: "Collect the questions for the next lesson.", evidenceIfAny: "work-product" },
    ],
  };
}

export function LiveCourse() {
  const [view, setView] = useState<HostView | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [asfai, setAsfai] = useState<AsfaiStatus | null>(null);
  const [pins, setPins] = useState<CoursePin[]>([]);
  const [pinReport, setPinReport] = useState<{ version: number; status: string; detail: string }[]>([]);

  // Discover an existing course on load. NEVER writes on load.
  useEffect(() => {
    void (async () => {
      try {
        const { courses } = await host.listCourses();
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

  const reload = async (id = courseId) => {
    if (id) setView(await host.getCourse(id));
    try { setAsfai(await host.asfaiStatus()); } catch { /* an old host: leave unknown */ }
  };
  useEffect(() => { void host.asfaiStatus().then(setAsfai).catch(() => {}); }, []);
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    fn()
      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const cp = view?.checkpoints ?? {};
  const is = (id: string, status: string) => cp[id]?.status === status;

  const startCourse = () => run(async () => {
    const created = await host.createCourse({ owner: OWNER, title: COURSE_TITLE });
    setCourseId(created.courseId);
    setView(created.view);
    setNotice("Course created. Confirm the material list to begin.");
  });

  const confirm = (id: "files" | "outline") => run(async () => {
    await host.confirmCheckpoint(courseId!, { id, text: id === "files" ? "Confirm the material list." : "Confirm the outline." });
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
  const sendAnswer = () => run(async () => {
    try {
      const given = Object.fromEntries(Object.entries(answers).filter(([, v]) => v.trim()));
      await host.answerIntake(courseId!, { answers: given });
      setAnswers({});
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

  const proposeObjectives = () => run(async () => {
    await host.proposeObjectives(courseId!, { items: SEED_ITEMS, sources: SEED_SOURCES, assistantText: `Proposed ${SEED_ITEMS.length} objectives.` });
    await reload();
    setNotice("The assistant proposed objectives — your decisions are required.");
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

  const draftPlan = () => run(async () => {
    const spec = planSpec(view!);
    if (!spec) return;
    await host.proposePlan(courseId!, { spec, assistantText: "Drafted a lesson plan." });
    await reload();
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

  const verifyLog = () => run(async () => {
    const r = await host.verify(courseId!);
    setNotice(r.ok ? `Event log verified — ${r.events} events, chain intact.` : "The event log does NOT verify.");
  });

  if (offline) {
    return (
      <div className={styles.live}>
        <p className={styles.offline}>
          The Silicus host is not reachable. Start it with{" "}
          <code>cd host && npm start</code> (listens on 127.0.0.1:8787), then reload.
        </p>
      </div>
    );
  }

  if (!view) {
    return (
      <div className={styles.live}>
        <header className={styles.intro}>
          <h1 className={styles.title}>One teacher, one course, over the real host</h1>
          <p className={styles.lede}>
            The teacher decides; the assistant only proposes. Every action below is
            posted to the Silicus host, which records the teacher turn and runs the
            confirm-gate. Nothing is decided in this browser.
          </p>
        </header>
        <button type="button" className={styles.primaryButton} onClick={startCourse} disabled={busy}>
          Start a course
        </button>
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      </div>
    );
  }

  const plan = view.plan;
  const published = view.versions.at(-1) ?? null;
  const objectives = view.objectives;

  return (
    <div className={styles.live}>
      <header className={styles.stageHeader}>
        <div>
          <h1 className={styles.title}>{view.course.title}</h1>
          <p className={styles.sub}>
            host · {view.course.owner} · course {view.course.courseId.slice(0, 18)}… · log {view.integrity.events} events
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

      <div className={styles.actions}>
        {is("files", "pending") || is("files", "open") ? (
          <button type="button" className={styles.primaryButton} onClick={() => confirm("files")} disabled={busy}>
            Confirm the material list
          </button>
        ) : null}
        {is("files", "confirmed") && (is("outline", "pending") || is("outline", "open")) ? (
          view.intake.outlineAuthorized ? (
            <button type="button" className={styles.primaryButton} onClick={() => confirm("outline")} disabled={busy}>
              Confirm the outline
            </button>
          ) : (
            <section className={styles.intake} aria-label="ASFAI course intake">
              <h2 className={styles.intakeTitle}>Course intake (ASFAI)</h2>
              {asfai && !asfai.connected ? (
                <p className={styles.intakeNote}>
                  ASFAI is not connected. Nothing is sent until you approve it.{" "}
                  <button type="button" className={styles.ghostButton} onClick={connectAsfai} disabled={busy}>Connect ASFAI</button>{" "}
                  <button type="button" className={styles.ghostButton} onClick={() => run(reload)} disabled={busy}>I approved it</button>
                </p>
              ) : null}
              {view.intake.questions.length > 0 ? (
                <>
                  <ol className={styles.intakeQuestions}>
                    {view.intake.questions.map((q) => (
                      <li key={q.id}>
                        <label className={styles.intakePrompt} htmlFor={`intake-${q.id}`}>{q.prompt}</label>
                        {q.reason ? <span className={styles.intakeReason}>{q.reason}</span> : null}
                        <textarea
                          id={`intake-${q.id}`}
                          className={styles.intakeAnswer}
                          rows={q.id === "learning_outcomes" ? 4 : 2}
                          value={answers[q.id] ?? ""}
                          onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                        />
                      </li>
                    ))}
                  </ol>
                  {view.intake.roundAnswered ? (
                    <button type="button" className={styles.primaryButton} onClick={askAsfai} disabled={busy}>
                      Send your answers to ASFAI
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={sendAnswer}
                      disabled={busy || Object.values(answers).every((v) => !v.trim())}
                    >
                      Record my answers
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className={styles.intakeNote}>
                    ASFAI will ask a few questions about the lesson. Your answers, in your words, are all it will be sent.
                  </p>
                  <button type="button" className={styles.primaryButton} onClick={askAsfai} disabled={busy || asfai?.connected === false}>
                    Ask ASFAI for the questions
                  </button>
                </>
              )}
              {view.intake.refusal ? (
                <p className={styles.intakeRefusal}>{view.intake.refusal.reason}</p>
              ) : null}
            </section>
          )
        ) : null}
        {is("outline", "confirmed") && view.proposals.length === 0 ? (
          <button type="button" className={styles.ghostButton} onClick={proposeObjectives} disabled={busy}>
            Ask the assistant to propose objectives
          </button>
        ) : null}
        {is("objectives", "confirmed") && !plan ? (
          <button type="button" className={styles.ghostButton} onClick={draftPlan} disabled={busy}>
            Ask the assistant to draft the lesson plan
          </button>
        ) : null}
        {plan && plan.status === "draft" ? (
          <>
            <button type="button" className={styles.ghostButton} onClick={checkPlan} disabled={busy || asfai?.connected === false}>
              Check the plan with ASFAI
            </button>
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
        <button type="button" className={styles.textButton} onClick={verifyLog} disabled={busy}>
          Verify the event log
        </button>
        {published ? (
          <button type="button" className={styles.textButton} onClick={archiveCourse} disabled={busy}>
            Archive the export
          </button>
        ) : null}
      </div>

      {pins.length > 0 ? (
        <section className={styles.pins} aria-label="Pinned copies on this device">
          <h2 className={styles.pinTitle}>Pinned on this device</h2>
          <p className={styles.pinNote}>
            Your own copies of each sealed version, held outside the host. Re-check them to
            detect a record that was rewritten or shortened — the host cannot tell you that.
          </p>
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

      <div className={styles.grid}>
        <DecisionCard
          rows={view.proposals}
          onDispatch={dispatch}
          checkpointStatus={cp.objectives?.status}
          courseLabel={view.course.title}
          notice={notice}
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
          notice={notice}
        />
      </div>

      {view.timeline.length > 0 ? (
        <div className={styles.grid}>
          <TimelineCard events={view.timeline} courseLabel={view.course.title} />
        </div>
      ) : null}
    </div>
  );
}

export default LiveCourse;
