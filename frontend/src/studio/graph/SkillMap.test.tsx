/**
 * SkillMap.test.tsx — G2c: the pre-fill sends nothing; the view is keyboard-focusable and shows evidence
 * without hover; the strip marks hard vs optional; every surface carries the Marble credit.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { host, type HostView } from "../../gate/transport";
import type { StepProps } from "../CourseStudio";
import { ObjectivesStep } from "../steps/ObjectivesStep";
import { AI_DAILY } from "./fixture";
import { _resetNeighbourhoodCache, NeighbourhoodView, PrereqStrip } from "./SkillMap";

const ID = "urn:uuid:11111111-2222-3333-4444-555555555555";
function view(anchor?: string): HostView {
  return {
    courseId: ID, objectivesMode: "explicit", proposals: [], objectives: [], versions: [], plan: null,
    course: { courseId: ID, owner: "Ada", title: "AI around us", description: "", materials: [], createdAt: 1, ...(anchor ? { marbleAnchor: anchor, ages: { min: 5, max: 12 } } : {}) },
    checkpoints: { objectives: { id: "objectives", status: "pending", provenance: null, note: null } },
    intake: { answers: {} },
  } as unknown as HostView;
}
const makeC = () => ({
  view: null, missing: false, busy: false, notice: null, problem: null, setNotice: vi.fn(), waiting: null, sources: [], setSources: vi.fn(), reload: vi.fn(),
  actions: { proposeFromAnswers: vi.fn(), proposeFromSources: vi.fn(), suggestMore: vi.fn(), decide: vi.fn(), confirmObjectives: vi.fn() },
}) as unknown as StepProps["c"];

afterEach(() => { vi.restoreAllMocks(); _resetNeighbourhoodCache(); });

describe("G2c pre-fill: a suggestion fills the teacher's own field and sends nothing", () => {
  it("a click changes the field; the record gains nothing until the teacher submits; then it is an ordinary add", async () => {
    const spy = vi.spyOn(host, "marbleNeighbourhood").mockResolvedValue(AI_DAILY);
    const c = makeC();
    render(<ObjectivesStep c={c} view={view("mt_AzTrT5ySCx")} worker={{ configured: true }} looking={false} onLook={vi.fn()} links={[]} />);
    const panel = await screen.findByRole("region", { name: "Wording from the skill map" });
    expect(spy).toHaveBeenCalledWith("mt_AzTrT5ySCx");
    const input = screen.getByLabelText("Write your own") as HTMLInputElement;
    expect(input.value).toBe("");

    await userEvent.click(within(panel).getAllByRole("button", { name: "Use as my objective" })[0]);
    expect(input.value).toBe("Students can identify at least five examples of AI in their daily life.");
    expect(document.activeElement).toBe(input);
    expect(c.actions.decide).not.toHaveBeenCalled();
    expect(c.actions.confirmObjectives).not.toHaveBeenCalled();

    await userEvent.type(input, " Name two at home.");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    // Exactly the existing write-your-own intent: a statement, no Marble id, no provenance from the client.
    expect(c.actions.decide).toHaveBeenCalledTimes(1);
    expect(c.actions.decide).toHaveBeenCalledWith({ verb: "add", statement: "Students can identify at least five examples of AI in their daily life. Name two at home." });
    expect(JSON.stringify((c.actions.decide as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("mt_");
    // H2a: one credit per surface — none under the suggestions; the one credit sits under the neighbourhood view.
    expect(panel.querySelector("[data-marble-credit]")).toBeNull();
    expect(document.querySelectorAll("[data-marble-credit]")).toHaveLength(1);
    expect(document.querySelector("[data-neighbourhood] [data-marble-credit]")).not.toBeNull();
  });

  it("a course without an anchor looks exactly as before: no fetch, no skill-map surfaces", () => {
    const spy = vi.spyOn(host, "marbleNeighbourhood");
    render(<ObjectivesStep c={makeC()} view={view()} worker={{ configured: true }} looking={false} onLook={vi.fn()} links={[]} />);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByText("Wording from the skill map")).toBeNull();
    expect(document.querySelector("[data-neighbourhood]")).toBeNull();
  });
});

describe("G2c (PM binding): the existing suggested-alignment strip carries the Marble credit", () => {
  it("a waiting proposal with a suggested match shows the one credit line in the tray; none without", () => {
    const aligned = { id: "urn:uuid:00000000-0000-0000-0000-000000000901", kind: "local", status: "proposed", statement: "Spot AI at home", originalStatement: null, source: "notes", by: "ai",
      alignment: { publicId: "mt_AzTrT5ySCx", relationship: "closeMatch", suggested: true } };
    const v = { ...view(), proposals: [aligned] } as unknown as HostView;
    const { unmount } = render(<ObjectivesStep c={makeC()} view={v} worker={{ configured: true }} looking={false} onLook={vi.fn()} links={[]} />);
    const tray = screen.getByRole("complementary", { name: "Proposals" });
    expect(tray.textContent).toContain("suggested match mt_AzTrT5ySCx");
    expect(tray.querySelector("[data-marble-credit]")).not.toBeNull();
    unmount();
    const plain = { ...view(), proposals: [{ ...aligned, alignment: null }] } as unknown as HostView;
    render(<ObjectivesStep c={makeC()} view={plain} worker={{ configured: true }} looking={false} onLook={vi.fn()} links={[]} />);
    expect(screen.getByRole("complementary", { name: "Proposals" }).querySelector("[data-marble-credit]")).toBeNull();
  });
});

describe("G2c neighbourhood view", () => {
  it("H2a: a box's tooltip is the topic name and its ages, never a raw mt_ id", () => {
    render(<NeighbourhoodView data={AI_DAILY} defaultOpen />);
    const titles = [...document.querySelectorAll("[data-neighbourhood] g[role=button] > title")].map((t) => t.textContent ?? "");
    expect(titles).toHaveLength(6);
    titles.forEach((t) => {
      expect(t).not.toMatch(/mt_/);
      expect(t).toMatch(/^.+\. .*\d.*\.$/); // "<name>. <ages>."
    });
    expect(titles.find((t) => t.startsWith("AI in Daily Life. "))).toMatch(/12/);
  });

  it("every box is focusable; focus (not hover) shows its evidence lines; the credit is there", async () => {
    render(<NeighbourhoodView data={AI_DAILY} defaultOpen />);
    const boxes = document.querySelectorAll("g[role=button]");
    expect(boxes).toHaveLength(6);
    boxes.forEach((b) => expect(b.getAttribute("tabindex")).toBe("0"));
    const ev = screen.getByRole("region", { name: "Evidence lines" });
    expect(ev.getAttribute("data-evidence-for")).toBe("mt_AzTrT5ySCx");
    await userEvent.tab(); // summary
    await userEvent.tab(); // first box
    await waitFor(() => expect(ev.getAttribute("data-evidence-for")).not.toBe("mt_AzTrT5ySCx"));
    const smart = document.querySelector("[data-node-id=mt_WRRv1ABECC]") as SVGGElement;
    act(() => smart.focus());
    expect(ev.getAttribute("data-evidence-for")).toBe("mt_WRRv1ABECC");
    expect(within(ev).getByText("Hard prerequisite · ages 5–8")).toBeInTheDocument();
    expect(within(ev).getByText("Smart Versus Not-Smart Devices evidence")).toBeInTheDocument();
    expect(document.querySelector("[data-edge='mt_AzTrT5ySCx>mt_kH1DzOPsXG']")?.getAttribute("stroke-dasharray")).toBe("5 4");
    expect(document.querySelector("[data-edge='mt_WRRv1ABECC>mt_AzTrT5ySCx']")?.getAttribute("stroke-dasharray")).toBeNull();
    expect(document.querySelector("[data-neighbourhood] [data-marble-credit]")).not.toBeNull();
  });

  it("the prerequisite strip names the hard prerequisite and marks the soft one optional, with the credit", () => {
    render(<PrereqStrip data={AI_DAILY} />);
    const strip = screen.getByRole("region", { name: "Before this lesson" });
    expect(strip.textContent).toContain("Before this, learners need: Smart Versus Not-Smart Devices (hard prerequisite)");
    expect(strip.querySelector("[data-marble-id=mt_WRRv1ABECC]")?.getAttribute("data-strength")).toBe("hard");
    expect(strip.querySelector("[data-marble-id=mt_u6SYiVx7FX]")?.textContent).toContain("(optional)");
    expect(strip.querySelector("[data-marble-id=mt_XbGfVhfiUz]")).toBeNull(); // two hops back: in the view, not the strip
    expect(strip.querySelector("[data-marble-credit]")).not.toBeNull();
  });
});

describe("H2a empty state: a course whose ages have no skill-map topics", () => {
  const unanchored = (min: number, max: number) => {
    const v = view();
    return { ...v, course: { ...v.course, ages: { min, max } } } as unknown as HostView;
  };
  it("ages 19–22 with no coverage: one quiet line under the teacher's own field", async () => {
    const spy = vi.spyOn(host, "marbleCoverage").mockResolvedValue({ query: { min: 19, max: 22 }, overlapping: 0, perAge: [] });
    render(<ObjectivesStep c={makeC()} view={unanchored(19, 22)} worker={{ configured: true }} looking={false} onLook={vi.fn()} links={[]} />);
    expect(await screen.findByText("No skill-map topics for these ages. Write your own objectives.")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(19, 22);
    expect(document.querySelectorAll("[data-no-skill-map-topics]")).toHaveLength(1);
  });
  it("ages with coverage, an anchored course, or a course without ages: no line", async () => {
    const spy = vi.spyOn(host, "marbleCoverage").mockResolvedValue({ query: { min: 5, max: 12 }, overlapping: 40, perAge: [] });
    const { unmount } = render(<ObjectivesStep c={makeC()} view={unanchored(5, 12)} worker={{ configured: true }} looking={false} onLook={vi.fn()} links={[]} />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector("[data-no-skill-map-topics]")).toBeNull();
    unmount();
    spy.mockClear();
    vi.spyOn(host, "marbleNeighbourhood").mockResolvedValue(AI_DAILY);
    const u2 = render(<ObjectivesStep c={makeC()} view={view("mt_AzTrT5ySCx")} worker={{ configured: true }} looking={false} onLook={vi.fn()} links={[]} />);
    u2.unmount();
    render(<ObjectivesStep c={makeC()} view={view()} worker={{ configured: true }} looking={false} onLook={vi.fn()} links={[]} />);
    expect(spy).not.toHaveBeenCalled();
    expect(document.querySelector("[data-no-skill-map-topics]")).toBeNull();
  });
});
