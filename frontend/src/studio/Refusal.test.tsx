/** Refusal.test.tsx — R5 on screen: three plain parts up front, the host's own words behind a closed Details. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HostError } from "../gate/transport";
import { REFUSALS, explainRefusal } from "../lib/refusals";
import { Refusal } from "./Refusal";

describe("Refusal", () => {
  it("shows what happened, what was saved and the next step; the host's message waits in a closed Details", () => {
    render(<Refusal problem={explainRefusal(new HostError("the worker's message was not JSON", "WORKER_BAD_OUTPUT"), "propose")} />);
    expect(screen.getByText(REFUSALS.WORKER_BAD_OUTPUT.what)).toBeVisible();
    expect(screen.getByText(REFUSALS.WORKER_BAD_OUTPUT.saved)).toBeVisible();
    expect(screen.getByText(REFUSALS.WORKER_BAD_OUTPUT.next)).toBeVisible();
    const details = screen.getByText("Details").closest("details")!;
    expect(details.open).toBe(false);
    expect(details).toHaveTextContent("The worker's message was not JSON.");
    expect(document.body.textContent).not.toMatch(/WORKER_BAD_OUTPUT/);
  });
});
