/**
 * layout.ts — the skill-map neighbourhood as positions (G2c). Pure: data in, boxes and paths out, so the
 * columns and the edge styles are unit-tested without a browser. Plain SVG coordinates, no graph library.
 *
 * Four columns, left to right: Foundations (two hops up), Prerequisites (one hop up), This lesson (the
 * anchor), Unlocks next (one hop down). A hard edge is a solid line; a soft edge is dashed. "wide" puts the
 * columns side by side; "narrow" stacks them as bands for a phone, with the arrows in a left gutter.
 */
import type { MarbleNeighbourhood, MarbleNode } from "../../gate/transport";

export type ColumnKey = "foundations" | "prerequisites" | "lesson" | "next";
export const COLUMNS: readonly { key: ColumnKey; label: string }[] = [
  { key: "foundations", label: "Foundations" },
  { key: "prerequisites", label: "Prerequisites" },
  { key: "lesson", label: "This lesson" },
  { key: "next", label: "Unlocks next" },
];

export type Strength = "hard" | "soft";
export const EDGE_STYLE: Record<Strength, { width: number; dash: string | null }> = {
  hard: { width: 1.8, dash: null },
  soft: { width: 1.2, dash: "5 4" },
};

export interface LaidNode { id: string; column: ColumnKey; x: number; y: number; w: number; h: number; label: string; lines: string[]; node: MarbleNode }
export interface LaidEdge { from: string; to: string; strength: Strength; width: number; dash: string | null; d: string }
export interface Layout {
  orientation: "wide" | "narrow";
  width: number; height: number;
  headers: { key: ColumnKey; label: string; x: number; y: number }[];
  nodes: LaidNode[];
  edges: LaidEdge[];
}

/** Which column each topic sits in. Foundations are the two-hop prerequisites. */
export function columnsOf(n: MarbleNeighbourhood): Record<ColumnKey, MarbleNode[]> {
  return {
    foundations: n.prerequisites.filter((p) => (p.hops ?? 1) >= 2),
    prerequisites: n.prerequisites.filter((p) => (p.hops ?? 1) < 2),
    lesson: [n.anchor],
    next: n.dependents,
  };
}

/** The edges to draw. The host's walked edges when present; otherwise the one-hop rows only. */
export function edgesOf(n: MarbleNeighbourhood): { from: string; to: string; strength: Strength }[] {
  if (Array.isArray(n.edges)) return n.edges.map((e) => ({ from: e.from, to: e.to, strength: e.strength === "hard" ? "hard" : "soft" }));
  return [
    ...n.prerequisites.filter((p) => (p.hops ?? 1) < 2).map((p) => ({ from: p.id, to: n.anchor.id, strength: (p.strength === "hard" ? "hard" : "soft") as Strength })),
    ...n.dependents.map((d) => ({ from: n.anchor.id, to: d.id, strength: (d.strength === "hard" ? "hard" : "soft") as Strength })),
  ];
}

export const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** A name on at most `lines` lines of about `chars` characters, word-wrapped, the last line clipped. */
export function wrapName(name: string, chars: number, lines: number): string[] {
  const out: string[] = [];
  let cur = "";
  const words = name.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (next.length <= chars || !cur) { cur = next; continue; }
    out.push(cur);
    cur = words[i];
    if (out.length === lines - 1) { cur = words.slice(i).join(" "); break; }
  }
  if (cur) out.push(cur);
  return out.slice(0, lines).map((l, i, all) => (i === all.length - 1 ? clip(l, chars) : l));
}

// Wide fits the studio's document column (about 650 px) at close to 1:1, so the names stay readable.
// H2b: 17 characters of 12 px semibold fit the 120 px inside a 140 px box (about 7 px a character), so a
// name wraps onto up to three lines instead of running past the box ("Computers in Everyday Life").
const WIDE = { colX: 6, colStep: 166, w: 140, h: 80, top: 36, step: 100, width: 648, chars: 17, lines: 3 };
const NARROW = { x: 44, w: 286, h: 50, step: 60, band: 30, bandGap: 14, width: 340, chars: 36, lines: 1 };

/**
 * H2b: order each column to avoid crossings (one barycentre pass). The anchor and the one-hop prerequisites keep
 * the host's order; Foundations sit at the mean position of the prerequisites they lead to, and Unlocks next at
 * the mean position of what leads to them. Ties keep the host's order.
 */
export function orderColumns(n: MarbleNeighbourhood): Record<ColumnKey, MarbleNode[]> {
  const cols = columnsOf(n);
  const edges = edgesOf(n);
  const rank = (list: MarbleNode[]) => new Map(list.map((x, i) => [x.id, i]));
  const byBary = (list: MarbleNode[], ref: Map<string, number>, linked: (id: string) => string[]) => {
    const bary = (x: MarbleNode, i: number) => {
      const ys = linked(x.id).map((id) => ref.get(id)).filter((v): v is number => v !== undefined);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : i;
    };
    return list.map((x, i) => ({ x, i, b: bary(x, i) })).sort((a, b) => a.b - b.b || a.i - b.i).map((r) => r.x);
  };
  const pre = rank(cols.prerequisites);
  const foundations = byBary(cols.foundations, pre, (id) => edges.filter((e) => e.from === id).map((e) => e.to));
  const left = new Map([...pre, ...[...rank(cols.lesson)].map(([k]) => [k, 0] as [string, number])]);
  const next = byBary(cols.next, left, (id) => edges.filter((e) => e.to === id).map((e) => e.from));
  return { ...cols, foundations, next };
}

