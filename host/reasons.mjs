/**
 * reasons.mjs — the gate's publish blockers, classified so a UI can say them in plain words.
 * The gate's strings stay the source of truth (confirm-gate is not touched); this maps each one to a code.
 * A blocker this file does not recognise is returned as OTHER with its text: never silently dropped.
 */
export function classifyBlocker(text) {
  const t = String(text);
  let m;
  if ((m = t.match(/^checkpoint "(files|outline|objectives)" is not teacher-confirmed$/))) return { code: "CHECKPOINT_UNCONFIRMED", checkpoint: m[1] };
  if ((m = t.match(/^undecided proposals await teacher decisions: (.+)$/))) return { code: "UNDECIDED_PROPOSALS", count: m[1].split(",").filter((s) => s.trim()).length };
  if (t === "no teacher-confirmed lesson plan") return { code: "NO_CONFIRMED_PLAN" };
  if (/^lesson plan \S+ is invalidated /.test(t)) return { code: "PLAN_INVALIDATED" };
  if (t === "lesson plan has no activities") return { code: "PLAN_EMPTY" };
  if (/^objective \S+ is not confirmed /.test(t)) return { code: "PLAN_CITES_UNCONFIRMED", count: 1 };
  return { code: "OTHER", text: t };
}

/** One reason per blocker, same order. (Per-objective PLAN_CITES_UNCONFIRMED is NOT collapsed.) */
export const reasonsOf = (blockers) => blockers.map(classifyBlocker);
