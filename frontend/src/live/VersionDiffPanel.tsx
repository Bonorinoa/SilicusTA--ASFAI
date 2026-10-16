/**
 * VersionDiffPanel — what changed between two published versions of a course.
 *
 * A renderer over `diffVersions` (pure, no model, read-only). It computes from the sealed version
 * records it is given and writes nothing. Every string here is the teacher's or a model's words, so
 * everything is rendered as React text; nothing is injected as HTML.
 *
 * Every change is labelled in words ("Added", "Removed", "Reworded", "Changed", "Unchanged"); color
 * only reinforces the label.
 */
import { useEffect, useId, useMemo, useState } from "react";
import type { PackageVersionView } from "../gate/types";
import { plural } from "../lib/plural";
import {
  STATUS_LABEL, diffVersions,
  type ActivityDiff, type ActivityFieldChange, type AudienceSide, type CitedObjective,
  type ObjectiveDiff, type TextChange, type VersionDiff as VersionDiffData,
} from "./versionDiff";
import styles from "./VersionDiffPanel.module.css";

const FIELD_LABEL: Record<Extract<ActivityFieldChange, { kind: "value" }>["field"], string> = {
  title: "Title", minutes: "Minutes", learnerDoes: "What learners do", teacherDoes: "What you do",
  evidenceIfAny: "Evidence", notEvidence: "Not evidence",
};

function day(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "date unknown" : d.toISOString().slice(0, 10);
}

function ages(a: AudienceSide | null): string | null {
  if (!a) return null;
  const { ageRangeStart: s, ageRangeEnd: e } = a;
  if (s !== null && e !== null) return s === e ? `Age ${s}` : `Ages ${s}–${e}`;
  if (s !== null) return `Ages ${s}+`;
  if (e !== null) return `Up to age ${e}`;
  return null;
}

function Badge({ status }: { status: keyof typeof STATUS_LABEL }) {
  return <span className={styles.badge} data-status={status}>{STATUS_LABEL[status]}</span>;
}

/** One value, or an honest "none" when the side has nothing. */
function Val({ v, empty }: { v: string | null; empty: string }) {
  return v === null || v === "" ? <span className={styles.none}>{empty}</span> : <span className={styles.text}>{v}</span>;
}

function BeforeAfter({ before, after, from, to, empty = "(none)" }: {
  before: string | null; after: string | null; from: number; to: number; empty?: string;
}) {
  return (
    <dl className={styles.pair}>
      <div className={styles.side}>
        <dt>Before (version {from})</dt>
        <dd><Val v={before} empty={empty} /></dd>
      </div>
      <div className={styles.side}>
        <dt>After (version {to})</dt>
        <dd><Val v={after} empty={empty} /></dd>
      </div>
    </dl>
  );
}

function DetailRow({ label, change, d, empty, fmt }: {
  label: string; change: TextChange; d: VersionDiffData; empty: string; fmt?: (v: string | null) => string | null;
}) {
  const f = fmt ?? ((v: string | null) => v);
  return (
    <li className={styles.item} data-status={change.status}>
      <div className={styles.itemHead}>
        <span className={styles.itemName}>{label}</span>
        <Badge status={change.status} />
      </div>
      {change.status === "changed"
        ? <BeforeAfter before={f(change.before)} after={f(change.after)} from={d.from.version} to={d.to.version} empty={empty} />
        : <p className={styles.same}><Val v={f(change.after)} empty={empty} /></p>}
    </li>
  );
}

function Cited({ list }: { list: CitedObjective[] }) {
  return (
    <ul className={styles.inline}>
      {list.map((c) => (
        <li key={c.id}>{c.statement ?? <span className={styles.none}>an objective with no wording</span>}</li>
      ))}
    </ul>
  );
}

function ActivityChange({ c, from, to }: { c: ActivityFieldChange; from: number; to: number }) {
  if (c.kind === "value") {
    const fmt = (v: string | null) => (c.field === "minutes" && v !== null ? `${v} min` : v);
    return (
      <li className={styles.change}>
        <p className={styles.fieldName}>{FIELD_LABEL[c.field]}</p>
        <BeforeAfter before={fmt(c.before)} after={fmt(c.after)} from={from} to={to} />
      </li>
    );
  }
  if (c.kind === "objectives") {
    return (
      <li className={styles.change}>
        <p className={styles.fieldName}>Objectives it cites</p>
        {c.added.length ? <><p className={styles.sub}>Now also cites</p><Cited list={c.added} /></> : null}
        {c.removed.length ? <><p className={styles.sub}>No longer cites</p><Cited list={c.removed} /></> : null}
      </li>
    );
  }
  return (
    <li className={styles.change}>
      <p className={styles.fieldName}>Material versions it uses</p>
      {c.added.length ? <p className={styles.sub}>Added: <span className={styles.text}>{c.added.join(", ")}</span></p> : null}
      {c.removed.length ? <p className={styles.sub}>Removed: <span className={styles.text}>{c.removed.join(", ")}</span></p> : null}
    </li>
  );
}

