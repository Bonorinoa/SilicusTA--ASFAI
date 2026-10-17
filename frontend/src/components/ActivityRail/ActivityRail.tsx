/**
 * ActivityRail — "Behind the scenes": which component did what to which artifact, in plain words.
 *
 * A reading aid. The host derives `items` from the event log (view.activity); the rail renders them and decides
 * nothing. It never implies the drafting model decided anything: the model proposes and drafts, the teacher
 * decides, Silicus keeps the record. Honest by construction, in the same way AiWaiting is:
 *  - every sentence comes from a copy table keyed by `action`, with only the numbers the host sent;
 *  - the step in flight (`now`) is the ONE animated element: lines of type being set, still under
 *    prefers-reduced-motion. There is no progress bar and no percentage because nothing measures progress;
 *  - zero-retention is claimed only when `worker.zdr === true`;
 *  - one polite live region announces a row only when it is ADDED (never history on mount, never a clock);
 *  - the ASFAI lane exists only in the local app: with `asfaiAvailable` false it is not drawn at all.
 * Wide (>= 72rem) it is a quiet column the page can make sticky; narrower it is a disclosure under the stage.
 * Renders nothing when there is nothing to show.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { ActivityActor, ActivityItem } from "../../gate/types";
import { plural } from "../../lib/plural";
import { ARTIFACT_LABEL, clockTime, exactTime, relativeTime, sentenceOf } from "./copy";
import { laneOf, lanesFor, type Lane } from "./lanes";
import { useMediaQuery } from "./useMediaQuery";
import styles from "./ActivityRail.module.css";

export interface ActivityRailProps {
  /** From view.activity, oldest first. */
  items: readonly ActivityItem[];
  /** The AI step in flight, from the page's waiting state. */
  now?: { actor: ActivityActor; label: string; startedAt: number } | null;
  /** From the worker status. Only an explicit `zdr: true` earns the zero-retention sentence. */
  worker?: { zdr?: boolean | null; model?: string | null } | null;
  /** False online: the ASFAI lane is not drawn at all. */
  asfaiAvailable: boolean;
}

/** Up to this many steps are all shown; beyond it the rail shows the newest RECENT and the rest are one button away
 *  (never a fold that hides just one or two). */
const FOLD_AT = 8;
const RECENT = 6;
/** Two ragged lines of type, so it reads as text being set and never as a bar: the width of each word, in ch.
 *  Fixed, decorative, meaningless on purpose. */
const LINES: readonly (readonly number[])[] = [
  [4, 2, 5, 3, 2],
  [3, 5, 2, 4],
];
// Three columns (stage navigator, stage, rail) need 80rem; below it the rail is a disclosure under the stage.
const WIDE = "(min-width: 80rem)";
/** Rows of the same actor, action and artifact this close together are one decision made in several clicks. */
const GROUP_GAP_MS = 2 * 60_000;
/** Actions whose counts add up honestly when merged. Any other action merges only when its rows are identical (then it says how many). */
const SUMMABLE: ReadonlySet<ActivityItem["action"]> = new Set(["objectives.decided"]);
const REDUCED = "(prefers-reduced-motion: reduce)";
const COUNT_WORD: Readonly<Record<number, string>> = { 3: "three", 4: "four" };

/** One row of the rail: a run of consecutive, alike steps (usually just one). `times` > 1 only for identical rows. */
export interface RailRow { item: ActivityItem; times: number }

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const sameKind = (a: ActivityItem, b: ActivityItem) => a.actor === b.actor && a.action === b.action && a.artifact === b.artifact;
/** Every non-numeric fact (a checkpoint name, a valid flag) must agree: "confirmed the material list" and "confirmed the outline" are two rows. */
const sameLabels = (a: ActivityItem["facts"], b: ActivityItem["facts"]) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const tally = (v: unknown) => v === undefined || isNum(v); // a count may be missing on one side: that side counted none
  return [...keys].every((k) => (tally(a[k]) && tally(b[k])) || a[k] === b[k]);
};
const sameNumbers = (a: ActivityItem["facts"], b: ActivityItem["facts"]) => Object.keys(a).every((k) => !isNum(a[k]) || a[k] === b[k]);

