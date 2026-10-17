/**
 * Objectives: what is yours sits in the document; what Silicus proposed waits in the tray until you decide.
 * Every button sends one intent; the host decides whether it stands.
 */
import { useId, useState } from "react";
import { answerText } from "../../components/AiWaiting";
import { BROWSER_MODE } from "../../gate/mode";
import type { MaterialInput } from "../../gate/transport";
import type { ProposalView } from "../../gate/types";
import { plural } from "../../lib/plural";
import { suggestOffer } from "../../live/suggest";
import type { StepProps } from "../CourseStudio";
import { Badge, Button, Skeleton, WaitClock, ui } from "../ui";
import { ActionBar } from "./ActionBar";
import s from "../Studio.module.css";

const DECIDED = new Set(["accepted", "renamed", "added"]);
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
  const range = worker?.typicalSeconds?.objectives;
  const offer = suggestOffer(rows, confirmed, worker?.configured === true);
  const [showDropped, setShowDropped] = useState(false);
  const [newText, setNewText] = useState("");
  const addId = useId();

  const answers = view.intake.answers ?? {};
  const fromSourcesAsked = answers.outcomes_from === "materials";
  const typedOutcomes = answerText(answers.learning_outcomes).trim() !== "" || Array.isArray(answers.learning_outcomes);
  const materials: MaterialInput[] = [...c.sources.map((h) => ({ name: h.name, text: h.text })), ...links.map((url) => ({ url }))];

  const decide = c.actions.decide;

  // ---- nothing proposed yet: two ways in --------------------------------------------------------------
  if (rows.length === 0 && !drafting) {
    return (
      <div className={s.doc}>
        <div className={s.docInner}>
          <header className={s.docHead}>
            <p className={s.kicker}>Step 2 of 4</p>
            <h1 className={s.docTitle}>Learning objectives</h1>
            <p className={s.docLede}>What learners should be able to do by the end. Where should the first proposals come from?</p>
          </header>
          <div className={s.paths}>
            <div className={s.pathCard}>
              <h2 className={s.pathTitle}>From your sources</h2>
              <p className={s.docLede} style={{ fontSize: "0.9375rem" }}>
                {materials.length
                  ? `Silicus reads ${plural(materials.length, "source")} and proposes objectives. You decide each one.`
                  : "Add a file, some text or a web page on the left first."}
              </p>
              <div style={{ marginTop: "auto" }}>
                <Button variant="primary" data-primary="true" disabled={c.busy || materials.length === 0 || worker?.configured === false} onClick={() => void c.actions.proposeFromSources(materials)}>Propose from sources</Button>
              </div>
              {worker?.configured === false ? <p className={s.provenance}>AI drafting isn’t set up {BROWSER_MODE ? "on this site" : "on this host"}.</p> : null}
            </div>
            {!fromSourcesAsked ? (
              <div className={s.pathCard}>
                <h2 className={s.pathTitle}>From your answers</h2>
                <p className={s.docLede} style={{ fontSize: "0.9375rem" }}>Each outcome you wrote in the brief becomes a proposal. No AI involved.</p>
                <div style={{ marginTop: "auto" }}>
                  <Button disabled={c.busy || !typedOutcomes} onClick={() => void c.actions.proposeFromAnswers()}>Use my answers</Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const tray = (
    <aside className={s.tray} aria-label="Proposals">
      <div className={s.trayHead}>
        <h2 className={s.trayTitle}>Proposals</h2>
        <span className={s.provenance}>Not yours until you accept</span>
      </div>
      {waitingRows.map((r) => <ProposalCard key={r.id} row={r} busy={c.busy} onDecide={decide} />)}
      {drafting ? (
        <div className={s.waitCard} aria-busy="true" aria-live="polite">
          {[0, 1].map((i) => <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}><Skeleton width="92%" /><Skeleton width="64%" /></div>)}
          <p className={s.waitLine}>{c.waiting?.kind === "suggest" ? "Finding objectives that round out yours" : `Reading ${plural(materials.length, "source")}`} · <WaitClock startedAt={c.waiting!.startedAt} range={range} /></p>
        </div>
      ) : null}
      {!drafting && waitingRows.length === 0 ? <p className={s.trayEmpty}>Nothing waiting. Everything proposed has a decision.</p> : null}
      {offer.show && !drafting ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Button variant="quiet" size="small" disabled={c.busy || offer.blockedBy !== null} onClick={() => void c.actions.suggestMore()}>Suggest up to 3 more</Button>
          {offer.blockedBy ? <p className={s.provenance}>{offer.blockedBy}</p> : null}
        </div>
      ) : null}
    </aside>
  );

  return (
    <>
      <div className={s.doc}>
        <div className={s.docInner}>
          <header className={s.docHead}>
            <p className={s.kicker}>Step 2 of 4</p>
            <h1 className={s.docTitle}>Learning objectives</h1>
            <p className={s.docLede}>
              {mine.length === 0
                ? "Accept, edit or drop each proposal on the right. Accepted ones land here."
                : `${plural(mine.length, "objective")} accepted${waitingRows.length ? `, ${plural(waitingRows.length, "proposal")} waiting` : ""}.`}
            </p>
          </header>

          {mine.length === 0 ? (
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

          <form className={s.addRow} onSubmit={(e) => { e.preventDefault(); if (newText.trim()) { void decide({ verb: "add", statement: newText.trim() }); setNewText(""); } }}>
            <div className={ui.field}>
              <label className={ui.label} htmlFor={addId}>Add one of your own</label>
              <input id={addId} className={ui.input} value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Students can…" maxLength={2000} />
            </div>
            <Button type="submit" disabled={c.busy || !newText.trim()} style={{ marginTop: 26 }}>Add</Button>
          </form>

          {dropped.length > 0 ? (
            <div>
              <Button variant="quiet" size="small" aria-expanded={showDropped} onClick={() => setShowDropped(!showDropped)}>{showDropped ? "Hide" : "Show"} {plural(dropped.length, "dropped proposal")}</Button>
              {showDropped ? <ul style={{ margin: "8px 0 0", paddingLeft: 20, color: "var(--fn-ink-muted)" }}>{dropped.map((r) => <li key={r.id} style={{ textDecoration: "line-through" }}>{r.statement}</li>)}</ul> : null}
            </div>
          ) : null}

          {confirmed && looking ? (
            <ActionBar text={<><strong>Objectives confirmed.</strong> Rewording keeps the plan. Removing one the plan uses means drafting a new plan.</>}>
              <Button variant="primary" onClick={() => onLook(null)}>Back to the current step</Button>
            </ActionBar>
          ) : !confirmed ? (
            <ActionBar text={waitingRows.length
              ? <><strong>{plural(waitingRows.length, "proposal")} waiting.</strong> Your objectives are confirmed when every proposal has a decision.</>
              : drafting ? "Proposals are on their way." : <><strong>Every proposal is decided.</strong></>} />
          ) : null}
        </div>
      </div>
      {!confirmed || waitingRows.length > 0 ? tray : null}
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
