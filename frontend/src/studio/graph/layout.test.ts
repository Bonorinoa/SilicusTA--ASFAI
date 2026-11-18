/** layout.test.ts — G2c: the neighbourhood view's columns and edge styles, pure. */
import { describe, expect, it } from "vitest";
import { AI_DAILY } from "./fixture";
import { asObjective, columnsOf, crossings, EDGE_STYLE, layoutNeighbourhood, relationOf, wrapName } from "./layout";

describe("G2c layout: nodes per column", () => {
  it("puts two-hop prerequisites in Foundations, one-hop in Prerequisites, the anchor alone, dependents in Unlocks next", () => {
    const c = columnsOf(AI_DAILY);
    expect(c.foundations.map((n) => n.id)).toEqual(["mt_XbGfVhfiUz", "mt__p5n8z5soJ"]);
    expect(c.prerequisites.map((n) => n.id)).toEqual(["mt_WRRv1ABECC", "mt_u6SYiVx7FX"]);
    expect(c.lesson.map((n) => n.id)).toEqual(["mt_AzTrT5ySCx"]);
    expect(c.next.map((n) => n.id)).toEqual(["mt_kH1DzOPsXG"]);
  });

  it("wide: four columns left to right, one x per column, boxes never overlap inside a column", () => {
    const l = layoutNeighbourhood(AI_DAILY, "wide");
    expect(l.headers.map((h) => h.label)).toEqual(["Foundations", "Prerequisites", "This lesson", "Unlocks next"]);
    const xs = ["foundations", "prerequisites", "lesson", "next"].map((k) => new Set(l.nodes.filter((n) => n.column === k).map((n) => n.x)));
    xs.forEach((s) => expect(s.size).toBe(1));
    const order = xs.map((s) => [...s][0]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const k of ["foundations", "prerequisites"]) {
      const col = l.nodes.filter((n) => n.column === k).sort((a, b) => a.y - b.y);
      expect(col[1].y).toBeGreaterThanOrEqual(col[0].y + col[0].h);
    }
    for (const n of l.nodes) expect(n.y + n.h).toBeLessThanOrEqual(l.height);
    for (const n of l.nodes) expect(n.x + n.w).toBeLessThanOrEqual(l.width);
  });

  it("wraps a long name onto two lines in a wide box and clips only the last line", () => {
    expect(wrapName("Voice Assistants and How They Work", 21, 2)).toEqual(["Voice Assistants and", "How They Work"]);
    expect(wrapName("Data and Information for Computers", 21, 2)).toEqual(["Data and Information", "for Computers"]);
    expect(wrapName("AI in Daily Life", 21, 2)).toEqual(["AI in Daily Life"]);
    expect(wrapName("An Extremely Long Topic Name That Keeps Going On", 21, 2)).toEqual(["An Extremely Long", "Topic Name That Keep…"]);
  });

  it("narrow: bands stacked top to bottom in the same order, every box inside a 340-wide frame", () => {
    const l = layoutNeighbourhood(AI_DAILY, "narrow");
    expect(l.width).toBe(340);
    const firstY = (k: string) => Math.min(...l.nodes.filter((n) => n.column === k).map((n) => n.y));
    expect(firstY("foundations")).toBeLessThan(firstY("prerequisites"));
    expect(firstY("prerequisites")).toBeLessThan(firstY("lesson"));
    expect(firstY("lesson")).toBeLessThan(firstY("next"));
    for (const n of l.nodes) expect(n.x + n.w).toBeLessThanOrEqual(l.width);
  });

  it("drops an empty band on a phone and keeps an empty column header on a wide screen", () => {
    const lone = { ...AI_DAILY, prerequisites: [], dependents: [], edges: [] };
    expect(layoutNeighbourhood(lone, "narrow").headers.map((h) => h.key)).toEqual(["lesson"]);
    expect(layoutNeighbourhood(lone, "wide").headers).toHaveLength(4);
  });
});

