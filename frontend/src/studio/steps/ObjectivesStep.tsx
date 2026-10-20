/**
 * Objectives: what is yours sits in the document; what Silicus proposed waits in the tray until you decide.
 * Every button sends one intent; the host decides whether it stands.
 *
 * Writing your own is always open while the objectives are not confirmed, before any proposal too (R3 UI).
 * On an explicit course (view.objectivesMode, R4) the step ends on the teacher's own "Confirm objectives".
 */
import { useId, useState } from "react";
import { answerText } from "../../components/AiWaiting";
import type { MaterialInput } from "../../gate/transport";
import type { ProposalView } from "../../gate/types";
import { plural } from "../../lib/plural";
import { suggestOffer } from "../../live/suggest";
import type { StepProps } from "../CourseStudio";
import { Badge, Button, Skeleton, ui } from "../ui";
import { ActionBar } from "./ActionBar";
import { DECIDED, objectivesOffer } from "./objectivesOffer";
import s from "../Studio.module.css";

const provenance = (r: ProposalView): string => {
  const src = r.source ? r.source.charAt(0).toUpperCase() + r.source.slice(1) : r.by === "teacher" ? "Your own" : "Proposed";
  if (r.reworded) return `Reworded by you · ${src.toLowerCase()}`;
  if (r.status === "renamed") return `Renamed by you · ${src.toLowerCase()}`;
  if (r.status === "accepted") return `Accepted · ${src.toLowerCase()}`;
  return src;
};

