/**
 * OnboardingChat.test.tsx — the first-run intake says plainly what it wants, splits the
 * two material steps in words, and shows where you are without pretending to measure progress.
 *
 * The honesty properties are under test too: "not saved yet" and "not sent to ASFAI" survive the
 * plain-language pass (the browser-mode rewrite of those lines is exercised by the browser smoke).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OnboardingChat } from "./OnboardingChat";
import { MaterialsPanel } from "./MaterialsPanel";

function renderIntake() {
  const noop = vi.fn();
  return render(
    <OnboardingChat
      view={null}
      asfai={null}
      busy={false}
      onCreate={noop}
      onConfirmFiles={noop}
      onAsk={noop}
      onAnswer={noop}
      onSendToAsfai={noop}
      onConnect={noop}
      onRefresh={noop}
    />,
  );
}

const advanceTitle = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/what should we call this course/i), "Seeing the claim");
  await user.click(screen.getByRole("button", { name: /record the course title/i }));
};

describe("the first-run intake — plain words, no fake progress", () => {
  it("asks for the teacher's own name in plain words, not record language", async () => {
    const user = userEvent.setup();
    renderIntake();
    await advanceTitle(user);

    // The jargon question is gone.
    expect(screen.queryByText(/label should your copy of this record carry/i)).not.toBeInTheDocument();
    expect(await screen.findByLabelText(/what name should this course show for you/i)).toBeInTheDocument();
    // ...and the honesty is kept.
    expect(screen.getAllByText(/not sent to ASFAI/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/not saved yet/i)).toBeInTheDocument();
  });

  it("names what the course is built from, and says the material itself comes later", async () => {
    const user = userEvent.setup();
    renderIntake();
    await advanceTitle(user);
    await user.type(screen.getByLabelText(/what name should this course show for you/i), "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: /record this name/i }));

    expect(await screen.findByLabelText(/what is this course built from/i)).toBeInTheDocument();
    // Choosing "No materials" is offered right here, as the opening copy promises.
    expect(screen.getByRole("button", { name: /no materials/i })).toBeInTheDocument();
    // The hint says where names go and where the file text stays (the file paragraph below says the same, so pin the hint's own wording).
    await user.type(screen.getByLabelText(/what is this course built from/i), "Lesson notes");
    expect(screen.getByText(/the text of a file stays in this tab/i)).toBeInTheDocument();
  });

  it("shows where you are and what is left, with no progress bar, no meter, no percent", () => {
    const { container } = renderIntake();

    const rail = screen.getByRole("list", { name: /naming the course/i });
    expect(within(rail).getAllByRole("listitem")).toHaveLength(3);
    // The sequence that follows is named, so the teacher can see how much is left.
    expect(screen.getByText(/after this: the material list/i)).toBeInTheDocument();

    expect(container.querySelector("progress, [role='progressbar'], meter")).toBeNull();
    expect(container.textContent).not.toMatch(/%/);
  });
});

describe("the material panel — the second half of the material story", () => {
  it("asks for the material itself, in its own words, and flags YouTube for the local app", () => {
    render(<MaterialsPanel busy={false} zdr={false} youtube={false} onPropose={vi.fn()} />);
    expect(screen.getByText(/add your material here/i)).toBeInTheDocument();
    expect(screen.getByText(/YouTube: local app only/i)).toBeInTheDocument();
  });
});