/** Straight-segment crossings between edges joining adjacent columns (wide layout). Tests use it. */
export function crossings(l: Layout): number {
  const at = new Map(l.nodes.map((b) => [b.id, b]));
  const segs = l.edges.map((e) => [at.get(e.from)!, at.get(e.to)!] as const).filter(([a, b]) => a && b && a.x !== b.x);
  let k = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const [a1, b1] = segs[i], [a2, b2] = segs[j];
    if (a1.x !== a2.x || b1.x !== b2.x) continue;
    if ((a1.y - a2.y) * (b1.y - b2.y) < 0) k++;
  }
  return k;
}

/** Evenly spaced points down a box's side, one per edge: the k-th of n. */
const port = (b: LaidNode, k: number, n: number) => b.y + (b.h * (k + 1)) / (n + 1);

export function layoutNeighbourhood(n: MarbleNeighbourhood, orientation: "wide" | "narrow" = "wide"): Layout {
  const cols = orderColumns(n);
  const nodes: LaidNode[] = [];
  const headers: Layout["headers"] = [];
  let width: number;
  let height: number;
  if (orientation === "wide") {
    const tallest = Math.max(1, ...COLUMNS.map((c) => cols[c.key].length));
    COLUMNS.forEach((c, i) => {
      const x = WIDE.colX + i * WIDE.colStep;
      headers.push({ key: c.key, label: c.label, x, y: 20 });
      const offset = ((tallest - cols[c.key].length) * WIDE.step) / 2;
      cols[c.key].forEach((node, j) => { const lines = wrapName(node.name, WIDE.chars, WIDE.lines); nodes.push({ id: node.id, column: c.key, x, y: WIDE.top + offset + j * WIDE.step, w: WIDE.w, h: WIDE.h, label: lines.join(" "), lines, node }); });
    });
    width = WIDE.width;
    height = WIDE.top + tallest * WIDE.step;
  } else {
    let y = 0;
    for (const c of COLUMNS) {
      if (cols[c.key].length === 0) continue; // an empty band says nothing on a phone
      headers.push({ key: c.key, label: c.label, x: NARROW.x, y: y + 18 });
      y += NARROW.band;
      for (const node of cols[c.key]) { const lines = wrapName(node.name, NARROW.chars, NARROW.lines); nodes.push({ id: node.id, column: c.key, x: NARROW.x, y, w: NARROW.w, h: NARROW.h, label: lines.join(" "), lines, node }); y += NARROW.step; }
      y += NARROW.bandGap;
    }
    width = NARROW.width;
    height = y;
  }
  const at = new Map(nodes.map((b) => [b.id, b]));
  const order = COLUMNS.map((c) => c.key);
  const edges: LaidEdge[] = [];
  // H2b: every edge enters its target at its own point, and leaves its source at its own point, ordered by
  // the other end's height so the bundle does not twist.
  const drawn = edgesOf(n).filter((e) => at.has(e.from) && at.has(e.to));
  const cy = (id: string) => { const b = at.get(id)!; return b.y + b.h / 2; };
  type E = (typeof drawn)[number];
  const slot = (id: string, side: "in" | "out", e: E) => {
    const mine = drawn.filter((x) => (side === "in" ? x.to : x.from) === id);
    const other = (x: E) => cy(side === "in" ? x.from : x.to);
    const sorted = [...mine].sort((p, q) => other(p) - other(q) || drawn.indexOf(p) - drawn.indexOf(q));
    return port(at.get(id)!, sorted.indexOf(e), sorted.length);
  };
  drawn.forEach((e, i) => {
    const a = at.get(e.from)!;
    const b = at.get(e.to)!;
    const ya = slot(e.from, "out", e);
    const yb = slot(e.to, "in", e);
    let d: string;
    if (orientation === "wide" && order.indexOf(a.column) < order.indexOf(b.column)) {
      const x1 = a.x + a.w, x2 = b.x - 2, mid = (x1 + x2) / 2;
      d = `M${x1},${ya} C${mid},${ya} ${mid},${yb} ${x2},${yb}`;
    } else if (orientation === "wide" && a.column === b.column && Math.abs(a.y - b.y) === WIDE.step) {
      // H2b: neighbours in one column: a short straight arrow across the gap between them, not a loop
      // squeezed into the gutter the cross-column edges already use.
      const x = a.x + a.w / 2;
      d = a.y > b.y ? `M${x},${a.y} L${x},${b.y + b.h + 2}` : `M${x},${a.y + a.h} L${x},${b.y - 2}`;
    } else {
      // Same column (not neighbours), or a phone: a loop in the gutter on the left of the boxes, nested by index.
      const bulge = a.x - (orientation === "wide" ? 14 : 12 + (i % 4) * 7);
      d = `M${a.x},${ya} C${bulge},${ya} ${bulge},${yb} ${b.x - 2},${yb}`;
    }
    edges.push({ from: e.from, to: e.to, strength: e.strength, ...EDGE_STYLE[e.strength], d });
  });
  return { orientation, width, height, headers, nodes, edges };
}

/** How a topic relates to the lesson, in the teacher's words. */
export function relationOf(node: MarbleNode, column: ColumnKey): string {
  const soft = node.strength === "soft";
  switch (column) {
    case "lesson": return "This lesson";
    case "prerequisites": return soft ? "Soft prerequisite (optional)" : "Hard prerequisite";
    case "foundations": return soft ? "Foundation, two steps back (optional)" : "Foundation, two steps back";
    case "next": return soft ? "Unlocks next (soft link)" : "Unlocks next";
  }
}

/** An evidence line as the start of a teacher's own objective: "Students can identify …". */
export function asObjective(line: string): string {
  const t = line.trim().replace(/[.;]+$/, "");
  if (!t) return "";
  const lower = /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
  return `Students can ${lower}.`;
}
