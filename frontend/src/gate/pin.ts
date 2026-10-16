/**
 * pin.ts — the out-of-band anchor, held on the teacher's device.
 *
 * The ledger problem: a hash chain is self-referential. Anyone who can write the
 * record can also recompute the chain, so `verify()` returns ok on a rewritten
 * history. The fix is not more hashing — it is a reference the writer cannot reach.
 * That is what this module does: at publish, the client copies the version's anchor
 * into ITS OWN store (this browser), and can later compare the host's current
 * account of that version against what it recorded.
 *
 * Local browser storage, deliberately: zero new dependencies, no server-side secret,
 * and the reference sits outside the host's write surface, which is the whole point.
 *
 * Scope, honestly: a pin anchors the SEALED VERSION (the contractual artifact) and
 * the log's length at that moment. It therefore catches a rewritten version record,
 * a deleted version, and a shortened history. A forged event appended AFTER the pin
 * is not covered by that pin — pin again when you seal again.
 */
export interface CourseAnchor {
  courseId: string;
  owner: string;
  title: string;
  version: number;
  versionDigest: string;
  head: string;
  events: number;
}

export interface CoursePin extends CourseAnchor {
  pinnedAt: number;
}

export type PinStatus = "ok" | "advanced" | "changed" | "missing";

export interface PinComparison {
  status: PinStatus;
  detail: string;
}

const PREFIX = "silicus.pin.";

const pinKey = (courseId: string, version: number) => `${PREFIX}${courseId}.${version}`;

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Record the anchor for a sealed version on this device. */
export function pinVersion(anchor: CourseAnchor, now = Date.now()): CoursePin | null {
  const s = store();
  if (!s) return null;
  const pin: CoursePin = { ...anchor, pinnedAt: now };
  try {
    s.setItem(pinKey(anchor.courseId, anchor.version), JSON.stringify(pin));
  } catch {
    return null;
  }
  return pin;
}

/** Every pin this device holds for a course, oldest version first. */
export function listPins(courseId: string): CoursePin[] {
  const s = store();
  if (!s) return [];
  const pins: CoursePin[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const k = s.key(i);
    if (!k || !k.startsWith(`${PREFIX}${courseId}.`)) continue;
    const raw = s.getItem(k);
    if (!raw) continue;
    try {
      pins.push(JSON.parse(raw) as CoursePin);
    } catch {
      /* a corrupt pin is not evidence; skip it */
    }
  }
  return pins.sort((a, b) => a.version - b.version);
}

/**
 * Compare a pinned copy against the host's current account of that version.
 * `advanced` is not a failure: the record legitimately grows as work continues.
 */
export function comparePin(pin: CoursePin, current: CourseAnchor | null): PinComparison {
  if (!current) {
    return { status: "missing", detail: `version ${pin.version} is no longer in the record` };
  }
  if (current.versionDigest !== pin.versionDigest) {
    return {
      status: "changed",
      detail: `the published record for version ${pin.version} differs from what you pinned`,
    };
  }
  if (current.events < pin.events) {
    return {
      status: "changed",
      detail: `the record is SHORTER than when you pinned (${current.events} vs ${pin.events} events — history was removed)`,
    };
  }
  if (current.events > pin.events || current.head !== pin.head) {
    return {
      status: "advanced",
      detail: `the record has grown since you pinned (${pin.events} to ${current.events} events) — expected if you have worked since`,
    };
  }
  return { status: "ok", detail: `version ${pin.version} is exactly as you published it` };
}