function ObjectiveItem({ o, d }: { o: ObjectiveDiff; d: VersionDiffData }) {
  const side = o.after ?? o.before;
  const word = (s: typeof side) => s?.statement ?? s?.publicId ?? null;
  return (
    <li className={styles.item} data-status={o.status}>
      <div className={styles.itemHead}>
        <Badge status={o.status} />
      </div>
      {o.status === "reworded" ? (
        <BeforeAfter before={o.before?.statement ?? null} after={o.after?.statement ?? null} from={d.from.version} to={d.to.version} />
      ) : (
        <p className={styles.statement}><Val v={word(side)} empty="(no wording)" /></p>
      )}
      {o.status === "changed" ? (
        <p className={styles.sub}>
          Alignment changed: {o.before?.kind === "public" ? `public ${o.before.publicId ?? ""}`.trim() : "local"}
          {" → "}
          {o.after?.kind === "public" ? `public ${o.after.publicId ?? ""}`.trim() : "local"}
        </p>
      ) : null}
    </li>
  );
}

function ActivityItem({ x, d }: { x: ActivityDiff; d: VersionDiffData }) {
  const side = x.after ?? x.before;
  return (
    <li className={styles.item} data-status={x.status}>
      <div className={styles.itemHead}>
        <span className={styles.itemName}>{x.title}</span>
        <Badge status={x.status} />
      </div>
      {x.status === "added" || x.status === "removed" ? (
        <p className={styles.sub}>
          {side ? `${side.minutes} min` : null}
          {side && side.learnerDoes ? <> · <span className={styles.text}>{side.learnerDoes}</span></> : null}
        </p>
      ) : null}
      {x.status === "changed" ? (
        <ul className={styles.changes} aria-label={`What changed in ${x.title}`}>
          {x.changes.map((c, i) => <ActivityChange key={i} c={c} from={d.from.version} to={d.to.version} />)}
        </ul>
      ) : null}
    </li>
  );
}

function summary(d: VersionDiffData): string {
  if (d.identical) return "No differences: these two versions say the same thing.";
  const o = d.counts.objectives;
  const a = d.counts.activities;
  const parts: string[] = [];
  const oc = o.added + o.removed + o.reworded + o.changed;
  const ac = a.added + a.removed + a.changed;
  if (oc) parts.push(`${plural(oc, "objective")} ${oc === 1 ? "differs" : "differ"}`);
  if (ac) parts.push(`${plural(ac, "activity", "activities")} ${ac === 1 ? "differs" : "differ"}`);
  if (d.title.status === "changed") parts.push("the title");
  if (d.note.status === "changed") parts.push("the publish note");
  if (d.audience.status === "changed") parts.push("the audience");
  if (d.planPresence === "added") parts.push("a lesson plan was added");
  if (d.planPresence === "removed") parts.push("the lesson plan was removed");
  return parts.length ? `Changes: ${parts.join("; ")}.` : "Only the order of items differs.";
}