export function ObjectivesStep({ c, view, worker, links, looking, onLook }: StepProps & { links: string[] }) {
  const rows = view.proposals;
  const mine = rows.filter((r) => DECIDED.has(r.status));
  const waitingRows = rows.filter((r) => r.status === "proposed");
  const dropped = rows.filter((r) => r.status === "dropped");
  const confirmed = view.checkpoints.objectives?.status === "confirmed";
  const drafting = c.waiting?.kind === "objectives" || c.waiting?.kind === "suggest";
  const suggest = suggestOffer(rows, confirmed, worker?.configured === true);
  const [showDropped, setShowDropped] = useState(false);
  const [newText, setNewText] = useState("");
  const addId = useId();

  const answers = view.intake.answers ?? {};
  const typedOutcomes = answerText(answers.learning_outcomes).trim() !== "" || Array.isArray(answers.learning_outcomes);
  const materials: MaterialInput[] = [...c.sources.map((h) => ({ name: h.name, text: h.text })), ...links.map((url) => ({ url }))];
  const offer = objectivesOffer({ rows, mode: view.objectivesMode, confirmed, sourceCount: materials.length, hasOutcomes: typedOutcomes, workerConfigured: worker?.configured });
  const explicit = offer.mode === "explicit";
  const nothingYet = rows.length === 0 && !drafting;

  const decide = c.actions.decide;
  const written = mine.length > 0;

  // ---- the ways to get proposals: from the sources, from the brief's answers -------------------------------
  // In an auto course the first proposal is the step's primary, as before; in an explicit course the one
  // primary is "Confirm objectives", so these stay secondary.
  const sourcesHint = materials.length === 0
    ? "Add a file, some text or a web page under Sources, and Silicus can propose objectives from it."
    : written
      ? `Silicus reads ${plural(materials.length, "source")} and matches the style of the ${plural(mine.length, "objective")} you already have.`
      : `Silicus reads ${plural(materials.length, "source")} and proposes objectives. Once you have written some, it matches their style.`;
  const ways = !drafting && (offer.sources.show || offer.answers.show || (nothingYet && !confirmed)) ? (
    <section className={s.paths} aria-label="Ways to get proposals">
      {offer.sources.show || (nothingYet && materials.length === 0) ? (
        <div className={s.pathCard}>
          <h2 className={s.pathTitle}>From your sources</h2>
          <p className={s.docLede} style={{ fontSize: "0.9375rem" }}>{sourcesHint}</p>
          {offer.sources.show ? (
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
              <Button
                variant={explicit || written ? "secondary" : "primary"}
                data-primary={explicit || written ? undefined : "true"}
                disabled={c.busy || offer.sources.heldBy !== null}
                onClick={() => void c.actions.proposeFromSources(materials)}
              >Propose from my sources</Button>
              {offer.sources.heldBy ? <p className={s.provenance}>{offer.sources.heldBy}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {offer.answers.show ? (
        <div className={s.pathCard}>
          <h2 className={s.pathTitle}>From your answers</h2>
          <p className={s.docLede} style={{ fontSize: "0.9375rem" }}>Each outcome you wrote in the brief becomes a proposal. No AI involved.</p>
          <div style={{ marginTop: "auto" }}>
            <Button disabled={c.busy} onClick={() => void c.actions.proposeFromAnswers()}>Use my answers</Button>
          </div>
        </div>
      ) : null}
    </section>
  ) : null;

  const addForm = offer.canWrite ? (
    <form className={s.addRow} aria-label="Write your own objective" onSubmit={(e) => { e.preventDefault(); if (newText.trim()) { void decide({ verb: "add", statement: newText.trim() }); setNewText(""); } }}>
      <div className={ui.field}>
        <label className={ui.label} htmlFor={addId}>{written || rows.length > 0 ? "Add one of your own" : "Write your own"}</label>
        <input id={addId} className={ui.input} value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Students can…" maxLength={2000} />
      </div>
      <Button type="submit" disabled={c.busy || !newText.trim()} style={{ marginTop: 26 }}>Add</Button>
    </form>
  ) : null;

  const tray = (
    <aside className={s.tray} aria-label="Proposals">
      <div className={s.trayHead}>
        <h2 className={s.trayTitle}>Proposals</h2>
        <span className={s.provenance}>Not yours until you accept</span>
      </div>
      {waitingRows.map((r) => <ProposalCard key={r.id} row={r} busy={c.busy} onDecide={decide} />)}
      {drafting ? (
        // The words are spoken once, by the one status line; the skeletons hold the place here.
        <div className={s.waitCard} aria-busy="true">
          {[0, 1].map((i) => <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}><Skeleton width="92%" /><Skeleton width="64%" /></div>)}
        </div>
      ) : null}
      {!drafting && waitingRows.length === 0 ? <p className={s.trayEmpty}>Nothing waiting. Everything proposed has a decision.</p> : null}
      {suggest.show && !drafting ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Button variant="quiet" size="small" disabled={c.busy || suggest.blockedBy !== null} onClick={() => void c.actions.suggestMore()}>Suggest up to 3 more</Button>
          {suggest.blockedBy ? <p className={s.provenance}>{suggest.blockedBy}</p> : null}
        </div>
      ) : null}
    </aside>
  );

  const lede = nothingYet
    ? "What learners should be able to do by the end. Write your own, let Silicus propose some, or both."
    : mine.length === 0
      ? "Accept, edit or drop each proposal under Proposals. Accepted ones land here."
      : `${plural(mine.length, "objective")} ${explicit ? "decided" : "accepted"}${waitingRows.length ? `, ${plural(waitingRows.length, "proposal")} waiting` : ""}.`;

  const bar = confirmed && looking ? (
    <ActionBar text={<><strong>Objectives confirmed.</strong> Rewording keeps the plan. Removing one the plan uses means drafting a new plan.</>}>
      <Button variant="primary" onClick={() => onLook(null)}>Back to the current step</Button>
    </ActionBar>
  ) : offer.confirm.show && !drafting ? (
    <ActionBar text={<><strong>{offer.confirm.text[0]}</strong> {offer.confirm.text[1]}</>}>
      <Button variant="primary" data-primary="true" disabled={c.busy || !offer.confirm.enabled} onClick={() => void c.actions.confirmObjectives()}>Confirm objectives</Button>
    </ActionBar>
  ) : !confirmed && !drafting && !nothingYet ? (
    <ActionBar text={waitingRows.length
      ? <><strong>{plural(waitingRows.length, "proposal")} waiting.</strong> The objectives aren’t confirmed yet.</>
      : <><strong>Every proposal is decided.</strong></>} />
  ) : null;

  return (
    <>
      <div className={s.doc}>
        <div className={s.docInner}>
          <header className={s.docHead}>
            <p className={s.kicker}>Step 2 of 4</p>
            <h1 className={s.docTitle}>Learning objectives</h1>
            <p className={s.docLede}>{lede}</p>
          </header>

          {mine.length === 0 && !nothingYet ? (
            drafting ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-hidden="true">
                <Skeleton height={72} radius={9} /><Skeleton height={72} radius={9} />
              </div>
            ) : <p className={s.trayEmpty} style={{ textAlign: "left" }}>Accepted objectives land here, numbered, with where each came from.</p>
          ) : null}

          {mine.length > 0 ? (
            <ol className={s.objList}>
              {mine.map((r, i) => <ObjectiveItem key={r.id} row={r} index={i + 1} busy={c.busy} onDecide={decide} canRedraft={worker?.configured !== false} />)}
            </ol>
          ) : null}

          {addForm}

          {ways}

          {dropped.length > 0 ? (
            <div>
              <Button variant="quiet" size="small" aria-expanded={showDropped} onClick={() => setShowDropped(!showDropped)}>{showDropped ? "Hide" : "Show"} {plural(dropped.length, "dropped proposal")}</Button>
              {showDropped ? <ul style={{ margin: "8px 0 0", paddingLeft: 20, color: "var(--fn-ink-muted)" }}>{dropped.map((r) => <li key={r.id} style={{ textDecoration: "line-through" }}>{r.statement}</li>)}</ul> : null}
            </div>
          ) : null}

          {bar}
        </div>
      </div>
      {(rows.some((r) => r.by !== "teacher") || drafting) && (!confirmed || waitingRows.length > 0) ? tray : null}
    </>
  );
}

function ProposalCard({ row, busy, onDecide }: { row: ProposalView; busy: boolean; onDecide: StepProps["c"]["actions"]["decide"] }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.statement);
  const [dropping, setDropping] = useState(false);
  const id = useId();
  return (
    <article className={s.proposal} data-rise>
      {editing ? (
        <form style={{ display: "flex", flexDirection: "column", gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (text.trim() && text.trim() !== row.statement) { void onDecide({ verb: "rename", proposalId: row.id, statement: text.trim() }); setEditing(false); } }}>
          <label className={ui.label} htmlFor={id}>Your wording</label>
          <textarea id={id} className={ui.textarea} rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus maxLength={2000} />
          <div className={s.rowActions}>
            <Button variant="primary" size="small" type="submit" disabled={busy || !text.trim() || text.trim() === row.statement}>Accept with this wording</Button>
            <Button variant="quiet" size="small" onClick={() => { setEditing(false); setText(row.statement); }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          <p className={s.statement}>{row.statement}</p>
          <p className={s.provenance}>{provenance(row)}{row.alignment ? ` · ${row.alignment.suggested ? "suggested match" : "matches"} ${row.alignment.publicId}` : ""}</p>
          {dropping ? (
            <div className={s.rowActions}>
              <span className={s.provenance} style={{ flexBasis: "100%" }}>Drop this proposal? It won’t be on your course.</span>
              <Button variant="danger" size="small" disabled={busy} onClick={() => void onDecide({ verb: "drop", proposalId: row.id })}>Drop it</Button>
              <Button size="small" autoFocus onClick={() => setDropping(false)}>Keep</Button>
            </div>
          ) : (
            <div className={s.rowActions}>
              <Button variant="primary" size="small" disabled={busy} onClick={() => void onDecide({ verb: "accept", proposalId: row.id })}>Accept</Button>
              <Button size="small" disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
              <Button variant="danger" size="small" disabled={busy} onClick={() => setDropping(true)}>Drop</Button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function ObjectiveItem({ row, index, busy, onDecide, canRedraft }: { row: ProposalView; index: number; busy: boolean; onDecide: StepProps["c"]["actions"]["decide"]; canRedraft: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.statement);
  const [removing, setRemoving] = useState(false);
  const id = useId();
  return (
    <li className={s.objItem} data-rise>
      <span className={s.objNum}>{index}</span>
      <div className={s.objBody}>
        {editing ? (
          <form style={{ display: "flex", flexDirection: "column", gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (text.trim() && text.trim() !== row.statement) { void onDecide({ verb: "reword", proposalId: row.id, statement: text.trim() }); setEditing(false); } }}>
            <label className={ui.label} htmlFor={id}>Edit the wording</label>
            <textarea id={id} className={ui.textarea} rows={2} value={text} onChange={(e) => setText(e.target.value)} autoFocus maxLength={2000} />
            <span className={ui.hint}>Same objective, new words: a plan that cites it stays valid.</span>
            <div className={s.rowActions}>
              <Button variant="primary" size="small" type="submit" disabled={busy || !text.trim() || text.trim() === row.statement}>Save wording</Button>
              <Button variant="quiet" size="small" onClick={() => { setEditing(false); setText(row.statement); }}>Cancel</Button>
            </div>
          </form>
        ) : (
          <>
            <p className={s.objStatement}>{row.statement}</p>
            <p className={s.provenance}>
              {provenance(row)}
              {row.reworded && row.originalStatement ? <> · was “{row.originalStatement}”</> : null}
              {row.citedByPlan ? <> · <Badge tone="info">In the plan</Badge></> : null}
            </p>
            {removing ? (
              <div className={s.rowActions} style={{ flexDirection: "column", alignItems: "flex-start" }}>
                {row.citedByPlan ? (
                  <p className={s.warn}>The lesson plan cites this objective, so removing it makes that plan invalid.{canRedraft ? " You’d draft and confirm a new plan before publishing." : " AI drafting isn’t set up here, so you couldn’t publish again until it is."}</p>
                ) : null}
                <div className={s.rowActions}>
                  <Button variant="danger" size="small" disabled={busy} onClick={() => void onDecide({ verb: "drop", proposalId: row.id })}>Remove objective</Button>
                  <Button size="small" autoFocus onClick={() => setRemoving(false)}>Keep it</Button>
                </div>
              </div>
            ) : (
              <div className={s.objTools}>
                <Button variant="quiet" size="small" disabled={busy} onClick={() => setEditing(true)}>Edit wording</Button>
                <Button variant="danger" size="small" disabled={busy} onClick={() => setRemoving(true)}>Remove</Button>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}
