/**
 * mapLines — the rotating wait lines (M1, DECISIONS §5). Pure, so the honesty rules are tested:
 *  1. each line is a stage that really happens, in order; no ticks, no percentages;
 *  2. the lines advance and stop on the last one (WaitLines never loops);
 *  3. a line that depends on state appears only when that state is true, with its numbers filled in;
 *  4. the ranking model reads topic NAMES (never descriptions), so line 2 says names.
 */
const n = (x: number) => x.toLocaleString("en-US");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface RankingFacts { fit: number | null; total: number | null; ages: { min: number; max: number }; title: string; missingWord: string | null }

export function rankingLines(f: RankingFacts): string[] {
  const ages = `${f.ages.min}–${f.ages.max}`;
  return [
    f.fit !== null && f.total !== null ? `Keeping the ${n(f.fit)} of ${n(f.total)} topics that fit ages ${ages}` : `Keeping the topics that fit ages ${ages}`,
    `Reading “${f.title.trim()}” against their names`,
    ...(f.missingWord ? [`“${cap(f.missingWord)}” isn’t a topic on the map, so Silicus looks for the ideas behind it`] : []),
    "Grouping what fits into threads",
    "Finding what comes before and after each suggestion",
  ];
}
export const RANKING_SUB = "One model call. You can skip the map at any time.";
export const RANKING_LATE = "Taking longer than usual. You can search the map or skip it.";

export interface PlanFacts {
  anchor: string | null; before: string | null; connected: string | null; sources: string[];
  minutes: number | null; ages: { min: number; max: number } | null; stage: number | null; objectives: number;
}

export function planLines(f: PlanFacts): string[] {
  const out: string[] = [];
  const ages = f.ages ? `${f.ages.min}–${f.ages.max}` : null;
  if (f.anchor) out.push(`Starting from your anchor: ${f.anchor}${ages ? `, for ages ${ages}` : ""}`);
  if (f.anchor && f.before) out.push(`Making the warm-up from what comes before it: ${f.before}`);
  if (f.connected) out.push(`Bringing in ${f.connected}, the topic you connected`);
  if (f.sources.length) out.push(`Reading your sources: ${f.sources.slice(0, 2).join(" and ")}${f.sources.length > 2 ? ` and ${f.sources.length - 2} more` : ""}`);
  if (f.minutes) out.push(`Fitting the activities into ${f.minutes} minutes`);
  if (f.ages && f.ages.max - f.ages.min >= 4) out.push(`Writing for ${f.ages.min}-year-olds and ${f.ages.max}-year-olds in the same room`);
  if (f.stage === 1) out.push("Keeping the AI with you: under 8, children don’t use it on their own");
  if (f.objectives > 0) out.push(f.objectives === 1 ? "Tying each activity to your objective" : `Tying each activity to one of your ${f.objectives} objectives`);
  out.push("Checking every objective is used, and none twice");
  return out;
}
export const PLAN_SUB = "Usually 15 to 55 seconds.";
export const PLAN_LATE = "Still drafting. Long plans can take a minute.";