describe("G2c layout: edge styles", () => {
  it("hard is solid and heavier, soft is dashed", () => {
    expect(EDGE_STYLE.hard).toEqual({ width: 1.8, dash: null });
    expect(EDGE_STYLE.soft).toEqual({ width: 1.2, dash: "5 4" });
    const l = layoutNeighbourhood(AI_DAILY, "wide");
    const e = (from: string, to: string) => l.edges.find((x) => x.from === from && x.to === to)!;
    expect(e("mt_WRRv1ABECC", "mt_AzTrT5ySCx")).toMatchObject({ strength: "hard", dash: null });
    expect(e("mt_AzTrT5ySCx", "mt_kH1DzOPsXG")).toMatchObject({ strength: "soft", dash: "5 4" });
    expect(l.edges).toHaveLength(6);
    for (const x of l.edges) expect(x.d).toMatch(/^M[\d.]+,[\d.]+ [CL]/);
  });
  it("H2b: an edge between neighbours in one column is a short straight arrow across their gap, not a gutter loop", () => {
    const l = layoutNeighbourhood(AI_DAILY, "wide");
    const box = new Map(l.nodes.map((b) => [b.id, b]));
    const same = l.edges.filter((x) => box.get(x.from)!.column === box.get(x.to)!.column);
    expect(same.length).toBeGreaterThan(0);
    for (const x of same) {
      const a = box.get(x.from)!, b = box.get(x.to)!;
      const m = x.d.match(/^M([\d.]+),([\d.]+) L([\d.]+),([\d.]+)$/);
      expect(m).not.toBeNull();
      const [x1, y1, x2, y2] = m!.slice(1).map(Number);
      expect(x1).toBe(x2);
      expect(x1).toBeGreaterThan(a.x); expect(x1).toBeLessThan(a.x + a.w);
      // starts on the source's edge and stops just outside the target box
      const [hi, lo] = a.y < b.y ? [a, b] : [b, a];
      expect(Math.min(y1, y2)).toBeGreaterThanOrEqual(hi.y + hi.h);
      expect(Math.max(y1, y2)).toBeLessThanOrEqual(lo.y);
    }
  });

  it("without walked edges (older host) it draws the one-hop rows only", () => {
    const { edges: _drop, ...older } = AI_DAILY;
    const l = layoutNeighbourhood(older, "wide");
    expect(l.edges.map((x) => `${x.from}>${x.to}:${x.strength}`).sort()).toEqual([
      "mt_AzTrT5ySCx>mt_kH1DzOPsXG:soft", "mt_WRRv1ABECC>mt_AzTrT5ySCx:hard", "mt_u6SYiVx7FX>mt_AzTrT5ySCx:soft",
    ]);
  });

  it("names relations in the teacher's words; soft prerequisites read as optional", () => {
    const c = columnsOf(AI_DAILY);
    expect(relationOf(c.prerequisites[0], "prerequisites")).toBe("Hard prerequisite");
    expect(relationOf(c.prerequisites[1], "prerequisites")).toBe("Soft prerequisite (optional)");
    expect(asObjective("Identify at least five examples of AI in their daily life")).toBe("Students can identify at least five examples of AI in their daily life.");
    expect(asObjective("AI tools learn.")).toBe("Students can AI tools learn.");
  });
});

describe("H2b layout on the mt_AzTrT5ySCx neighbourhood: wrap, order, ports", () => {
  const PX = 7; // about 7 px a character at 12 px semibold; the text starts 10 px inside the box
  it("wraps every name inside its wide box: no line wider than the box, nothing clipped", () => {
    const l = layoutNeighbourhood(AI_DAILY, "wide");
    for (const n of l.nodes) {
      for (const line of n.lines) expect(line.length * PX, `${n.node.name}: "${line}"`).toBeLessThanOrEqual(n.w - 20);
      expect(n.lines.join(" ")).toBe(n.node.name);
      expect(20 + (n.lines.length - 1) * 15, "names stay above the ages line").toBeLessThan(n.h - 11 - 10);
    }
    expect(l.nodes.find((n) => n.id === "mt_XbGfVhfiUz")!.lines).toEqual(["Computers in", "Everyday Life"]);
    expect(wrapName("Smart Versus Not-Smart Devices", 17, 3)).toEqual(["Smart Versus", "Not-Smart Devices"]);
  });

  it("orders Foundations by what they lead to, so a reorder removes the crossing", () => {
    const [a, b, c, d] = AI_DAILY.prerequisites;
    const swapped = { ...AI_DAILY, prerequisites: [a, b, d, c] }; // host lists Step-by-Step first: without the reorder, two edges cross
    expect(columnsOf(swapped).foundations.map((n) => n.id)).toEqual(["mt__p5n8z5soJ", "mt_XbGfVhfiUz"]);
    for (const data of [AI_DAILY, swapped]) {
      const l = layoutNeighbourhood(data, "wide");
      const col = (k: string) => l.nodes.filter((n) => n.column === k).sort((a, b) => a.y - b.y).map((n) => n.id);
      const pre = col("prerequisites");
      // Computers in Everyday Life leads to Smart Versus Not-Smart; Step-by-Step leads to Voice Assistants.
      const want = pre[0] === "mt_WRRv1ABECC" ? ["mt_XbGfVhfiUz", "mt__p5n8z5soJ"] : ["mt__p5n8z5soJ", "mt_XbGfVhfiUz"];
      expect(col("foundations")).toEqual(want);
      expect(crossings(l)).toBe(0);
    }
  });

  it("every edge enters its target at its own point", () => {
    for (const o of ["wide", "narrow"] as const) {
      const l = layoutNeighbourhood(AI_DAILY, o);
      const end = (d: string) => d.trim().split(/\s+/).pop()!;
      const byTarget = new Map<string, string[]>();
      for (const e of l.edges) byTarget.set(e.to, [...(byTarget.get(e.to) ?? []), end(e.d)]);
      expect(byTarget.get("mt_AzTrT5ySCx")!.length).toBe(2);
      for (const [, ends] of byTarget) expect(new Set(ends).size).toBe(ends.length);
    }
  });
});
