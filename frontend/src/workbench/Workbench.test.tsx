/**
 * Workbench.test.tsx — the workbench is the acceptance surface: DecisionCard
 * and PlanCard visible and interactive on real gate state.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Workbench from "./Workbench";

/** The bare URL shows the landing (product decision, C-d). These tests are about the workbench, so they open its hash. */
const ok = (o: unknown) => ({ ok: true, status: 200, json: async () => o }) as unknown as Response;
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); window.location.hash = ""; });

describe("the bare URL and #/live", () => {
  beforeEach(() => {
    window.localStorage.setItem("silicus.tour.seen", "1");
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/courses") return ok({ courses: [] });
      if (url === "/api/worker/status") return ok({ configured: false });
      if (url === "/api/asfai/status") return ok({ connected: false, expiresAt: null, scope: null, canRefresh: false });
      return ok({});
    }));
  });

  it("no hash at all, '#' and '#/' show the landing", () => {
    for (const hash of ["", "#", "#/"]) {
      window.location.hash = hash;
      const { unmount } = render(<Workbench />);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Plan a lesson/);
      expect(screen.queryByRole("heading", { name: "Learning objectives" })).toBeNull();
      unmount();
    }
  });

  it("#/live still opens the app (the course), with the wordmark linking back to the landing", async () => {
    window.location.hash = "#/live";
    render(<Workbench />);
    await screen.findByLabelText("What should we call this course?");
    expect(screen.queryByText(/^Plan a lesson/)).toBeNull();
    expect(screen.getByRole("link", { name: "Silicus TA, home" })).toHaveAttribute("href", "#/");
  });

  it("an unknown hash does not show the landing", () => {
    window.location.hash = "#/nope";
    render(<Workbench />);
    expect(screen.queryByText(/^Plan a lesson/)).toBeNull();
  });
});

describe("workbench gallery route", () => {
  beforeEach(() => { window.location.hash = "#/decision"; });

  it("shows DecisionCard live against the real gate, and it is interactive", async () => {
    const user = userEvent.setup();
    render(<Workbench />);

    expect(screen.getByRole("heading", { name: "Learning objectives" })).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Objective proposals" });
    expect(within(card).getByText(/Nothing decided yet — 0 of \d+\./)).toBeInTheDocument();

    const statement =
      "Students can explain what an algorithm is, in their own words, with an example from everyday life.";
    const row = screen.getByRole("heading", { name: statement }).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /^accept objective/i }));

    expect(within(row).getByText("Accepted")).toBeInTheDocument();
    // the gate panel reflects real gate state (checkpoint opens, decision recorded)
    expect(screen.getByText(/Teacher decisions \(1\)/)).toBeInTheDocument();
  });

  it("shows PlanCard on its tab, set as a printable page", async () => {
    const user = userEvent.setup();
    render(<Workbench />);

    await user.click(screen.getByRole("link", { name: "Plan card" }));
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Seeing the claim: how AI answers are built",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Asking the assistant a question is not evidence."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print this lesson plan" })).toBeInTheDocument();
  });

  it("demonstrates the review flow (D): a dropped citation invalidates the plan, and re-confirm is explicit", async () => {
    const user = userEvent.setup();
    render(<Workbench />);

    await user.click(screen.getByRole("link", { name: "Plan card" }));
    expect(screen.queryByText(/why this plan is invalidated/i)).not.toBeInTheDocument();

    // Drop a cited objective via the demo select — the gate invalidates the plan.
    const select = screen.getByRole("combobox", { name: /demonstrate invalidation/i });
    const options = within(select).getAllByRole("option");
    await user.selectOptions(select, (options[1] as HTMLOptionElement).value);

    // The plan card states the WHO/WHY: what was dropped, and where it was cited.
    expect(screen.getByText(/why this plan is invalidated/i)).toBeInTheDocument();
    expect(screen.getByText(/was dropped, but this plan still cites it/i)).toBeInTheDocument();
    expect(screen.getByText("Invalidated — needs re-confirmation")).toBeInTheDocument();
    // Publish is blocked while a cited objective is unconfirmed — the gate says so.
    expect(screen.getByText(/re-confirm plan/i)).toBeInTheDocument();

    // Not one tap (A1): the confirm step quotes the reason and defaults to "Not yet".
    await user.click(screen.getByRole("button", { name: "Re-confirm plan" }));
    expect(screen.getByRole("button", { name: /not yet/i })).toHaveFocus();
    expect(screen.getByText(/re-confirm this plan exactly as it reads/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Re-confirm plan" }));
    // Re-confirmed: the invalidation notice is gone and the sheet reads Confirmed.
    expect(screen.queryByText(/why this plan is invalidated/i)).not.toBeInTheDocument();
    expect(screen.getByText("Confirmed by R. Okonkwo")).toBeInTheDocument();
  });

  it("shows the token sheet", async () => {
    const user = userEvent.setup();
    render(<Workbench />);

    await user.click(screen.getByRole("link", { name: "Tokens" }));
    expect(screen.getByText("color-ink")).toBeInTheDocument();
    expect(screen.getByText("Learning objectives")).toBeInTheDocument(); // type specimen
  });
});
