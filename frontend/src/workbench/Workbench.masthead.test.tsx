/**
 * Workbench.masthead.test.tsx — D9. The local app's course page is the product, not the design workbench:
 * it gets the same masthead as the online app, and the workbench stays one quiet footer link away.
 * (Workbench.test.tsx keeps pinning the default tab and the workbench tabs; this file never edits it.)
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Workbench from "./Workbench";

const ok = (o: unknown) => ({ ok: true, status: 200, json: async () => o }) as unknown as Response;

beforeEach(() => {
  window.localStorage.setItem("silicus.tour.seen", "1");
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === "/api/courses") return ok({ courses: [] });
    if (url === "/api/worker/status") return ok({ configured: false });
    if (url === "/api/asfai/status") return ok({ connected: false, expiresAt: null, scope: null, canRefresh: false });
    return ok({});
  }));
  window.location.hash = "#/live";
});
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); window.location.hash = ""; });

describe("D9: the local app's course page wears the product masthead", () => {
  it("has no developer header and no six workbench tabs on the course page", async () => {
    render(<Workbench />);
    await screen.findByLabelText("What should we call this course?");
    expect(screen.queryByText(/design workbench/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tokens-first/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Workbench sections" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Silicus TA, home" })).toBeInTheDocument();
    expect(screen.getByText("The AI proposes. You decide.")).toBeInTheDocument();
  });

  it("keeps the workbench one quiet footer link away, and the hash routes still work", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await screen.findByLabelText("What should we call this course?");
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Design system" })).toHaveAttribute("href", "#/decision");
    await user.click(within(footer).getByRole("link", { name: "Design system" }));
    expect(screen.getByRole("navigation", { name: "Workbench sections" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Learning objectives" })).toBeInTheDocument();
  });

  it("the footer tells the truth about where the record is kept: this computer, not 'this browser'", async () => {
    render(<Workbench />);
    await screen.findByLabelText("What should we call this course?");
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent(/Your record stays on this computer/);
    expect(footer).not.toHaveTextContent(/in this browser/);
  });
});
