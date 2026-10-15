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
import { host, type AsfaiStatus, type CourseSummary, type HostView, type MaterialInput } from "../gate/transport";
import type { DecisionIntent } from "../gate/types";
import { OnboardingChat } from "./OnboardingChat";
import { MaterialsPanel } from "./MaterialsPanel";
import { StudentChat } from "./StudentChat";
import { CourseLibrary } from "./CourseLibrary";
import { buildHandoutHtml, handoutFilename } from "./handout";
import { VersionDiffPanel } from "./VersionDiffPanel";
import styles from "./LiveCourse.module.css";
const CHECKPOINT_LABEL: Record<string, string> = {
  files: "Materials", outline: "Outline", objectives: "Objectives", plan: "Plan", publish: "Publish",
};
export function LiveCourse() {
  const [view, setView] = useState<HostView | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [asfai, setAsfai] = useState<AsfaiStatus | null>(null);
  const [worker, setWorker] = useState<{ configured: boolean; zdr?: boolean } | null>(null);
  const [library, setLibrary] = useState<CourseSummary[]>([]);
  const [pins, setPins] = useState<CoursePin[]>([]);
  const [pinReport, setPinReport] = useState<{ version: number; status: string; detail: string }[]>([]);

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

  const reload = async (id = courseId) => {
    if (id) setView(await host.getCourse(id));
    try { setLibrary((await host.listCourses()).courses); } catch { /* the library is a convenience; the course view is what matters */ }
    try { setAsfai(await host.asfaiStatus()); } catch { /* an old host: leave unknown */ }
  };
  useEffect(() => { void host.asfaiStatus().then(setAsfai).catch(() => {}); }, []);
  useEffect(() => { void host.workerStatus().then(setWorker).catch(() => {}); }, []);
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    fn()
      .catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
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
  const newCourse = () => { setView(null); setCourseId(null); setNotice(null); setPinReport([]); };

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
    try {
      const r = await host.proposeFromMaterials(courseId!, { materials });
      setNotice(r.skipped.length ? `Some material was skipped: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}` : null);
    } catch (e) {
      setNotice(`Nothing was proposed: ${(e as Error).message}`);
    } finally {
      await reload();
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
    try {
      await host.proposePlan(courseId!);
    } catch (e) {
      setNotice(`No plan was drafted: ${(e as Error).message}`);
    } finally {
      await reload();
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
          <h1 className={styles.title}>Name this course</h1>
          <p className={styles.lede}>
            Your words stay on this record. ASFAI asks its own questions later, and
            only your answers to those are sent. Nothing is decided in this browser.
          </p>
        </header>
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
      </div>
    );
  }

  const plan = view.plan;
  const published = view.versions.at(-1) ?? null;
  const objectives = view.objectives;

  return (
    <div className={styles.live}>
      <CourseLibrary courses={library} currentId={view.course.courseId} busy={busy} onOpen={openCourse} onNew={newCourse} />
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

      <div className={styles.actions}>
        {is("files", "confirmed") && (is("outline", "pending") || is("outline", "open")) && view.intake.outlineAuthorized ? (
          <button type="button" className={styles.primaryButton} onClick={confirmOutline} disabled={busy}>
            Confirm the outline
          </button>
        ) : null}
        {is("outline", "confirmed") && view.proposals.length === 0 && view.intake.answers?.outcomes_from === "materials" ? (
          <MaterialsPanel busy={busy} zdr={worker?.zdr ?? null} onPropose={proposeFromMaterials} />
        ) : null}
        {is("outline", "confirmed") && view.proposals.length === 0 && view.intake.answers?.outcomes_from !== "materials" ? (
          <button type="button" className={styles.ghostButton} onClick={proposeObjectives} disabled={busy}>
            Propose objectives from your answers
          </button>
        ) : null}
        {is("objectives", "confirmed") && !plan ? (
          worker && !worker.configured ? (
            <p className={styles.notice}>
              No drafting worker is configured on this host, so the plan cannot be drafted here.
              Everything else still works.
            </p>
          ) : (
            <button type="button" className={styles.ghostButton} onClick={draftPlan} disabled={busy}>
              Draft the plan from your confirmed objectives
            </button>
          )
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
          <>
            <button type="button" className={styles.ghostButton} onClick={downloadHandout} disabled={busy}>
              Download student handout
            </button>
            <button type="button" className={styles.textButton} onClick={archiveCourse} disabled={busy}>
              Archive the export
            </button>
          </>
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

      {published ? <div className={styles.grid}><VersionDiffPanel versions={view.versions} courseId={view.course.courseId} /></div> : null}

      {published ? (
        <div className={styles.grid}>
          <StudentChat courseId={view.course.courseId} courseTitle={view.course.title} />
        </div>
      ) : null}

      {view.timeline.length > 0 ? (
        <div className={styles.grid}>
          <TimelineCard events={view.timeline} courseLabel={view.course.title} />
        </div>
      ) : null}
    </div>
  );
}

export default LiveCourse;