/** Fold consecutive alike steps into one (oldest first in, oldest first out). Pure; the host's list is never changed. */
export function groupRows(items: readonly ActivityItem[]): RailRow[] {
  const out: RailRow[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    const prev = last?.item;
    const alike = prev && sameKind(prev, it) && it.at - prev.at <= GROUP_GAP_MS && sameLabels(prev.facts, it.facts);
    const summable = !!prev && (SUMMABLE.has(it.action) || sameNumbers(prev.facts, it.facts));
    if (!last || !alike || !summable) { out.push({ item: it, times: 1 }); continue; }
    const facts: Record<string, string | number | boolean> = { ...prev.facts };
    for (const [k, v] of Object.entries(it.facts)) facts[k] = isNum(v) && isNum(facts[k]) ? (facts[k] as number) + v : v;
    out[out.length - 1] = { item: { ...it, facts }, times: last.times + 1 };
  }
  return out;
}

/** A dot in the actor's column: who, at a glance, with no colour doing the work alone (the name is always written too). */
function Track({ lanes, actor }: { lanes: readonly Lane[]; actor?: ActivityActor }) {
  return (
    <span className={styles.track} aria-hidden="true">
      {lanes.map((l) => <span key={l.actor} className={styles.lane} data-lane={l.actor} data-on={l.actor === actor ? "" : undefined} />)}
    </span>
  );
}

