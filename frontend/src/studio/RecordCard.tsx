/**
 * RecordCard — "Your record", on the Publish step once a version exists (K5).
 *
 * Brings back, in the studio's look, what only the classic view could do (docs/verification/2026-11-18-classic-parity.md):
 *   - the pinned copies on this device and "Check my pinned copies" (gate/pin.ts comparePin). The pin is the only
 *     defence against a rewrite that is consistent with itself (STATUS §2 item 7): the record's own check cannot see one.
 *   - "Archive a verified copy" (Node host only, as before): an atomic write that is read back and its digest shown.
 *   - the comparison of two published versions (VersionCompare, pure and read-only).
 * Nothing here writes to the course record. Checking pins and comparing versions only read.
 */
import { useState } from "react";
import { comparePin, listPins, type CoursePin, type PinStatus } from "../gate/pin";
import { BROWSER_MODE } from "../gate/mode";
import { host } from "../gate/transport";
import type { PackageVersionView } from "../gate/types";
import { explainRefusal } from "../lib/refusals";
import { Button } from "./ui";
import { VersionCompare } from "./VersionCompare";
import s from "./Studio.module.css";
import r from "./RecordCard.module.css";

export interface PinResult {
  version: number;
  status: PinStatus | "error";
  /** The plain verdict the teacher reads first. */
  verdict: string;
  /** comparePin's own detail, or why the check could not run. */
  detail: string;
}

export const PIN_MATCHES = "Matches the record";
export const PIN_DIFFERS = "Differs from the record: the record may have been changed";

/** The app's pin check: every pin this device holds for the course, compared by comparePin with the host's anchor. */
export async function checkPinnedCopies(courseId: string): Promise<PinResult[]> {
  const out: PinResult[] = [];
  for (const pin of listPins(courseId)) {
    try {
      const { anchor } = await host.anchor(courseId, pin.version);
      const cmp = comparePin(pin, anchor);
      const fine = cmp.status === "ok" || cmp.status === "advanced";
      out.push({ version: pin.version, status: cmp.status, verdict: fine ? PIN_MATCHES : PIN_DIFFERS, detail: cmp.detail });
    } catch (e) {
      const x = explainRefusal(e, "check");
      out.push({ version: pin.version, status: "error", verdict: "Could not be checked", detail: `${x.what} ${x.next}` });
    }
  }
  return out;
}

export function RecordCard({ courseId, versions, busy }: { courseId: string; versions: readonly PackageVersionView[]; busy: boolean }) {
  const [pins, setPins] = useState<CoursePin[]>(() => listPins(courseId));
  const [results, setResults] = useState<PinResult[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [archive, setArchive] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      setPins(listPins(courseId));
      setResults(await checkPinnedCopies(courseId));
    } finally { setChecking(false); }
  };

  const archiveNow = async () => {
    setArchiving(true);
    try {
      const a = await host.archiveCourse(courseId);
      setArchive(a.verified
        ? `Archived and read back, digest ${String(a.digest).slice(0, 16)}…`
        : "The archive did not read back the same. Do not rely on it.");
    } catch (e) {
      const x = explainRefusal(e, "check");
      setArchive(`The archive failed. ${x.what} ${x.next}`);
    } finally { setArchiving(false); }
  };

  return (
    <section className={s.card} aria-label="Your record">
      <h2 className={s.cardTitle}>Your record</h2>

      <div className={r.block}>
        <h3 className={r.head}>Pinned copies on this device</h3>
        <p className={s.trustText}>
          When you publish, this {BROWSER_MODE ? "browser" : "device"} keeps its own copy of the version’s fingerprint, apart from the
          course record. Checking them finds a record that was rewritten or shortened, which the record’s own check cannot.
          {BROWSER_MODE ? " Both live in this browser, so export to keep a copy elsewhere." : ""}
        </p>
        {pins.length === 0 ? (
          <p className={s.trustText}>No pinned copies on this device. A version published in another browser is pinned there.</p>
        ) : (
          <ul className={r.pins}>
            {pins.map((p) => {
              const res = results?.find((x) => x.version === p.version);
              const tone = !res ? "unchecked" : res.verdict === PIN_MATCHES ? "ok" : res.status === "error" ? "error" : "changed";
              return (
                <li key={p.version} className={r.pin} data-status={tone}>
                  <span className={r.pinVersion}>Version {p.version}</span>
                  <span className={r.digest} title={p.versionDigest}>{p.versionDigest.slice(0, 12)}…</span>
                  <span className={r.verdict}>{res ? res.verdict : "Not checked yet"}</span>
                  {res ? <span className={r.detail}>{res.detail}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className={s.rowActions} aria-live="polite">
          <Button onClick={() => void check()} disabled={busy || checking || pins.length === 0}>Check my pinned copies</Button>
          {results ? <span className={s.trustText}>{results.every((x) => x.verdict === PIN_MATCHES) ? "Every pinned copy matches the record." : "A pinned copy does not match. Look before you rely on this record."}</span> : null}
        </div>
      </div>

      {!BROWSER_MODE ? (
        <div className={r.block}>
          <h3 className={r.head}>Archive</h3>
          <p className={s.trustText}>Writes the published record to the archive folder on this computer, reads it back, and checks it.</p>
          <div className={s.rowActions} aria-live="polite">
            <Button onClick={() => void archiveNow()} disabled={busy || archiving}>Archive a verified copy</Button>
            {archive ? <span className={s.trustText}>{archive}</span> : null}
          </div>
        </div>
      ) : null}

      <VersionCompare versions={versions} courseId={courseId} />
    </section>
  );
}
