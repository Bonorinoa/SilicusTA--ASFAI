/**
 * Learners.tsx — the wizard's step-1 pieces for G2b: who the learners are (five group cards and
 * exact-age steppers), the thin skill-map strip under them, the topic chosen two ways, and the
 * consequence strip that says what those choices change. State lives in audience.ts (pure).
 */
import { useEffect, useId, useState } from "react";
import { host } from "../gate/transport";
import {
  AI_RULE, GROUPS, NO_SUGGESTIONS, PLAN_VOICE, agesText, skillMapLine,
  type Anchor, type Audience, type GroupId, type Stage,
  bandsTouched, rangeLabel,
} from "./audience";
import { MarbleCredit } from "../components/MarbleCredit/MarbleCredit";
import { ui } from "./ui";
import w from "./Wizard.module.css";

export interface Coverage { overlapping: number; perAge: { age: number; count: number }[] }
/**
 * `null` = nothing yet; "unavailable" = this host has no skill map; `overlapping: -1` = bars drawn,
 * count for the chosen ages still on its way. Read the count through countOf.
 */
export type CoverageState = Coverage | null | "unavailable";
export const countOf = (c: CoverageState): number | null => (c && c !== "unavailable" && c.overlapping >= 0 ? c.overlapping : null);

/**
 * Topics per age for the chosen range, from the coverage route; refetched when the ages change.
 * Before a choice it asks for the whole strip (3–25), so the bars are drawn and the skill map is warm
 * when the teacher picks. A count is only returned for the ages it was asked for (never a stale one);
 * the bars stay put between answers, since every answer carries the same 3–25 strip.
 */
export function useCoverage(ages: Audience["ages"]): CoverageState {
  const [got, setGot] = useState<{ key: string; cov: Coverage | "unavailable" } | null>(null);
  const [bars, setBars] = useState<Coverage["perAge"]>([]);
  const lo = ages?.min ?? 3, hi = ages?.max ?? 25;
  const key = `${lo}-${hi}`;
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      host.marbleCoverage(lo, hi)
        .then((r) => { if (live) { setGot({ key, cov: { overlapping: r.overlapping, perAge: r.perAge } }); setBars(r.perAge); } })
        .catch(() => { if (live) setGot({ key, cov: "unavailable" }); });
    }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [lo, hi, key]);
  if (got?.cov === "unavailable") return "unavailable";
  if (got && got.key === key) return got.cov;
  return bars.length ? { overlapping: -1, perAge: bars } : null;
}

export const StudioMarbleCredit = () => <MarbleCredit className={w.credit} />;

// ------------------------------------------------------------------ who are your learners?
export function LearnersField({ aud, coverage, onGroup, onStep }: {
  aud: Audience; coverage: CoverageState;
  onGroup: (id: GroupId) => void; onStep: (which: "min" | "max", delta: number) => void;
}) {
  const name = useId();
  const hint = useId();
  const ages = aud.ages;
  const covered = bandsTouched(ages);
  const stepper = (which: "min" | "max", label: string) => {
    const v = ages ? ages[which] : null;
    return (
      <span className={w.stepper} role="group" aria-label={v === null ? `${label} age` : `${label} age, ${v}`}>
        <button type="button" disabled={!ages} aria-label={`${label} age: one year younger`} onClick={() => onStep(which, -1)}>−</button>
        <span className={w.stepValue} aria-hidden="true">{v ?? "–"}</span>
        <button type="button" disabled={!ages} aria-label={`${label} age: one year older`} onClick={() => onStep(which, 1)}>+</button>
      </span>
    );
  };
  return (
    <fieldset className={w.learners} aria-describedby={hint}>
      <legend className={ui.label}>Who are your learners?</legend>
      <div className={w.groups}>
        {GROUPS.map((g) => (
          <label key={g.id} className={w.group} data-covered={aud.group !== g.id && covered.includes(g.id) ? "true" : undefined}>
            <input type="radio" name={name} value={g.id} className={w.visuallyHidden} checked={aud.group === g.id} onChange={() => onGroup(g.id)} />
            <span className={w.groupAges}>{g.label}</span>
            <span className={w.groupName}>{g.name}</span>
          </label>
        ))}
      </div>
      <div className={w.refine}>
        <span>Exact ages:</span>
        <span className={w.refineRange}>
          {stepper("min", "Youngest")}
          <span>to</span>
          {stepper("max", "Oldest")}
        </span>
      </div>
      {ages ? <span className={w.rangeLabel} data-range-label aria-live="polite">{rangeLabel(ages)}</span> : null}
      <span id={hint} className={ui.hint}>Mixed ages are fine. The youngest sets the AI rules.</span>
      <AgeStrip ages={ages} coverage={coverage} />
    </fieldset>
  );
}

