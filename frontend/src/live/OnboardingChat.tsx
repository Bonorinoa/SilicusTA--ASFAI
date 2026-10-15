/**
 * OnboardingChat — the teacher names the course in a correspondence.
 *
 * A renderer plus a composer. It holds no policy. The title and the label become
 * a createCourse intent. They are not ASFAI fields. ASFAI's questions are shown
 * one at a time; each reply is posted under that question's id. The browser
 * never builds a prepare_outline payload.
 *
 * Opening replies are local until the materials step. A reload before that
 * forgets them: they were not a record yet.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { AsfaiStatus, HostView } from "../gate/transport";
import styles from "./OnboardingChat.module.css";

const FORWARDABLE = new Set(["topic", "course", "learning_outcomes"]);

const OPENING = [
  {
    id: "title",
    prompt: "What should we call this course?",
    hint: "This is the title on your record. Not sent to ASFAI. Not saved yet.",
    verb: "Record the course title",
    block: "Type a course title to continue. Not saved yet.",
  },
  {
    id: "label",
    prompt: "What label should your copy of this record carry?",
    hint: "A label for you. Not sent to ASFAI. Not saved yet.",
    verb: "Record the label",
    block: "Type a label to continue. Not saved yet.",
  },
  {
    id: "materials",
    prompt: "Name the materials this course is built from, one per line.",
    hint: "Nothing is saved until you record this. Not sent to ASFAI.",
    verb: "Record the materials",
    block: "Name the materials, or choose No materials. Not saved yet.",
  },
] as const;

type OpeningId = (typeof OPENING)[number]["id"];
const ORDER: OpeningId[] = ["title", "label", "materials"];

export interface NamedMaterial { name: string }

export function parseMaterials(text: string): NamedMaterial[] {
  const t = text.trim();
  if (/^(none|nothing|no materials|none yet)\.?$/i.test(t)) return [];
  return t.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 24).map((name) => ({ name: name.slice(0, 200) }));
}

function materialNames(materials: unknown[]): string[] {
  return materials.flatMap((m) => {
    if (m && typeof m === "object" && "name" in m && typeof (m as { name: unknown }).name === "string") {
      return [(m as { name: string }).name];
    }
    return [];
  });
}

function answerText(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.join("\n");
  return v ?? "";
}

function nextOpen(after: OpeningId, drafts: Partial<Record<OpeningId, string>>): OpeningId | "done" {
  const rest = ORDER.slice(ORDER.indexOf(after) + 1);
  return rest.find((id) => !drafts[id]) ?? "done";
}

export function OnboardingChat({
  view, asfai, busy, workerConfigured = false, onCreate, onConfirmFiles, onAsk, onAnswer, onSendToAsfai, onConnect, onRefresh,
}: {
  view: HostView | null;
  asfai: AsfaiStatus | null;
  busy: boolean;
  /** Is a drafting worker configured? Only then can the outcomes be proposed from the materials. */
  workerConfigured?: boolean;
  onCreate: (b: { owner: string; title: string; materials: NamedMaterial[] }) => void;
  onConfirmFiles: (text: string) => void;
  onAsk: () => void;
  onAnswer: (answers: Record<string, string>) => void;
  onSendToAsfai: () => void;
  onConnect: () => void;
  onRefresh: () => void;
}) {
  const [step, setStep] = useState<OpeningId>("title");
  const [drafts, setDrafts] = useState<Partial<Record<OpeningId, string>>>({});
  const [reply, setReply] = useState("");
  const [live, setLive] = useState("Step 1 of 3. Not saved.");
  const box = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const hintId = useId();

  const opening = OPENING.find((s) => s.id === step)!;
  const filesOpen = !!view && (view.checkpoints.files?.status === "pending" || view.checkpoints.files?.status === "open");
  const outlineOpen = !!view && (view.checkpoints.outline?.status === "pending" || view.checkpoints.outline?.status === "open");
  const questions = view?.intake.questions ?? [];
  const recorded = view?.intake.answers ?? {};
  // "Propose these from my materials" is a recorded answer to the outcomes question, not objective text.
  const standsIn = (id: string) => id === "learning_outcomes" && recorded.outcomes_from === "materials";
  const openQuestion = questions.find((q) => FORWARDABLE.has(q.id) && !answerText(recorded[q.id]).trim() && !standsIn(q.id));
  const unforwardable = questions.filter((q) => !FORWARDABLE.has(q.id));
  const roundComplete = questions.some((q) => FORWARDABLE.has(q.id)) && !openQuestion;
  // Who asked. The host's own questions are never attributed to ASFAI.
  const fromAsfai = view?.intake.questionsFrom === "asfai";
  const asker = fromAsfai ? "ASFAI" : "Silicus";
  const multiline = openQuestion?.id === "learning_outcomes" || (!view && step === "materials");
  const canRecord = reply.trim().length > 0 && !busy;

  useEffect(() => { box.current?.focus(); }, [step, openQuestion?.id, view?.course.courseId]);

  const finish = (all: Partial<Record<OpeningId, string>>, materialsText: string) => {
    onCreate({
      owner: (all.label ?? "").trim().slice(0, 80),
      title: (all.title ?? "").trim().slice(0, 120),
      materials: parseMaterials(materialsText),
    });
  };

  const submitOpening = () => {
    const text = reply.trim();
    if (!text) return;
    const nextDrafts = { ...drafts, [step]: text };
    setDrafts(nextDrafts);
    setReply("");
    const nxt = nextOpen(step, nextDrafts);
    if (nxt === "done") {
      setLive("Recorded. Saving this course. Not sent to ASFAI.");
      finish(nextDrafts, step === "materials" ? text : (nextDrafts.materials ?? ""));
      return;
    }
    setStep(nxt);
    setLive(`Recorded. Step ${ORDER.indexOf(nxt) + 1} of 3. Not saved. Not sent to ASFAI.`);
  };

  const noMaterials = () => {
    if (!drafts.title || !drafts.label) return;
    setLive("Recorded. Saving this course with no materials. Not sent to ASFAI.");
    finish({ ...drafts, materials: "none" }, "none");
  };

  const edit = (id: OpeningId) => {
    setReply(drafts[id] ?? "");
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    setStep(id);
    setLive(`Editing. Step ${ORDER.indexOf(id) + 1} of 3. Not saved.`);
  };

  const submitAnswer = () => {
    const text = reply.trim();
    if (!openQuestion || !text) return;
    setReply("");
    setLive(fromAsfai ? "Recorded on this course. Sent only when you send the round." : "Recorded on this course. Not sent to ASFAI.");
    onAnswer({ [openQuestion.id]: text });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, send: () => void) => {
    if (e.key === "Enter" && !e.shiftKey && !multiline) {
      e.preventDefault();
      send();
    }
  };

  const names = view ? materialNames(view.course.materials) : [];
  const confirmText = names.length ? names.join("\n") : "No materials yet.";
  const savedLines: { id: string; prompt: string; value: string }[] = view
    ? [
        { id: "title", prompt: OPENING[0].prompt, value: view.course.title },
        { id: "label", prompt: OPENING[1].prompt, value: view.course.owner },
        { id: "materials", prompt: OPENING[2].prompt, value: names.length ? names.join("\n") : "None yet." },
      ]
    : OPENING.filter((s) => drafts[s.id]).map((s) => ({ id: s.id, prompt: s.prompt, value: drafts[s.id] ?? "" }));

  return (
    <section className={styles.thread} aria-label="Course onboarding">
      <p className={styles.status}>{view ? "On this device. Not sent to ASFAI." : "On this device only. Not sent to ASFAI."}</p>
      {view ? null : <p className={styles.step} aria-live="polite">{live}</p>}
      <ol className={styles.turns}>
        {savedLines.map((s) => (
          <li key={s.id} className={styles.pair}>
            <p className={styles.ask}><span className={styles.who}>Silicus</span>{s.prompt}</p>
            <p className={styles.you}>You</p>
            <p className={styles.said}>{s.value}</p>
            <p className={styles.kept}>Not sent to ASFAI.</p>
            {!view ? (
              <button type="button" className={styles.edit} aria-label={`Edit: ${s.prompt}`} onClick={() => edit(s.id as OpeningId)}>
                Edit
              </button>
            ) : null}
          </li>
        ))}
        {questions.filter((q) => answerText(recorded[q.id]).trim() || standsIn(q.id)).map((q) => (
          <li key={q.id} className={styles.pair}>
            <p className={styles.ask}><span className={styles.who}>{asker}</span>{q.prompt}</p>
            <p className={styles.you}>You</p>
            <p className={styles.said}>{answerText(recorded[q.id]) || "Propose these from my materials."}</p>
            <p className={styles.kept}>
              {fromAsfai ? "Recorded on this course. Sent only when you send the round." : "Recorded on this course. Not sent to ASFAI."}
            </p>
          </li>
        ))}
      </ol>

      {!view ? (
        <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); submitOpening(); }}>
          <span className={styles.who}>Silicus</span>
          <label className={styles.prompt} htmlFor="onboarding-reply">{opening.prompt}</label>
          <p className={styles.kept} id={hintId}>{canRecord ? opening.hint : opening.block}</p>
          {multiline ? (
            <textarea
              id="onboarding-reply"
              ref={box as RefObject<HTMLTextAreaElement>}
              className={`${styles.box} ${styles.boxTall}`}
              rows={4}
              value={reply}
              aria-describedby={hintId}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => onKeyDown(e, submitOpening)}
            />
          ) : (
            <input
              id="onboarding-reply"
              ref={box as RefObject<HTMLInputElement>}
              className={styles.box}
              type="text"
              value={reply}
              autoComplete="off"
              maxLength={step === "title" ? 120 : 80}
              aria-describedby={hintId}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => onKeyDown(e, submitOpening)}
            />
          )}
          <div className={styles.verbs}>
            <button type="submit" className={styles.send} aria-disabled={!canRecord || undefined} aria-describedby={hintId}>
              {opening.verb}
            </button>
            {step === "materials" ? (
              <button type="button" className={styles.quiet} onClick={noMaterials}>No materials</button>
            ) : null}
          </div>
        </form>
      ) : null}

      {view && filesOpen ? (
        <div className={styles.composer}>
          <p className={styles.prompt}>Confirm this material list?</p>
          <p className={styles.said}>{confirmText}</p>
          <p className={styles.kept}>Confirming records your list. It does not send it to ASFAI.</p>
          <button type="button" className={styles.send} disabled={busy} onClick={() => onConfirmFiles(confirmText)}>
            Confirm the material list
          </button>
        </div>
      ) : null}

      {view && !filesOpen && outlineOpen ? (
        <section className={styles.asfai} aria-label={fromAsfai ? "ASFAI course intake" : "Course intake"}>
          <p className={styles.step} aria-live="polite">{live.startsWith("Recorded on") ? live : ""}</p>
          {/* ASFAI is the recommended way in, never the price of entry: the host's own
              questions below are live whether or not ASFAI is connected. */}
          {!fromAsfai && asfai?.connected ? (
            <p className={styles.kept}>
              <span className={styles.recommended}>Recommended:</span> let ASFAI ask. It aligns the lesson to its skill map
              and checks the outline. Only your answers are sent.{" "}
              <button type="button" className={styles.quiet} onClick={onAsk} disabled={busy}>Use ASFAI's questionnaire</button>
            </p>
          ) : null}
          {!fromAsfai && asfai && !asfai.connected ? (
            <p className={styles.kept}>
              <span className={styles.recommended}>Recommended:</span> connect ASFAI to align the lesson to its skill map and have
              the outline checked. Nothing waits on it — you can answer below now. Nothing is sent until you approve it.{" "}
              <button type="button" className={styles.quiet} onClick={onConnect} disabled={busy}>Connect ASFAI</button>{" "}
              <button type="button" className={styles.quiet} onClick={onRefresh} disabled={busy}>I approved it</button>
            </p>
          ) : null}
          {fromAsfai && asfai && !asfai.connected ? (
            <p className={styles.kept}>
              ASFAI is not connected. Nothing is sent until you approve it.{" "}
              <button type="button" className={styles.quiet} onClick={onConnect} disabled={busy}>Connect ASFAI</button>{" "}
              <button type="button" className={styles.quiet} onClick={onRefresh} disabled={busy}>I approved it</button>
            </p>
          ) : null}
          {unforwardable.map((q) => (
            <p key={q.id} className={styles.kept}>ASFAI asked “{q.prompt}”. Silicus has no field for that, so it will not be sent.</p>
          ))}
          {openQuestion ? (
            <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); submitAnswer(); }}>
              <span className={styles.who}>{asker}</span>
              <label className={styles.prompt} htmlFor={`intake-${openQuestion.id}`}>{openQuestion.prompt}</label>
              {openQuestion.reason ? <p className={styles.kept}>{openQuestion.reason}</p> : null}
              <p className={styles.kept} id={hintId}>
                {openQuestion.id === "learning_outcomes" ? "One outcome per line — each line becomes an objective you confirm. " : ""}
                {fromAsfai ? "Recorded on this course; sent only when you send the round." : "Recorded on this course. Not sent to ASFAI."}
              </p>
              <textarea
                id={`intake-${openQuestion.id}`}
                ref={box as RefObject<HTMLTextAreaElement>}
                className={`${styles.box} ${multiline ? styles.boxTall : ""}`}
                rows={multiline ? 4 : 2}
                value={reply}
                aria-describedby={hintId}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => onKeyDown(e, submitAnswer)}
              />
              <div className={styles.verbs}>
                <button type="submit" className={styles.send} aria-disabled={!canRecord || undefined} aria-describedby={hintId}>
                  Record this answer
                </button>
                {!fromAsfai && openQuestion.id === "learning_outcomes" && workerConfigured ? (
                  <button type="button" className={styles.quiet} disabled={busy} onClick={() => onAnswer({ outcomes_from: "materials" })}>
                    Propose these from my materials instead
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
          {fromAsfai && roundComplete ? (
            <>
              <p className={styles.kept}>Every question you can answer is recorded. Sending them is a separate act.</p>
              <button type="button" className={styles.send} onClick={onSendToAsfai} disabled={busy || view.intake.mayCallPrepareOutline === false}>
                Send your answers to ASFAI
              </button>
            </>
          ) : null}
          {view.intake.refusal ? <p className={styles.refusal}>{view.intake.refusal.reason}</p> : null}
          {fromAsfai && view.intake.outlineAuthorized ? (
            <p className={styles.kept}>ASFAI has your answers. Confirming the outline is still your decision.</p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
