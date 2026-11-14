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

export interface LaidNode { id: string; column: ColumnKey; x: number; y: number; w: number; h: number; label: string; node: MarbleNode }
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

const WIDE = { colX: 40, colStep: 210, w: 170, h: 58, top: 40, step: 76, width: 860, chars: 24 };
const NARROW = { x: 44, w: 286, h: 50, step: 60, band: 30, bandGap: 14, width: 340, chars: 36 };

export function layoutNeighbourhood(n: MarbleNeighbourhood, orientation: "wide" | "narrow" = "wide"): Layout {
  const cols = columnsOf(n);
  const nodes: LaidNode[] = [];
  const headers: Layout["headers"] = [];
  let width: number;
  let height: number;
  if (orientation === "wide") {
    const tallest = Math.max(1, ...COLUMNS.map((c) => cols[c.key].length));
    COLUMNS.forEach((c, i) => {
      const x = WIDE.colX + i * WIDE.colStep;
      headers.push({ key: c.key, label: c.label, x, y: 22 });
      const offset = ((tallest - cols[c.key].length) * WIDE.step) / 2;
      cols[c.key].forEach((node, j) => nodes.push({ id: node.id, column: c.key, x, y: WIDE.top + offset + j * WIDE.step, w: WIDE.w, h: WIDE.h, label: clip(node.name, WIDE.chars), node }));
    });
    width = WIDE.width;
    height = WIDE.top + tallest * WIDE.step;
  } else {
    let y = 0;
    for (const c of COLUMNS) {
      if (cols[c.key].length === 0) continue; // an empty band says nothing on a phone
      headers.push({ key: c.key, label: c.label, x: NARROW.x, y: y + 18 });
      y += NARROW.band;
      for (const node of cols[c.key]) { nodes.push({ id: node.id, column: c.key, x: NARROW.x, y, w: NARROW.w, h: NARROW.h, label: clip(node.name, NARROW.chars), node }); y += NARROW.step; }
      y += NARROW.bandGap;
    }
    width = NARROW.width;
    height = y;
  }
  const at = new Map(nodes.map((b) => [b.id, b]));
  const order = COLUMNS.map((c) => c.key);
  const edges: LaidEdge[] = [];
  edgesOf(n).forEach((e, i) => {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b) return;
    const ya = a.y + a.h / 2;
    const yb = b.y + b.h / 2;
    let d: string;
    if (orientation === "wide" && order.indexOf(a.column) < order.indexOf(b.column)) {
      const x1 = a.x + a.w, x2 = b.x - 2, mid = (x1 + x2) / 2;
      d = `M${x1},${ya} C${mid},${ya} ${mid},${yb} ${x2},${yb}`;
    } else {
      // Same column, or a phone: a loop in the gutter on the left of the boxes, nested by index.
      const bulge = a.x - (orientation === "wide" ? 18 : 12 + (i % 4) * 7);
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