export function VersionDiffPanel({ versions, courseId }: { versions: readonly PackageVersionView[]; courseId?: string }) {
  const sorted = useMemo(() => [...versions].sort((p, q) => p.version - q.version), [versions]);
  const n = sorted.length;
  const latest = n > 0 ? sorted[n - 1].version : null;
  const fromId = useId();
  const toId = useId();
  // Selection is by position in the version-ordered list. null = the default (latest vs the one before).
  const [pick, setPick] = useState<{ a: number; b: number } | null>(null);
  // A new publish (or another course) puts the default back on "latest vs the one before it".
  useEffect(() => { setPick(null); }, [courseId, latest]);

  if (n === 0) return null;

  if (n === 1) {
    return (
      <section className={styles.panel} aria-labelledby={`${fromId}-h`}>
        <h2 id={`${fromId}-h`} className={styles.heading}>What changed between versions</h2>
        <p className={styles.empty} role="status">Nothing to compare yet: this is version {sorted[0].version}.</p>
      </section>
    );
  }

  const sel = pick ?? { a: n - 2, b: n - 1 };
  const clamp = (i: number) => Math.min(Math.max(i, 0), n - 1);
  const ia = clamp(sel.a);
  const ib = clamp(sel.b);
  // Older is always "before": a reversed choice is shown oldest-first rather than as a backwards diff.
  const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
  const same = ia === ib;
  const d = same ? null : diffVersions(sorted[lo], sorted[hi]);
  const swapped = ia > ib;

  const option = (v: PackageVersionView, i: number) => (
    <option key={i} value={i}>
      Version {v.version} · {day(v.publishedAt)}{i === n - 1 ? " (latest)" : ""}
    </option>
  );

  return (
    <section className={styles.panel} aria-labelledby={`${fromId}-h`}>
      <h2 id={`${fromId}-h`} className={styles.heading}>What changed between versions</h2>
      <p className={styles.lede}>
        Worked out from the published versions themselves. No assistant is involved and nothing here is saved.
      </p>

      <div className={styles.controls}>
        <div className={styles.field}>
          <label htmlFor={fromId} className={styles.label}>Compare version</label>
          <select id={fromId} className={styles.select} value={ia} onChange={(e) => setPick({ a: Number(e.target.value), b: ib })}>
            {sorted.map(option)}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={toId} className={styles.label}>With version</label>
          <select id={toId} className={styles.select} value={ib} onChange={(e) => setPick({ a: ia, b: Number(e.target.value) })}>
            {sorted.map(option)}
          </select>
        </div>
      </div>

      {same || !d ? (
        <p className={styles.empty} role="status">Pick two different versions to see what changed.</p>
      ) : (
        <div aria-live="polite">
          <p className={styles.range}>
            Version {d.from.version} <span aria-hidden="true">→</span><span className={styles.visuallyHidden}> to </span> version {d.to.version}
            {swapped ? <span className={styles.hint}> (shown oldest first)</span> : null}
          </p>
          <p className={styles.summary} role="status">{summary(d)}</p>

          <h3 className={styles.sectionHead}>Course details</h3>
          <ul className={styles.list} aria-label="Course details">
            <DetailRow label="Course title" change={d.title} d={d} empty="(none)" />
            <DetailRow label="Plan title" change={d.planTitle} d={d} empty="(no lesson plan)" />
            <DetailRow
              label="Audience"
              change={{ status: d.audience.status, before: ages(d.audience.before), after: ages(d.audience.after) }}
              d={d} empty="No audience stated"
            />
            <DetailRow label="Publish note" change={d.note} d={d} empty="(no note)" />
          </ul>

          <h3 className={styles.sectionHead}>Objectives</h3>
          {d.objectives.length === 0 ? <p className={styles.same}>Neither version has objectives.</p> : (
            <>
              {d.objectivesReordered ? <p className={styles.hint}>The shared objectives are in a different order.</p> : null}
              <ul className={styles.list} aria-label="Objectives that differ">
                {d.objectives.filter((o) => o.status !== "unchanged").map((o, i) => <ObjectiveItem key={`${o.id}:${i}`} o={o} d={d} />)}
              </ul>
              {d.counts.objectives.unchanged > 0 ? (
                <details className={styles.unchanged}>
                  <summary className={styles.summaryToggle}>Unchanged objectives ({d.counts.objectives.unchanged})</summary>
                  <ul className={styles.list} aria-label="Unchanged objectives">
                    {d.objectives.filter((o) => o.status === "unchanged").map((o, i) => <ObjectiveItem key={`${o.id}:${i}`} o={o} d={d} />)}
                  </ul>
                </details>
              ) : null}
            </>
          )}

          <h3 className={styles.sectionHead}>Plan activities</h3>
          {d.planPresence === "added" ? <p className={styles.hint}>Version {d.from.version} had no lesson plan.</p> : null}
          {d.planPresence === "removed" ? <p className={styles.hint}>Version {d.to.version} has no lesson plan.</p> : null}
          {d.activities.length === 0 ? <p className={styles.same}>Neither version has plan activities.</p> : (
            <>
              {d.activityIdsDisjoint ? (
                <p className={styles.hint}>
                  These versions share no activity, so every activity shows as removed and added. Activities are matched by
                  their record id, never by similar wording; a re-drafted plan gets new ids.
                </p>
              ) : null}
              {d.activitiesReordered ? <p className={styles.hint}>The shared activities are in a different order.</p> : null}
              <ul className={styles.list} aria-label="Activities that differ">
                {d.activities.filter((x) => x.status !== "unchanged").map((x, i) => <ActivityItem key={`${x.id}:${i}`} x={x} d={d} />)}
              </ul>
              {d.counts.activities.unchanged > 0 ? (
                <details className={styles.unchanged}>
                  <summary className={styles.summaryToggle}>Unchanged activities ({d.counts.activities.unchanged})</summary>
                  <ul className={styles.list} aria-label="Unchanged activities">
                    {d.activities.filter((x) => x.status === "unchanged").map((x, i) => <ActivityItem key={`${x.id}:${i}`} x={x} d={d} />)}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default VersionDiffPanel;
