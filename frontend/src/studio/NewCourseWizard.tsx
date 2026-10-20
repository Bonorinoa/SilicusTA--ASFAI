/**
 * NewCourseWizard — a new course in five short steps (R7), replacing the one-sheet NewCourseDialog.
 *
 *   welcome (first run only) → course and learners → sources → your objectives → AI check → review
 *
 * Nothing is written while the teacher moves through the steps: file text is read into this tab, and the
 * rest is form state. The review shows everything that will be recorded, and its one confirm sends the
 * SAME intents the brief sends (useCourse confirmTheBrief), in the same order: create the course (materials
 * as an empty list: no names-only rows), record the answers, confirm the source list, confirm the brief.
 * Files are then held for the course with keepForCourse, exactly as the Sources panel holds them; web
 * pages are held the same way (links.ts). It lands on the Objectives step and, when the teacher chose it
 * and there are sources, asks the studio to start "propose from sources" there.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { explainRefusal } from "../lib/refusals";
import { host } from "../gate/transport";
import { plural } from "../lib/plural";
import { describeFile } from "../materials/display";
import { keepForCourse, type HeldFile } from "../materials/session";
import { AiCheck } from "./AiCheck";
import { useAiStatus } from "./aiStatus";
import { askToProposeOnArrival, keepLinksForCourse } from "./links";
import { SourceDrop } from "./SourceDrop";
import { shortAddress } from "./sourceIntake";
import { TopBar, href } from "./StudioApp";
import { Button, Notice, ui } from "./ui";
import { intakeText } from "./useCourse";
import w from "./Wizard.module.css";

type StepId = "welcome" | "course" | "sources" | "objectives" | "ai" | "review";
const STEPS: { id: Exclude<StepId, "welcome">; label: string }[] = [
  { id: "course", label: "Course and learners" },
  { id: "sources", label: "Sources" },
  { id: "objectives", label: "Your objectives" },
  { id: "ai", label: "AI check" },
  { id: "review", label: "Review and confirm" },
];
const MAX_SOURCES = 8;
const KIND_LABEL: Record<string, string> = { pdf: "PDF", docx: "DOC", pptx: "PPT", text: "TXT" };
/** The brief questions this wizard asks itself; any other set means the brief step must ask them. */
const KNOWN = new Set(["topic", "course", "learning_outcomes"]);

export interface WizardAnswers {
  title: string; owner: string; topic: string; audience: string;
  outcomes: string; fromSources: boolean;
}

/** The brief answers the review promises, in the shape answerIntake takes (the same as BriefStep's). */
export function briefAnswers(a: WizardAnswers): Record<string, string> {
  const out: Record<string, string> = { topic: a.topic.trim(), course: a.audience.trim() };
  if (a.outcomes.trim()) out.learning_outcomes = a.outcomes.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  if (a.fromSources) out.outcomes_from = "materials";
  return out;
}

