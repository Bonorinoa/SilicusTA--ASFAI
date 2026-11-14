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
} from "./audience";
import { ui } from "./ui";
import w from "./Wizard.module.css";

export interface Coverage { overlapping: number; perAge: { age: number; count: number }[] }
/** `null` = not asked yet or in flight; "unavailable" = this host has no skill map. */
export type CoverageState = Coverage | null | "unavailable";

/** Topics per age for the chosen range, from the coverage route; refetched when the ages change. */
export function useCoverage(ages: Audience["ages"]): CoverageState {
  const [cov, setCov] = useState<CoverageState>(null);
  const min = ages?.min, max = ages?.max;
  useEffect(() => {
    if (min === undefined || max === undefined) { setCov(null); return; }
    let live = true;
    const t = setTimeout(() => {
      host.marbleCoverage(min, max)
        .then((r) => { if (live) setCov({ overlapping: r.overlapping, perAge: r.perAge }); })
        .catch(() => { if (live) setCov("unavailable"); });
    }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [min, max]);
  return cov;
}

export const MarbleCredit = () => (
  <p className={w.credit}>
    Marble Skill Taxonomy (v1) · © Generative Spark, Inc. (Marble) ·{" "}
    <a href="https://withmarble.com" target="_blank" rel="noreferrer">https://withmarble.com</a> · licensed under
    ODbL 1.0 (database) and CC BY-SA 4.0 (content).
  </p>
);

// ------------------------------------------------------------------ who are your learners?
export function LearnersField({ aud, coverage, onGroup, onStep }: {
  aud: Audience; coverage: CoverageState;
  onGroup: (id: GroupId) => void; onStep: (which: "min" | "max", delta: number) => void;
}) {
  const name = useId();
  const hint = useId();
  const ages = aud.ages;
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
          <label key={g.id} className={w.group}>
            <input type="radio" name={name} value={g.id} className={w.visuallyHidden} checked={aud.group === g.id} onChange={() => onGroup(g.id)} />
            <span className={w.groupAges}>{g.label}</span>
            <span className={w.groupName}>{g.name}</span>
          </label>
        ))}
      </div>
      <div className={w.refine}>
        <span>Exact ages:</span>
        {stepper("min", "Youngest")}
        <span>to</span>
        {stepper("max", "Oldest")}
      </div>
      <span id={hint} className={ui.hint}>Mixed ages are fine. The youngest sets the AI rules.</span>
      <AgeStrip ages={ages} coverage={coverage} />
    </fieldset>
  );
}

function AgeStrip({ ages, coverage }: { ages: Audience["ages"]; coverage: CoverageState }) {
  const bars = coverage && coverage !== "unavailable" ? coverage.perAge : [];
  const top = Math.max(1, ...bars.map((b) => b.count));
  const inRange = (age: number) => !!ages && age >= ages.min && (age <= ages.max || (ages.max > 25 && age === 25));
  const count = coverage && coverage !== "unavailable" ? coverage.overlapping : null;
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
  const hasMap = !!aud.ages && !!coverage && coverage !== "unavailable" && coverage.overlapping > 0;
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
    : coverage === null ? "Counting skill-map topics…"
    : coverage.overlapping === 0 ? "No skill-map topics at these ages. Write your own."
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
          <MarbleCredit />
        </div>
      ) : null}

      <div className={ui.field}>
        <label className={ui.label} htmlFor={ids.topic}>{effective === "map" ? "Topic, in your words" : "Your topic"}</label>
        <input id={ids.topic} className={ui.input} value={topic} onChange={(e) => onTopic(e.target.value)} placeholder="How plants make food from sunlight" />
        <span className={ui.hint}>{aud.anchor ? "Filled from the skill map. Edit it as you like; the anchor stays a pointer." : "What this lesson is about."}</span>
      </div>
    </fieldset>
  );
}

// ------------------------------------------------------------------ consequence strip
export function Consequences({ stage, coverage }: { stage: Stage | null; coverage: CoverageState }) {
  const pending = "Choose your learners to see this.";
  const map = stage === null ? pending
    : coverage === "unavailable" ? "The skill map is not available here: you write your own objectives."
    : skillMapLine(coverage === null ? null : coverage.overlapping);
  return (
    <section className={w.consequences} aria-label="What your choices change">
      <div className={w.tile}>
        <span className={w.tileTitle}>AI rules for learners</span>
        {stage ? <span className={w.tileLead}>Stage {stage} of 4</span> : null}
        <span className={w.tileText}>{stage ? AI_RULE[stage] : pending}</span>
      </div>
      <div className={w.tile} data-tone={stage !== null && (coverage === "unavailable" || (coverage && coverage.overlapping === 0)) ? "none" : undefined}>
        <span className={w.tileTitle}>Skill map (Marble)</span>
        <span className={w.tileText}>{map === NO_SUGGESTIONS ? NO_SUGGESTIONS : map}</span>
      </div>
      <div className={w.tile}>
        <span className={w.tileTitle}>Plan voice</span>
        <span className={w.tileText}>{stage ? PLAN_VOICE[stage] : pending}</span>
      </div>
    </section>
  );
}