function AgeStrip({ ages, coverage }: { ages: Audience["ages"]; coverage: CoverageState }) {
  const bars = coverage && coverage !== "unavailable" ? coverage.perAge : [];
  const top = Math.max(1, ...bars.map((b) => b.count));
  const inRange = (age: number) => !!ages && age >= ages.min && (age <= ages.max || (ages.max > 25 && age === 25));
  const count = countOf(coverage);
  const caption = !ages ? "Choose your learners to see the skill map at their ages."
    : coverage === "unavailable" ? `${agesText(ages)} · the skill map is not available here.`
    : count === null ? `${agesText(ages)} · counting…`
    : `${agesText(ages)} · ${count.toLocaleString("en-US")} skill-map ${count === 1 ? "topic" : "topics"}`;
  return (
    <div className={w.strip}>
      {bars.length ? (
        <div className={w.bars} role="img" aria-label={`Skill-map topics at each age from 3 to 25. ${caption}.`}>
          {bars.map((b) => (
            <span key={b.age} className={w.bar} data-on={inRange(b.age) ? "true" : undefined}
              style={{ height: `${Math.max(b.count ? 8 : 2, Math.round((b.count / top) * 100))}%` }} title={`Age ${b.age}: ${b.count}`} />
          ))}
        </div>
      ) : null}
      {bars.length ? <div className={w.ticks} aria-hidden="true"><span>3</span><span>8</span><span>12</span><span>15</span><span>19</span><span>25</span></div> : null}
      <p className={w.stripCaption}>{caption}</p>
    </div>
  );
}

