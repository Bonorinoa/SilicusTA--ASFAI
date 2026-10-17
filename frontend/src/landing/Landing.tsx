import type { MouseEvent } from "react";
import { BROWSER_MODE } from "../gate/mode";
import "../studio/studio.css";
import styles from "./Landing.module.css";

/**
 * Landing — what Silicus is, before the app, in the studio's look (direction A, "Field notes"). It is the bare URL
 * ("", "#", "#/"); its one primary opens the studio at #/studio. The classic page stays at #/live, linked quietly.
 *
 * Every claim is one the product already makes and keeps: no sign-in, no logos, no endorsements, no retention
 * promise. Where the drafting model is involved, the page says the provider's terms apply. Unbuilt things carry a
 * "Soon" badge and link nowhere.
 */

const STUDIO = "#/studio";

const STEPS: { name: string; line: string }[] = [
  { name: "Brief", line: "Your sources and your own answers: the topic, who it’s for, what learners should be able to do." },
  { name: "Objectives", line: "Silicus proposes; each proposal waits beside your list until you accept, edit or drop it." },
  { name: "Plan", line: "Activities with minutes, each pointing to an objective you confirmed. One lesson per course for now." },
  { name: "Publish", line: "A copy students use. It can’t change; your later edits become the next version." },
];

const PLACES: { name: string; line: string; soon?: string }[] = [
  { name: "The studio", line: "Where you build a course, step by step, with every decision recorded." },
  { name: "Rehearse", line: "Ask what your students will ask, and check the helper refuses what it should." },
  { name: "The student space", line: "What learners see: today’s goals, the activities, and a helper that answers from your plan.", soon: "Class codes · soon" },
];

// Headings read on their own when skimmed. Each claim is scoped to what Silicus controls.
const NEVER: { title: string; body: string }[] = [
  { title: "Never decides for you", body: "The drafting model proposes and drafts. It never accepts an objective, confirms a plan or publishes. Only you do." },
  { title: "Never keeps your files", body: "Source text is read in your tab and sent once when you ask for a draft; Silicus does not keep it. That provider’s terms apply to what it receives." },
  { title: "Never grades students", body: "The helper answers only from what you published, and points questions about progress back to you. Questions aren’t saved. The provider’s terms apply to what it receives." },
];

const KEPT = BROWSER_MODE ? "Your courses are kept in this browser" : "Your courses are kept on this computer";

/** In-page links move the view and focus without touching the hash: the hash is the router. */
function goTo(id: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const heading = document.getElementById(id);
    heading?.scrollIntoView({ behavior: "smooth" });
    heading?.focus({ preventScroll: true });
  };
}

function Mark() {
  return (
    <span className={styles.mark} aria-hidden="true">
      <span className={styles.markLines}><span /><span style={{ width: "75%" }} /><span style={{ width: "45%" }} /></span>
    </span>
  );
}

