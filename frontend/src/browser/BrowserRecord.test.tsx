/**
 * BrowserRecord.test.tsx — the record band's counts read in words (F8).
 *
 * The band is the one standing notice of the online app: this browser keeps the
 * record. Its export and import receipts count courses; the wording must be
 * singular for one ("Exported 1 course") and plural for none ("0 courses").
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportAll: vi.fn(),
  importAll: vi.fn(),
  deleteAll: vi.fn(),
}));
vi.mock("./browserHost", () => ({
  browserHost: async () => ({
    exportAll: mocks.exportAll,
    importAll: mocks.importAll,
    deleteAll: mocks.deleteAll,
    dump: async () => ({}),
  }),
}));

// eslint-disable-next-line import/first
import { BrowserRecord } from "./BrowserRecord";

const mount = () => {
  const onStatus = vi.fn();
  render(<BrowserRecord hasCourses status={null} onChanged={() => {}} onStatus={onStatus} />);
  return onStatus;
};

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("BrowserRecord counts courses in words", () => {
  it("says 'Exported 1 course' for a single course, never '1 courses'", async () => {
    mocks.exportAll.mockResolvedValueOnce({ text: "{}", filename: "silicus-courses-2026-10-15.json", included: ["urn:uuid:1"], skipped: [] });
    const onStatus = mount();
    fireEvent.click(screen.getByRole("button", { name: "Export all courses" }));
    await waitFor(() =>
      expect(onStatus).toHaveBeenCalledWith({ tone: "ok", text: "Exported 1 course to silicus-courses-2026-10-15.json." }),
    );
  });

  it("says 'Exported 0 courses' when there is nothing to export — the zero case is plural", async () => {
    mocks.exportAll.mockResolvedValueOnce({ text: "{}", filename: "empty.json", included: [], skipped: [] });
    const onStatus = mount();
    fireEvent.click(screen.getByRole("button", { name: "Export all courses" }));
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith({ tone: "ok", text: "Exported 0 courses to empty.json." }));
  });

  it("says 'Imported 1 course' for a single imported course, never '1 courses'", async () => {
    mocks.importAll.mockResolvedValueOnce({ imported: ["urn:uuid:1"], alreadyHere: [] });
    const onStatus = mount();
    const input = screen.getByLabelText("Import courses from an exported file");
    Object.defineProperty(input, "files", { value: [{ text: async () => "{}" }], configurable: true });
    fireEvent.change(input);
    await waitFor(() =>
      expect(onStatus).toHaveBeenCalledWith({
        tone: "ok",
        text: "Imported 1 course. Every record was checked against its own fingerprints before it was kept.",
      }),
    );
  });
});
