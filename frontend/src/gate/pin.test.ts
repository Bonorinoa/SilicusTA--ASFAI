/**
 * pin.test.ts — the out-of-band anchor on the teacher's device.
 *
 * These are the comparisons that make the pin worth holding: a rewritten version
 * record, a removed version, and a shortened history must all be visible to the
 * pin holder even though the host's own chain check would pass.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { comparePin, listPins, pinVersion, type CourseAnchor, type CoursePin } from "./pin";

const COURSE = "urn:uuid:11111111-2222-3333-4444-555555555555";

const anchor = (over: Partial<CourseAnchor> = {}): CourseAnchor => ({
  courseId: COURSE,
  owner: "teacher:tk-1",
  title: "AI literacy",
  version: 1,
  versionDigest: "aaa111",
  head: "head-1",
  events: 11,
  ...over,
});

beforeEach(() => localStorage.clear());

describe("pinning a sealed version", () => {
  it("stores the anchor on this device and lists it back", () => {
    const pin = pinVersion(anchor(), 1_000);
    expect(pin).toMatchObject({ version: 1, versionDigest: "aaa111", pinnedAt: 1_000 });
    const held = listPins(COURSE);
    expect(held).toHaveLength(1);
    expect(held[0].head).toBe("head-1");
  });

  it("keeps pins per course and orders them by version", () => {
    pinVersion(anchor({ version: 2, versionDigest: "bbb222" }));
    pinVersion(anchor({ version: 1 }));
    pinVersion(anchor({ courseId: "urn:uuid:other", version: 9 }));
    expect(listPins(COURSE).map((p) => p.version)).toEqual([1, 2]);
    expect(listPins("urn:uuid:other")).toHaveLength(1);
  });

  it("overwrites the pin when the same version is sealed again", () => {
    pinVersion(anchor({ versionDigest: "first" }));
    pinVersion(anchor({ versionDigest: "second" }));
    expect(listPins(COURSE)).toHaveLength(1);
    expect(listPins(COURSE)[0].versionDigest).toBe("second");
  });
});

describe("comparing a pin against the host's current account", () => {
  const pin = (over: Partial<CoursePin> = {}): CoursePin => ({ ...anchor(), pinnedAt: 1_000, ...over });

  it("ok: the version is exactly as sealed", () => {
    expect(comparePin(pin(), anchor()).status).toBe("ok");
  });

  it("changed: the sealed record differs from what was pinned", () => {
    const cmp = comparePin(pin(), anchor({ versionDigest: "rewritten" }));
    expect(cmp.status).toBe("changed");
    expect(cmp.detail).toMatch(/differs from what you pinned/);
  });

  it("changed: the history is SHORTER than when pinned (events removed)", () => {
    const cmp = comparePin(pin(), anchor({ events: 5, head: "short" }));
    expect(cmp.status).toBe("changed");
    expect(cmp.detail).toMatch(/SHORTER/);
  });

  it("missing: the version is gone from the record entirely", () => {
    const cmp = comparePin(pin(), null);
    expect(cmp.status).toBe("missing");
  });

  it("advanced: the record legitimately grew after the pin", () => {
    const cmp = comparePin(pin(), anchor({ events: 14, head: "head-2" }));
    expect(cmp.status).toBe("advanced");
    expect(cmp.detail).toMatch(/grown since you pinned/);
  });
});