/** A drawing of the Objectives step, made of the studio's own parts. Decorative: the caption says what it shows. */
function StudioSketch() {
  return (
    <div className={styles.sketch} aria-hidden="true">
      <div className={styles.sketchBar}>
        <span className={styles.sketchPill}>✓ Brief</span>
        <span className={styles.sketchPillOn}>2 Objectives</span>
        <span className={styles.sketchPill}>3 Plan</span>
        <span className={styles.sketchPill}>4 Publish</span>
      </div>
      <div className={styles.sketchBody}>
        <div className={styles.sketchDoc}>
          <span className={styles.sketchKicker}>Learning objectives</span>
          <div className={styles.sketchObj}><span className={styles.sketchNum}>1</span><span>Students can explain how a plant makes its food.<small>Accepted · from material: Lesson notes</small></span></div>
          <div className={styles.sketchObj}><span className={styles.sketchNum}>2</span><span>Students can name the three things a plant needs.<small>Reworded by you</small></span></div>
        </div>
        <div className={styles.sketchTray}>
          <span className={styles.sketchKicker}>Proposals</span>
          <div className={styles.sketchProposal}>
            <span>Students can label the parts of a leaf.</span>
            <small>Suggested by Silicus</small>
            <span className={styles.sketchButtons}><span className={styles.sketchAccept}>Accept</span><span className={styles.sketchGhost}>Edit</span><span className={styles.sketchDrop}>Drop</span></span>
          </div>
          <div className={styles.sketchWaiting}><span /><span /><small>Drafting more · 0:07</small></div>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div className={`studio ${styles.page}`}>
      <header className={styles.header}>
        <div className={styles.column}>
          <a className={styles.wordmark} href="#/" aria-label="Silicus TA, home">
            <Mark />
            <span className={styles.wordmarkName}>Silicus <span className={styles.wordmarkTa}>TA</span></span>
          </a>
          <a className={styles.headerLink} href={STUDIO}>Open the studio</a>
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
              Bring your sources and a few answers. Silicus proposes objectives and drafts a plan; you accept, edit or drop
              each piece, and only you publish.
            </p>
            <div className={styles.actions}>
              <a className={styles.primary} href={STUDIO}>Open the studio</a>
              <a className={styles.secondary} href="#/" onClick={goTo("landing-steps")}>How it works</a>
            </div>
            {BROWSER_MODE ? (
              <p className={styles.note}>The AI steps ask for a demo passcode. Ask the person who shared this link.</p>
            ) : null}
          </div>
          <figure className={styles.figure}>
            <StudioSketch />
            <figcaption className={styles.caption}>The Objectives step: proposals wait on the right until you decide.</figcaption>
          </figure>
        </section>

        <section className={styles.section} aria-labelledby="landing-steps">
          <h2 id="landing-steps" tabIndex={-1} className={styles.h2}>Four steps, each one yours to confirm</h2>
          <ol className={styles.steps}>
            {STEPS.map((s) => (
              <li key={s.name} className={styles.step}>
                <h3 className={styles.stepName}>{s.name}</h3>
                <p className={styles.stepLine}>{s.line}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="landing-places">
          <h2 id="landing-places" className={styles.h2}>Three places</h2>
          <ul className={styles.places}>
            {PLACES.map((p) => (
              <li key={p.name} className={styles.place}>
                <h3 className={styles.placeName}>{p.name}</h3>
                <p className={styles.stepLine}>{p.line}</p>
                {p.soon ? <span className={styles.soon}>{p.soon}</span> : null}
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="landing-never">
          <h2 id="landing-never" className={styles.h2}>What Silicus never does</h2>
          <ul className={styles.never}>
            {NEVER.map((n) => (
              <li key={n.title} className={styles.neverItem}>
                <h3 className={styles.neverTitle}>{n.title}</h3>
                <p className={styles.body}>{n.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="landing-stands">
          <h2 id="landing-stands" className={styles.h2}>Where it stands</h2>
          <div className={styles.two}>
            <p className={styles.body}>
              <strong>A prototype.</strong> It is unfinished and will change. The AI’s proposals can be wrong, which is why you
              read and confirm each one. A course holds one lesson.
            </p>
            <p className={styles.body}>
              <strong>{KEPT}.</strong> Export a copy to keep it safe. Source text is read in the tab and gone when you reload.
            </p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="landing-under">
          <details className={styles.dev}>
            <summary className={styles.devSummary}><h2 id="landing-under" className={styles.devTitle}>Under the hood</h2></summary>
            <div className={styles.devBody}>
              <p className={styles.body}>
                Silicus does not use RAG or a vector store. PDF, DOCX and PPTX files are read in your browser; only their
                names go on the course record. Every decision is an entry in a hash-chained log you can check from the
                course’s history.
              </p>
              <p className={styles.body}>
                ASFAI is a protocol that checks a plan against its shared lesson format; Silicus works without it, and the
                version on your computer can send a plan to ASFAI. Objectives can be aligned to Marble’s skill map (about
                ages 4–15); a miss is normal.
              </p>
              <p className={styles.body}>
                On a set of 44 student questions the helper answered every definition question, refused every off-topic,
                assessment and injection question, and made no invalid citations (eval/student-helper/scorecard-candidate2.md).
              </p>
              <p className={styles.body}>
                To run it on your computer: start the host (<code>cd host &amp;&amp; npm install &amp;&amp; npm start</code>), then the
                app (<code>cd frontend &amp;&amp; npm install &amp;&amp; npm run dev</code>), and open <code>http://localhost:5173/#/studio</code>.
                The AI steps stay off until the host is given a drafting model; <code>host/README.md</code> says how.
              </p>
            </div>
          </details>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.column}>
          <p className={styles.footerText}>A prototype. The AI only proposes and drafts.</p>
          <a className={styles.footerLink} href="#/live">Classic view</a>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