// ------------------------------------------------------------------ topic, two ways
export function TopicField({ aud, coverage, topic, onTopic, onAnchor, onClear }: {
  aud: Audience; coverage: CoverageState; topic: string;
  onTopic: (v: string) => void; onAnchor: (a: Anchor) => void; onClear: () => void;
}) {
  const ids = { topic: useId(), search: useId(), mode: useId() };
  const [mode, setMode] = useState<"map" | "write">("map");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Anchor[] | null>(null);
  const n = countOf(coverage);
  const hasMap = !!aud.ages && n !== null && n > 0;
  const effective = hasMap ? mode : "write";
  const min = aud.ages?.min, max = aud.ages?.max;

  useEffect(() => {
    if (effective !== "map" || min === undefined || max === undefined || q.trim().length < 2) { setHits(null); return; }
    let live = true;
    const t = setTimeout(() => {
      host.marbleSearch(q.trim(), min, max)
        .then((r) => { if (live) setHits(r.hits.map((h) => ({ id: h.id, name: h.name, subject: h.subject, ageRangeStart: h.ageRangeStart, ageRangeEnd: h.ageRangeEnd }))); })
        .catch(() => { if (live) setHits([]); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [effective, q, min, max]);

  const why = !aud.ages ? "Choose your learners first."
    : coverage === "unavailable" ? "The skill map is not available here. Write your own."
    : n === null ? "Counting skill-map topics…"
    : n === 0 ? "No skill-map topics at these ages. Write your own."
    : "Search topics that fit these ages.";

  return (
    <fieldset className={w.topicWays}>
      <legend className={ui.label}>Topic</legend>
      <div className={w.ways} role="radiogroup" aria-label="How to set the topic">
        <label className={w.way} data-disabled={hasMap ? undefined : "true"}>
          <input type="radio" name={ids.mode} checked={effective === "map"} disabled={!hasMap} onChange={() => setMode("map")} />
          <span className={w.wayTitle}>Start from the skill map</span>
          <span className={w.wayText}>{why}</span>
        </label>
        <label className={w.way}>
          <input type="radio" name={ids.mode} checked={effective === "write"} onChange={() => { setMode("write"); onClear(); }} />
          <span className={w.wayTitle}>Write your own</span>
          <span className={w.wayText}>Any topic, in your words.</span>
        </label>
      </div>

      {effective === "map" ? (
        <div className={w.mapSearch}>
          {aud.anchor ? (
            <div className={w.anchor}>
              <span className={w.anchorBody}>
                <span className={w.anchorKicker}>Skill-map anchor</span>
                <span className={w.anchorName}>{aud.anchor.name}</span>
                <span className={ui.hint}>Ages {aud.anchor.ageRangeStart}–{aud.anchor.ageRangeEnd} · {aud.anchor.subject}</span>
              </span>
              <button type="button" className={w.itemRemove} onClick={onClear} aria-label={`Clear the skill-map anchor ${aud.anchor.name}`}>Clear</button>
            </div>
          ) : (
            <div className={ui.field}>
              <label className={ui.label} htmlFor={ids.search}>Search the skill map</label>
              <input id={ids.search} type="search" className={ui.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="plants, fractions, smart devices…" autoComplete="off" />
              {hits === null ? null : hits.length === 0 ? <span className={ui.hint}>Nothing at these ages matches. Try other words, or write your own.</span> : (
                <ul className={w.hits} aria-label="Skill-map topics">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" className={w.hit} onClick={() => { onAnchor(h); onTopic(h.name); setQ(""); }}>
                        <span className={w.hitName}>{h.name}</span>
                        <span className={w.hitMeta}>Ages {h.ageRangeStart}–{h.ageRangeEnd} · {h.subject}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <StudioMarbleCredit />
        </div>
      ) : null}

      <div className={ui.field}>
        <label className={ui.label} htmlFor={ids.topic}>{effective === "map" ? "Topic, in your words" : "Your topic"}</label>
        <input id={ids.topic} className={ui.input} value={topic} onChange={(e) => onTopic(e.target.value)} placeholder="How plants make food from sunlight" />
        <span className={ui.hint}>{aud.anchor ? "Filled from the skill map. Edit it as you like." : "What this lesson is about."}</span>
      </div>
    </fieldset>
  );
}

// ------------------------------------------------------------------ consequence strip
export function Consequences({ stage, coverage }: { stage: Stage | null; coverage: CoverageState }) {
  const pending = "Choose your learners to see this.";
  const map = stage === null ? pending
    : coverage === "unavailable" ? "The skill map is not available here: you write your own objectives."
    : skillMapLine(countOf(coverage));
  return (
    <section className={w.consequences} aria-label="What your choices change">
      <div className={w.tile}>
        <span className={w.tileTitle}>AI rules for learners</span>
        {stage ? <span className={w.tileLead}>Stage {stage} of 4</span> : null}
        <span className={w.tileText}>{stage ? AI_RULE[stage] : pending}</span>
      </div>
      <div className={w.tile} data-tone={stage !== null && (coverage === "unavailable" || countOf(coverage) === 0) ? "none" : undefined}>
        <span className={w.tileTitle}>Skill map (Marble)</span>
        <span className={w.tileText}>{map === NO_SUGGESTIONS ? NO_SUGGESTIONS : map}</span>
        {/* H2a: one credit per surface — step 1 keeps the one under the anchor card, not a copy here. */}
      </div>
      <div className={w.tile}>
        <span className={w.tileTitle}>Plan voice</span>
        <span className={w.tileText}>{stage ? PLAN_VOICE[stage] : pending}</span>
      </div>
    </section>
  );
}
