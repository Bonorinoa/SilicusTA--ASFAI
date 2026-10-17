import type { MouseEvent } from "react";
import { BROWSER_MODE } from "../gate/mode";
import heroObjectives from "./hero-objectives.png";
import styles from "./Landing.module.css";

/**
 * Landing — what Silicus is, in plain words, before the app. It is the bare URL ("", "#", "#/"); the app is at #/live.
 * Every sentence comes from docs/design/glossary.md or from what the app already tells teachers; nothing here
 * is a claim the product does not already make elsewhere (no sign-in, no logos, no endorsements; the only numbers
 * are the benchmark's question count, Marble's age range, and the scorecard's file name).
 */

const STEPS: { name: string; line: string }[] = [
  { name: "Course", line: "Name it, say who it is for, and list your materials if you have them." },
  { name: "Brief", line: "Your own answers: the topic, who it is for, and what learners should be able to do. You confirm them." },
  { name: "Objectives", line: "What learners should be able to do. Silicus proposes some; you accept, rename or drop each one." },
  { name: "Lesson plan", line: "Activities with minutes, each pointing to the objectives you confirmed. One lesson per course in this prototype." },
  { name: "Version", line: "A published copy of the objectives and the plan, which students use. It can't be changed; changes become version 2." },
];

// Headings read on their own when skimmed. Each claim is scoped to what Silicus controls: where the drafting model
// is involved, the provider's own terms apply, and the page says so. No retention promise is made here.
const NEVER: { title: string; body: string }[] = [
  {
    title: "Never decides for you",
    body: "The drafting model proposes and drafts. It never accepts an objective, confirms a plan or publishes a version. Only you do.",
  },
  {
    title: "Never keeps your files",
    body: "The course lists the names of your materials. Their text is used for one request and is gone when you reload; Silicus does not keep it. It goes once to the drafting model, and that provider’s terms apply to what it receives. Use material you are allowed to share.",
  },
  {
    title: "Never grades or saves student questions",
    body: "You can ask the helper a question a student might ask, about a published version. Silicus does not grade a question or save it. Each one goes to the drafting model, which answers from that version only, and the provider’s terms apply to what it receives. For how a student is doing, the helper points to you.",
  },
];

const KEPT = BROWSER_MODE ? "Your courses are kept in this browser." : "Your courses are kept on this computer.";
const HERO_ALT =
  "The Objectives step in Silicus. A card titled Learning objectives lists two proposed objectives, " +
  "“Students can explain how a plant makes its food.” and “Students can name what a plant needs to make sugar.” " +
  "Each is marked as awaiting a decision and has three buttons: Accept, Rename and Drop.";

/** In-page links move the view and focus without touching the hash: the hash is the router, and an unknown hash would leave the landing. */
function goTo(id: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const heading = document.getElementById(id);
    heading?.scrollIntoView();
    heading?.focus();
  };
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
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>A prototype, for teachers of learners aged 5–14</p>
            <h1 id="landing-title" className={styles.title}>
              <span className={styles.titleLine}>Plan a lesson with an AI that proposes.</span>{" "}
              <span className={styles.titleLine}>You decide.</span>
            </h1>
            <p className={styles.lead}>
              Silicus helps a teacher get from what students should learn to a lesson plan. The AI suggests objectives and
              drafts the plan. You accept, rename or drop each piece, and nothing is final until you confirm it.
            </p>
            <div className={styles.actions}>
              <a className={styles.primary} href="#/live">Try it</a>
              <a className={styles.secondary} href="#/" onClick={goTo("landing-steps")}>See the five steps</a>
            </div>
            {BROWSER_MODE ? (
              <p className={styles.note}>The AI steps ask for a demo passcode. Ask the person who shared this link.</p>
            ) : null}
          </div>
          <figure className={styles.figure}>
            <img className={styles.shot} src={heroObjectives} width={1472} height={1168} alt={HERO_ALT} />
            <figcaption className={styles.caption}>The Objectives step: proposals wait for a decision.</figcaption>
          </figure>
        </section>

        <section className={styles.section} aria-labelledby="landing-steps">
          <h2 id="landing-steps" tabIndex={-1} className={styles.h2}>Five steps, and you decide at every one</h2>
          <ol className={styles.steps}>
            {STEPS.map((s) => (
              <li key={s.name} className={styles.step}>
                <h3 className={styles.stepName}>{s.name}</h3>
                <p className={styles.stepLine}>{s.line}</p>
              </li>
            ))}
          </ol>
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

        <section className={styles.section} aria-labelledby="landing-where">
          <h2 id="landing-where" className={styles.h2}>Where your work lives</h2>
          <p className={styles.body}>{KEPT} Material text you add is used for one request and is gone when you reload.</p>
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

        <section className={styles.section} aria-labelledby="landing-how">
          <h2 id="landing-how" className={styles.h2}>How it works</h2>
          <p className={styles.body}>
            Silicus does not use RAG or a vector store. PDF, DOCX and PPTX files are read in your browser: only their names go on the course record, and the text stays in the tab until you ask for objectives from those materials. The drafting model writes a draft, you confirm it, and only then is a published version made. Where it is available, you can send the plan to ASFAI, an optional protocol that checks its format; ASFAI is not the model and not an account. Objectives can be aligned to Marble’s skill map, which covers about ages 4–15; a miss is normal, and you name a local objective instead. On a set of 44 student questions the helper passed: it answered every definition question, refused every off-topic, assessment and injection question, and made no invalid citations (eval/student-helper/scorecard-candidate2.md).
          </p>
        </section>

        <section className={styles.section} aria-labelledby="landing-dev">
          <details className={styles.dev}>
            <summary className={styles.devSummary}>
              <h2 id="landing-dev" className={styles.devTitle}>For developers: run it locally</h2>
            </summary>
            <div className={styles.devBody}>
              <p className={styles.body}>
                ASFAI is a protocol that checks a plan against its shared lesson format; Silicus works without it.
              </p>
              <p className={styles.body}>
                {BROWSER_MODE
                  ? "The online version keeps your record in the browser, and it cannot use ASFAI or YouTube. The version on your computer keeps courses in a folder there, and can send a plan to ASFAI."
                  : "You are using the version that runs on this computer. It keeps courses in a folder here, and can send a plan to ASFAI. These are the steps to start it."}
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
                    Send a plan to ASFAI from the course page when you want to.
                  </p>
                </li>
              </ol>
            </div>
          </details>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.column}>
          <p className={styles.footerText}>A prototype. The AI only proposes and drafts.</p>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