export function ActivityRail({ items, now = null, worker = null, asfaiAvailable }: ActivityRailProps) {
  const wide = useMediaQuery(WIDE);
  const reduced = useMediaQuery(REDUCED);
  const ids = { title: useId(), body: useId() };
  const lanes = lanesFor(asfaiAvailable);

  // ASFAI exists only in the local app. Online there is no lane, so there is no row and no step for it either.
  const shown = items.filter((i) => asfaiAvailable || i.actor !== "asfai"); // oldest first
  const working = now && (asfaiAvailable || now.actor !== "asfai") ? now : null;

  // Which model drafts, for the whole session: the host's `model` string as sent, or the honest "not reported".
  // No worker object at all means the status request has not answered yet — no caption until it does.
  const modelCaption = worker == null
    ? null
    : typeof worker.model === "string" && worker.model.trim() !== ""
      ? `Model name: ${worker.model.trim()}`
      : "Model name: not reported";

  // ---- relative times refresh quietly twice a minute; this never reaches the live region
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 30_000); return () => clearInterval(t); }, []);

  // ---- one polite live region: a row ADDED after mount is announced once; history and clocks never are
  const seen = useRef<Set<number> | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (seen.current === null) { seen.current = new Set(shown.map((i) => i.seq)); return; }
    const known = seen.current;
    const fresh = shown.filter((i) => !known.has(i.seq));
    if (fresh.length === 0) return;
    for (const i of fresh) known.add(i.seq);
    setAnnouncement(fresh.map((i) => `${laneOf(i.actor).name}: ${sentenceOf(i)}.`).join(" "));
  }, [items, asfaiAvailable]); // eslint-disable-line react-hooks/exhaustive-deps

  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);

  if (shown.length === 0 && !working && !modelCaption) return null;

  const newestFirst = groupRows(shown).reverse();
  const rows = all || newestFirst.length <= FOLD_AT ? newestFirst : newestFirst.slice(0, RECENT);
  const earlier = newestFirst.length - rows.length;
  const bodyOpen = wide || open;
  const steps = plural(groupRows(shown).length, "step");
  // When every row would say "just now" the words tell the teacher nothing: show the clock instead (seconds only if the rows share a minute).
  const allJustNow = rows.length > 1 && rows.every((r) => relativeTime(r.item.at, clock) === "just now");
  const sameMinute = allJustNow && new Set(rows.map((r) => clockTime(r.item.at))).size === 1;
  const whenOf = (at: number) => (allJustNow ? clockTime(at, sameMinute) : relativeTime(at, clock));

  return (
    <aside className={styles.root} aria-labelledby={ids.title} data-layout={wide ? "wide" : "narrow"}>
      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{announcement}</p>

      <div className={styles.head}>
        {wide ? (
          <>
            <h2 id={ids.title} className={styles.title}>Behind the scenes</h2>
            {shown.length > 0 ? <p className={styles.meta}>{steps}<span className={styles.order}>, newest first</span></p> : null}
          </>
        ) : (
          <h2 id={ids.title} className={styles.title}>
            <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={ids.body} onClick={() => setOpen((o) => !o)}>
              <span>Behind the scenes</span>
              {shown.length > 0 ? <span className={styles.meta}>{steps}</span> : null}
              <span className={styles.chevron} aria-hidden="true" />
            </button>
          </h2>
        )}
      </div>

      {modelCaption ? <p className={styles.fine} data-model-caption="">{modelCaption}</p> : null}

      {working ? (
        <div className={styles.now} data-now="" data-actor={working.actor} data-motion={reduced ? "still" : "live"}>
          <Track lanes={lanes} actor={working.actor} />
          <div className={styles.text}>
            <p className={styles.who}>
              <span>{laneOf(working.actor).name}</span>
              <span className={styles.status}>working now</span>
            </p>
            <p className={styles.sentence}>{working.label}</p>
            <div className={styles.ink} aria-hidden="true">
              {LINES.map((line, li) => (
                <div key={li} className={styles.line}>
                  {line.map((w, wi) => <span key={wi} className={styles.word} style={{ width: `${w}ch`, "--d": ((li * 5 + wi) * 7) % 13 } as CSSProperties} />)}
                </div>
              ))}
            </div>
            <p className={styles.fine}>Started {relativeTime(working.startedAt, clock)}</p>
            {working.actor === "worker" ? (
              <div className={styles.sees}>
                <p className={styles.fine}>
                  It sees only what this step sends, never your name or the rest of your record. The full list is under {"\u201c"}What the model sees{"\u201d"} on the waiting card.
                </p>
                {worker?.zdr === true ? <p className={styles.fine}>Sent to a drafting provider that is set to zero-data-retention endpoints only.</p> : null}
                {worker?.zdr === false ? <p className={styles.fine}>Sent under the provider{"\u2019"}s normal data-retention terms.</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div id={ids.body} className={styles.body} hidden={!bodyOpen}>
        <ul className={styles.key} aria-label={`The ${COUNT_WORD[lanes.length] ?? lanes.length} lanes`}>
          {lanes.map((l) => (
            <li key={l.actor} className={styles.keyItem}>
              <Track lanes={lanes} actor={l.actor} />
              <span className={styles.keyText}>
                <span className={styles.keyName} data-lane-name="">{l.name}</span>
                <span className={styles.keyBlurb}>{l.blurb}</span>
              </span>
            </li>
          ))}
        </ul>

        {rows.length > 0 ? (
          <ol className={styles.rows}>
            {rows.map(({ item: it, times }) => (
              <li key={it.seq} className={styles.row} data-seq={it.seq} data-actor={it.actor} data-action={it.action}>
                <Track lanes={lanes} actor={it.actor} />
                <div className={styles.text}>
                  <p className={styles.who}>
                    <span>{laneOf(it.actor).name}</span>
                    <time className={styles.when} dateTime={new Date(it.at).toISOString()} title={exactTime(it.at)}>{whenOf(it.at)}</time>
                  </p>
                  <p className={styles.sentence}>{sentenceOf(it)}{times > 1 && !SUMMABLE.has(it.action) ? <span className={styles.times}>{` · ${times} times`}</span> : null}</p>
                  <p className={styles.artifactLine}>
                    <span className={styles.artifact} data-artifact=""><span className={styles.srOnly}>Changed: </span>{ARTIFACT_LABEL[it.artifact]}</span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : null}

        {earlier > 0 ? (
          <button type="button" className={styles.more} onClick={() => setAll(true)}>
            Show {plural(earlier, "earlier step")}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

export default ActivityRail;
