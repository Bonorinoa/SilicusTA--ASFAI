import type { MouseEvent } from "react";
import { BROWSER_MODE } from "../gate/mode";
import styles from "./Landing.module.css";

/**
 * Landing — what Silicus is, in plain words, before the app. Reached at #/ (and #); the app stays at #/live.
 * Every sentence comes from docs/design/glossary.md or from what the app already tells teachers; nothing here
 * is a claim the product does not already make elsewhere (no sign-in, no logos, no endorsements, no numbers).
 */

const STEPS: { name: string; line: string }[] = [
  { name: "Course", line: "Name it, say who it is for, and list your materials if you have them." },
  { name: "Brief", line: "Your own answers: the topic, who it is for, and what learners should be able to do. You confirm them." },
  { name: "Objectives", line: "What learners should be able to do. Silicus proposes some; you accept, reword or drop each one." },
  { name: "Lesson plan", line: "Activities with minutes, each pointing to the objectives you confirmed. One lesson per course in this prototype." },
  { name: "Version", line: "A published copy of the objectives and the plan, which students use. It can't be changed; changes become version 2." },
];

const NEVER: { title: string; body: string }[] = [
  {
    title: "Decide for you",
    body: "The drafting model proposes and drafts. It never accepts an objective, confirms a plan or publishes a version. Only you do.",
  },
  {
    title: "Keep your files",
    body: "Material you add stays in your browser tab. It is sent once to the drafting model to propose objectives, and it is gone when you reload. Use material you are allowed to share.",
  },
  {
    title: "Grade or save student questions",
    body: "A student can ask the helper about a published version. Each question goes to the drafting model to be answered from that version only. It is never graded and never saved. For how a student is doing, the helper points to you.",
  },
];

const KEPT = BROWSER_MODE ? "Your courses are kept in this browser." : "Your courses are kept on this computer.";
const RECORD = BROWSER_MODE ? `${KEPT} The AI steps ask for a demo passcode.` : KEPT;

/** The secondary action is a link inside this page, so it moves focus and view instead of changing the hash route. */
function goToLocal(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  const heading = document.getElementById("run-on-your-computer");
  heading?.scrollIntoView();
  heading?.focus();
}

/** Three lines of type on an ink-blue ground: the same mark as the favicon, drawn from the tokens. */
function Mark() {
  return (
    <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className={styles.markGround} width="32" height="32" rx="7" />
      <rect className={styles.markLine} x="7" y="9" width="18" height="3" rx="1.5" />
      <rect className={styles.markLine} x="7" y="15" width="13" height="3" rx="1.5" opacity="0.85" />
      <rect className={styles.markLine} x="7" y="21" width="8" height="3" rx="1.5" opacity="0.7" />
    </svg>
  );
}

export function Landing() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.column}>
          <a className={styles.wordmark} href="#/" aria-label="Silicus TA, home">
            <Mark />
            <span className={styles.wordmarkName}>Silicus <span className={styles.wordmarkTa}>TA</span></span>
          </a>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <p className={styles.eyebrow}>A prototype, for teachers of learners aged 5–14</p>
          <h1 id="landing-title" className={styles.title}>Plan a lesson with an AI that proposes. You decide.</h1>
          <p className={styles.lead}>
            Silicus helps a teacher get from what students should learn to a lesson plan. The AI suggests objectives and
            drafts the plan. You accept, reword or drop each piece, and nothing is final until you confirm it.
          </p>
          <div className={styles.actions}>
            <a className={styles.primary} href="#/live">Try it</a>
            <a className={styles.secondary} href="#/" onClick={goToLocal}>Run it on your computer (with ASFAI)</a>
          </div>
          <p className={styles.note}>{RECORD}</p>
        </section>

        <section className={styles.section} aria-labelledby="landing-steps">
          <h2 id="landing-steps" className={styles.h2}>Five steps, and you decide at every one</h2>
          <ol className={styles.steps}>
            {STEPS.map((s) => (
              <li key={s.name} className={styles.step}>
                <h3 className={styles.stepName}>{s.name}</h3>
                <p className={styles.stepLine}>{s.line}</p>
              </li>
            ))}
          </ol>
          <p className={styles.decide}>
            Silicus can propose objectives and draft the plan. Each step is yours to confirm, and nothing moves on without it.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="landing-never">
          <h2 id="landing-never" className={styles.h2}>What Silicus never does</h2>
          <ul className={styles.never}>
            {NEVER.map((n) => (
              <li key={n.title} className={styles.neverItem}>
                <h3 className={styles.neverTitle}>{n.title}</h3>
                <p className={styles.neverBody}>{n.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="landing-for">
          <h2 id="landing-for" className={styles.h2}>Who it is for, and where it stands</h2>
          <div className={styles.two}>
            <div>
              <h3 className={styles.h3}>Teachers of learners aged 5–14</h3>
              <p className={styles.body}>That is the only group this prototype is designed for. A course holds one lesson.</p>
            </div>
            <div>
              <h3 className={styles.h3}>A prototype</h3>
              <p className={styles.body}>
                It is unfinished and it will change. The AI’s proposals can be wrong, which is why you read and confirm each one.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="run-on-your-computer">
          <h2 id="run-on-your-computer" tabIndex={-1} className={styles.h2}>Run it on your computer</h2>
          <p className={styles.body}>
            {BROWSER_MODE
              ? "The online version keeps your record in the browser, and it cannot use ASFAI or YouTube. The version on your computer keeps courses in a folder there, and can connect to an ASFAI account."
              : "You are using the version that runs on this computer. It keeps courses in a folder here, and can connect to an ASFAI account. These are the steps to start it."}
          </p>
          <p className={styles.body}>
            ASFAI is a separate lesson-records product. If you connect it, it asks questions about your lesson and checks that the plan is in
            its shared lesson format. It does not judge whether the lesson is good. Silicus works without it.
          </p>
          <ol className={styles.local}>
            <li>
              <p className={styles.body}>You need Node 18 or newer and the Silicus code folder. Ask whoever shared this with you.</p>
            </li>
            <li>
              <p className={styles.body}>In a terminal, start the host. It saves your courses in the folder <code>~/.silicus/host</code></p>
              <pre className={styles.code}><code>cd host{"\n"}npm install{"\n"}npm start</code></pre>
            </li>
            <li>
              <p className={styles.body}>In a second terminal, start the app, then open this address: <code>http://localhost:5173/#/live</code></p>
              <pre className={styles.code}><code>cd frontend{"\n"}npm install{"\n"}npm run dev</code></pre>
            </li>
            <li>
              <p className={styles.body}>
                The AI steps stay off until the host is given a drafting model. <code>host/README.md</code> says how.
                Connect ASFAI from the course page when you want to.
              </p>
            </li>
          </ol>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.column}>
          <p className={styles.footerText}>A prototype. Teachers decide every step; the AI only proposes and drafts. {KEPT}</p>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