export function NewCourseWizard() {
  const ai = useAiStatus();
  const [step, setStep] = useState<StepId | null>(null);
  const [a, setA] = useState<WizardAnswers>({ title: "", owner: "", topic: "", audience: "", outcomes: "", fromSources: false });
  const [files, setFiles] = useState<HeldFile[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ReactNode>(null);
  const [touchedChoice, setTouchedChoice] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const ids = { title: useId(), owner: useId(), topic: useId(), audience: useId(), outcomes: useId() };

  // First run (no courses yet) opens on the welcome; otherwise straight to the first question.
  useEffect(() => {
    void host.listCourses().then((r) => setStep(r.courses.length === 0 ? "welcome" : "course")).catch(() => setStep("welcome"));
  }, []);
  // Each step change puts focus on the step's heading, so keyboard and screen-reader users start there.
  const first = useRef(true);
  useEffect(() => {
    if (!step) return;
    if (first.current) { first.current = false; return; }
    headRef.current?.focus();
  }, [step]);

  const count = files.length + links.length;
  // Proposing from sources is the natural default once there are sources and nothing written yet.
  useEffect(() => {
    if (!touchedChoice) setA((x) => ({ ...x, fromSources: count > 0 && x.outcomes.trim() === "" }));
  }, [count, touchedChoice]);

  const set = (k: keyof WizardAnswers) => (v: string | boolean) => setA((x) => ({ ...x, [k]: v }));
  const index = STEPS.findIndex((x) => x.id === step);
  const go = (id: StepId) => { setProblem(null); setStep(id); };
  const next = () => go(STEPS[index + 1]?.id ?? "review");
  const back = () => go(index <= 0 ? "welcome" : STEPS[index - 1].id);

  const courseOk = a.title.trim() !== "" && a.owner.trim() !== "" && a.topic.trim() !== "" && a.audience.trim() !== "";
  const wrote = a.outcomes.split("\n").some((l) => l.trim() !== "");
  const objectivesOk = wrote || (a.fromSources && count > 0);

  const confirm = async () => {
    if (busy || !courseOk || !objectivesOk) return;
    setBusy(true); setProblem(null);
    let courseId: string | null = null;
    try {
      const r = await host.createCourse({ title: a.title.trim(), owner: a.owner.trim(), materials: [], objectivesConfirm: "explicit" });
      courseId = r.courseId;
      // Text stays in this tab, held for the course exactly as the Sources panel holds it.
      keepForCourse(courseId, files);
      keepLinksForCourse(courseId, links);
      const view = await host.getCourse(courseId);
      const asked = (view.intake.questions ?? []).map((q) => q.id);
      const all = briefAnswers(a);
      const answers: Record<string, string> = {};
      for (const [k, v] of Object.entries(all)) if (asked.includes(k) || (k === "outcomes_from" && asked.includes("learning_outcomes"))) answers[k] = v;
      if (asked.length === 0 || !asked.every((q) => KNOWN.has(q))) {
        // The host asked something this wizard did not show: record what was asked and answered, and let
        // the brief step show the rest. Nothing is confirmed that the teacher has not seen.
        if (Object.keys(answers).length) await host.answerIntake(courseId, { text: intakeText(answers), answers });
        window.location.hash = href.course(courseId);
        return;
      }
      await host.answerIntake(courseId, { text: intakeText(answers), answers });
      await host.confirmCheckpoint(courseId, { id: "files", text: "Confirm the source list." });
      await host.confirmCheckpoint(courseId, { id: "outline", text: "Confirm the brief." });
      if (a.fromSources && count > 0) askToProposeOnArrival(courseId);
      window.location.hash = href.course(courseId);
    } catch (e) {
      const id = courseId;
      const x = explainRefusal(e, id ? "brief" : "create");
      const details = x.details ? <details><summary>Details</summary>{x.details}</details> : null;
      setProblem(id
        ? <>The course was created, but the brief wasn’t confirmed. The course is kept. <a href={href.course(id)}>Open the course to finish the brief</a>.{details}</>
        : <>{x.what} {x.saved} {x.next}{details}</>);
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- layout pieces
  const spine = (
    <nav className={w.spine} aria-label="New course steps">
      <ol className={w.spineList}>
        {STEPS.map((x, i) => {
          const state = step === "welcome" ? "todo" : i < index ? "done" : i === index ? "current" : "todo";
          return (
            <li key={x.id} className={w.spineItem} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span><span className={w.spineNum}>{i + 1}</span>{x.label}</span>
              {state === "done" ? <span className={w.spineNote}>{noteFor(x.id)}</span> : null}
            </li>
          );
        })}
      </ol>
      <p className={w.spinePromise}>Nothing is recorded until you confirm on the last step. Files are read in this tab and never uploaded.</p>
    </nav>
  );
  function noteFor(id: StepId): string {
    if (id === "course") return a.title.trim();
    if (id === "sources") return count ? plural(count, "source") : "None yet";
    if (id === "objectives") return [wrote ? plural(a.outcomes.split("\n").filter((l) => l.trim()).length, "of yours", "of yours") : null, a.fromSources && count ? "Silicus proposes" : null].filter(Boolean).join(" · ");
    if (id === "ai") return ai.diagnosis.label;
    return "";
  }

  const mobileStep = step && step !== "welcome" ? (
    <div className={w.mobileStep}>
      <div className={w.mobileBar} aria-hidden="true">{STEPS.map((x, i) => <span key={x.id} className={w.mobileSeg} data-done={i <= index ? "true" : undefined} />)}</div>
    </div>
  ) : null;

  const head = (kicker: string, title: string, lede: ReactNode) => (
    <header className={w.head}>
      <p className={w.kicker}>{kicker}</p>
      <h1 ref={headRef} tabIndex={-1} className={w.title}>{title}</h1>
      <p className={w.lede}>{lede}</p>
    </header>
  );
  const foot = (primary: ReactNode, note: ReactNode = null) => (
    <div className={w.foot}>
      {note ? <p className={w.footNote}>{note}</p> : null}
      <div className={w.footButtons}>
        <Button variant="quiet" onClick={back} disabled={busy}>Back</Button>
        {primary}
      </div>
    </div>
  );
  const kicker = (id: StepId) => `Step ${STEPS.findIndex((x) => x.id === id) + 1} of ${STEPS.length}`;

  // ---------------------------------------------------------------- the steps
  let body: ReactNode = null;
  if (step === "welcome") {
    body = (
      <section className={`${w.sheet} ${w.welcome}`} aria-label="Welcome">
        {head("Welcome to Silicus", "Let’s set up your course", "Five short steps. Silicus proposes objectives and drafts a lesson plan; you decide every one of them, and only you publish.")}
        <ol className={w.promises}>
          <li className={w.promise}><span className={w.promiseNum}>1</span><span className={w.promiseTitle}>Your course and learners</span><span className={w.promiseText}>A title, your name, the topic and who it is for.</span></li>
          <li className={w.promise}><span className={w.promiseNum}>2</span><span className={w.promiseTitle}>Your sources</span><span className={w.promiseText}>Files, pasted notes or a web page. Read in this tab; only their names go on the record.</span></li>
          <li className={w.promise}><span className={w.promiseNum}>3</span><span className={w.promiseTitle}>Your objectives</span><span className={w.promiseText}>Write a few, let Silicus propose them from your sources, or both.</span></li>
          <li className={w.promise}><span className={w.promiseNum}>4</span><span className={w.promiseTitle}>A quick AI check</span><span className={w.promiseText}>Whether drafting is ready, and what to do if it isn’t.</span></li>
          <li className={w.promise}><span className={w.promiseNum}>5</span><span className={w.promiseTitle}>You confirm</span><span className={w.promiseText}>One page shows everything. Nothing is recorded until you confirm it.</span></li>
        </ol>
        <div className={`${w.foot} ${w.footBare}`}>
          <div className={w.footButtons}>
            <Button variant="primary" data-primary="true" onClick={() => go("course")}>Begin</Button>
          </div>
        </div>
      </section>
    );
  } else if (step === "course") {
    body = (
      <form className={w.sheet} aria-label="Course and learners" onSubmit={(e) => { e.preventDefault(); if (courseOk) next(); }}>
        {head(kicker("course"), "Your course and learners", "Silicus drafts from these words, and only from what you confirm.")}
        <div className={w.fields}>
          <div className={w.pair}>
            <div className={ui.field}>
              <label className={ui.label} htmlFor={ids.title}>Course title</label>
              <input id={ids.title} className={ui.input} value={a.title} onChange={(e) => set("title")(e.target.value)} placeholder="How plants eat" maxLength={200} />
            </div>
            <div className={ui.field}>
              <label className={ui.label} htmlFor={ids.owner}>Your name</label>
              <input id={ids.owner} className={ui.input} value={a.owner} onChange={(e) => set("owner")(e.target.value)} placeholder="Ms. Lovelace" maxLength={200} />
            </div>
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor={ids.topic}>Topic</label>
            <input id={ids.topic} className={ui.input} value={a.topic} onChange={(e) => set("topic")(e.target.value)} placeholder="How plants make food from sunlight" />
            <span className={ui.hint}>What this lesson is about.</span>
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor={ids.audience}>Who it’s for</label>
            <input id={ids.audience} className={ui.input} value={a.audience} onChange={(e) => set("audience")(e.target.value)} placeholder="Grade 4 science, ages 9–10" />
            <span className={ui.hint}>The class, and the learners’ age.</span>
          </div>
        </div>
        {foot(<Button variant="primary" data-primary="true" type="submit" disabled={!courseOk}>Continue</Button>,
          courseOk ? null : "All four are needed to brief Silicus.")}
      </form>
    );
  } else if (step === "sources") {
    body = (
      <section className={w.sheet} aria-label="Sources">
        {head(kicker("sources"), "Your sources", "What you teach from. Silicus reads these when it proposes objectives. You can skip this and add sources later.")}
        <SourceDrop
          taken={files.map((f) => f.name)}
          full={count >= MAX_SOURCES}
          onFile={(f) => setFiles((cur) => [...cur.filter((x) => x.name !== f.name), f].slice(0, MAX_SOURCES))}
          onLink={(u) => setLinks((cur) => (cur.includes(u) ? cur : [...cur, u]))}
        />
        {count > 0 ? (
          <ul className={w.itemList} aria-label="Sources added">
            {files.map((f) => (
              <li key={`f-${f.name}`} className={w.item}>
                <span className={w.itemIcon} aria-hidden="true">{KIND_LABEL[f.kind] ?? "TXT"}</span>
                <span className={w.itemBody}>
                  <span className={w.itemName}>{f.name}</span>
                  <span className={w.itemState} data-tone="read">✓ Read in this tab · {describeFile(f).replace(`${f.name} · `, "")}</span>
                </span>
                <button type="button" className={w.itemRemove} aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>Remove</button>
              </li>
            ))}
            {links.map((u) => (
              <li key={`l-${u}`} className={w.item}>
                <span className={w.itemIcon} aria-hidden="true">URL</span>
                <span className={w.itemBody}>
                  <span className={w.itemName}>{shortAddress(u)}</span>
                  <span className={w.itemState}>Web page · fetched when Silicus reads it</span>
                </span>
                <button type="button" className={w.itemRemove} aria-label={`Remove ${u}`} onClick={() => setLinks(links.filter((x) => x !== u))}>Remove</button>
              </li>
            ))}
          </ul>
        ) : null}
        {foot(<Button variant="primary" data-primary="true" onClick={next}>{count ? "Continue" : "Continue without sources"}</Button>,
          count ? `${plural(count, "source")} ready.` : null)}
      </section>
    );
  } else if (step === "objectives") {
    body = (
      <section className={w.sheet} aria-label="Your objectives">
        {head(kicker("objectives"), "Your objectives", "What learners should be able to do by the end. Write the ones you already know; Silicus can propose more that match your style.")}
        <div className={ui.field}>
          <label className={ui.label} htmlFor={ids.outcomes}>Write a few <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <textarea id={ids.outcomes} className={ui.textarea} rows={4} value={a.outcomes} onChange={(e) => set("outcomes")(e.target.value)}
            placeholder={"Explain how a plant makes its food\nName what a plant needs to make sugar"} />
          <span className={ui.hint}>One per line. Each becomes a proposal you accept, edit or drop.</span>
        </div>
        <label className={w.choice}>
          <input type="checkbox" checked={a.fromSources} disabled={count === 0}
            onChange={(e) => { setTouchedChoice(true); set("fromSources")(e.target.checked); }} />
          <span className={w.choiceTitle}>Let Silicus propose objectives from my sources</span>
          <span className={w.choiceText}>
            {count === 0
              ? "Add a source in the previous step to use this."
              : `It reads ${plural(count, "source")} when you confirm, and proposes objectives you decide one by one.`}
          </span>
        </label>
        {foot(<Button variant="primary" data-primary="true" disabled={!objectivesOk} onClick={next}>Continue</Button>,
          objectivesOk ? null : count ? "Write at least one, or let Silicus propose them." : "Write at least one, or go back and add a source for Silicus to read.")}
      </section>
    );
  } else if (step === "ai") {
    body = (
      <section className={w.sheet} aria-label="AI check">
        {head(kicker("ai"), "AI check", "Whether Silicus can draft right now. Writing your own objectives never needs it.")}
        <AiCheck ai={ai} />
        {foot(<Button variant="primary" data-primary="true" onClick={next}>Continue</Button>)}
      </section>
    );
  } else if (step === "review") {
    const written = a.outcomes.split("\n").map((l) => l.trim()).filter(Boolean);
    const proposing = a.fromSources && count > 0;
    const row = (label: string, value: ReactNode, edit: StepId, action = "Change") => (
      <div className={w.summaryRow}>
        <dt>{label}</dt>
        <dd>{value}</dd>
        <button type="button" className={w.summaryEdit} onClick={() => go(edit)} aria-label={`${action}: ${label}`}>{action}</button>
      </div>
    );
    body = (
      <section className={w.sheet} aria-label="Review and confirm">
        {head(kicker("review"), "Review and confirm", "This is everything Silicus will record for the course. Change anything first; nothing is recorded yet.")}
        <dl className={w.summary}>
          {row("Course", a.title.trim(), "course")}
          {row("Your name", a.owner.trim(), "course")}
          {row("Topic", a.topic.trim(), "course")}
          {row("Who it’s for", a.audience.trim(), "course")}
          {row("Sources", count ? (
            <ul className={w.summaryList}>
              {files.map((f) => <li key={f.name}>{f.name} <span className={ui.hint}>· read in this tab, {plural(f.chars, "character")}</span></li>)}
              {links.map((u) => <li key={u}>{shortAddress(u)} <span className={ui.hint}>· fetched when Silicus reads it</span></li>)}
            </ul>
          ) : "None yet. You can add them in the studio.", "sources")}
          {row("Objectives", (
            <>
              {written.length ? <ul className={w.summaryList}>{written.map((o) => <li key={o}>{o}</li>)}</ul> : null}
              {proposing ? <p style={{ marginTop: written.length ? 6 : 0 }}>Silicus proposes objectives from {plural(count, "source")}{written.length ? ", to sit alongside yours" : ""}.</p> : null}
            </>
          ), "objectives")}
          {row("AI", ai.diagnosis.sentence, "ai", "Check")}
        </dl>
        <p className={w.sends}>
          <strong>Confirming records this course as your decisions:</strong> your answers, the source list and the brief.
          {" "}Only source names go on the record; their text stays in this tab.
          {proposing ? " Then the Objectives step opens and Silicus starts reading your sources." : " Then the Objectives step opens."}
        </p>
        {problem ? <Notice>{problem}</Notice> : null}
        {foot(
          <Button variant="primary" data-primary="true" disabled={busy || !courseOk || !objectivesOk} onClick={() => void confirm()}>
            {busy ? "Recording…" : proposing ? "Confirm and propose objectives" : "Confirm and create the course"}
          </Button>,
        )}
      </section>
    );
  }

  return (
    <>
      <TopBar crumbs={[{ label: "Courses", href: href.home }, { label: "New course" }]} />
      <main className={w.page} data-welcome={step === "welcome" || step === null ? "true" : undefined}>
        {step && step !== "welcome" ? spine : null}
        {mobileStep}
        {body}
      </main>
    </>
  );
}
