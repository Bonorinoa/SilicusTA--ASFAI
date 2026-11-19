// K4 (B2): the shared top bar carries the landing link once, whatever a screen passes on its right.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TopBar } from "./StudioApp";

describe("TopBar landing link", () => {
  it("has exactly one 'About Silicus' link to #/, with no props", () => {
    render(<TopBar />);
    const links = screen.getAllByRole("link", { name: "About Silicus" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "#/");
  });
  it("keeps it beside crumbs and a screen's own right-hand content; the wordmark stays on the studio home", () => {
    render(<TopBar crumbs={[{ label: "Courses", href: "#/studio" }, { label: "Plants" }]} right={<button>Publish</button>} />);
    expect(screen.getByRole("link", { name: "About Silicus" })).toHaveAttribute("href", "#/");
    expect(screen.getByRole("link", { name: "Silicus, your courses" })).toHaveAttribute("href", "#/studio");
  });
});
