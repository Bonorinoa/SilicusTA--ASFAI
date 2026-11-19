/**
 * K5: the studio's "Check my pinned copies" is the app's pin check. These tests fail if the action stops calling
 * gate/pin.ts comparePin (the rule), or stops telling the teacher the plain verdict.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseAnchor } from "../gate/pin";

const anchorMock = vi.fn();
const archiveMock = vi.fn();
vi.mock("../gate/transport", () => ({
  host: {
    anchor: (...a: unknown[]) => anchorMock(...a),
    archiveCourse: (...a: unknown[]) => archiveMock(...a),
  },
}));
vi.mock("../gate/pin", async (importOriginal) => {
  const real = await importOriginal<typeof import("../gate/pin")>();
  return { ...real, comparePin: vi.fn(real.comparePin) };
});

import { comparePin, pinVersion } from "../gate/pin";
import { PIN_DIFFERS, PIN_MATCHES, RecordCard, checkPinnedCopies } from "./RecordCard";

const ID = "urn:uuid:k5";
const A1: CourseAnchor = { courseId: ID, owner: "Ada", title: "AI literacy", version: 1, versionDigest: "d1".repeat(32), head: "h1", events: 12 };
const A2: CourseAnchor = { ...A1, version: 2, versionDigest: "d2".repeat(32), head: "h2", events: 20 };

beforeEach(() => {
  localStorage.clear();
  anchorMock.mockReset();
  archiveMock.mockReset();
  vi.mocked(comparePin).mockClear();
  pinVersion(A1);
  pinVersion(A2);
});
afterEach(() => localStorage.clear());

describe("Check my pinned copies (K5)", () => {
  it("calls comparePin once per pin on this device, with the host's anchor", async () => {
    anchorMock.mockImplementation(async (_id: string, v: number) => ({ anchor: v === 1 ? A1 : A2 }));
    const out = await checkPinnedCopies(ID);
    expect(vi.mocked(comparePin)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(comparePin).mock.calls[0][1]).toEqual(A1);
    expect(out.map((x) => x.verdict)).toEqual([PIN_MATCHES, PIN_MATCHES]);
  });

  it("the button drives comparePin and shows 'Differs from the record' for a rewritten version", async () => {
    // Version 1 was rewritten consistently: same version number, a different digest. Version 2 grew: still a match.
    anchorMock.mockImplementation(async (_id: string, v: number) => ({
      anchor: v === 1 ? { ...A1, versionDigest: "ff".repeat(32) } : { ...A2, events: 25, head: "h3" },
    }));
    render(<RecordCard courseId={ID} versions={[]} busy={false} />);
    expect(screen.getAllByText("Not checked yet")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Check my pinned copies" }));
    await waitFor(() => expect(screen.getByText(PIN_DIFFERS)).toBeInTheDocument());
    expect(screen.getByText(PIN_MATCHES)).toBeInTheDocument();
    expect(vi.mocked(comparePin)).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/A pinned copy does not match/)).toBeInTheDocument();
  });

  it("a version missing from the record differs too", async () => {
    anchorMock.mockImplementation(async (_id: string, v: number) => ({ anchor: v === 1 ? null : A2 }));
    const out = await checkPinnedCopies(ID);
    expect(out[0]).toMatchObject({ version: 1, status: "missing", verdict: PIN_DIFFERS });
  });

  it("with no pins on this device, says so and offers nothing to check", () => {
    localStorage.clear();
    render(<RecordCard courseId={ID} versions={[]} busy={false} />);
    expect(screen.getByText(/No pinned copies on this device/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check my pinned copies" })).toBeDisabled();
  });
});

describe("Archive a verified copy (K5, Node host)", () => {
  it("shows the read-back digest", async () => {
    archiveMock.mockResolvedValue({ saved: true, verified: true, ref: "r1", digest: "abcdef0123456789abcdef" });
    render(<RecordCard courseId={ID} versions={[]} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive a verified copy" }));
    await waitFor(() => expect(screen.getByText("Archived and read back, digest abcdef0123456789…")).toBeInTheDocument());
    expect(archiveMock).toHaveBeenCalledWith(ID);
  });

  it("says plainly when the read-back does not verify", async () => {
    archiveMock.mockResolvedValue({ saved: true, verified: false, ref: "r1", digest: "x" });
    render(<RecordCard courseId={ID} versions={[]} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive a verified copy" }));
    await waitFor(() => expect(screen.getByText(/did not read back the same/)).toBeInTheDocument());
  });
});
