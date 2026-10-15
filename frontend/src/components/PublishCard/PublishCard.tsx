import { useEffect, useRef, useState } from "react";
import type {
  ActivityView,
  LessonPlanView,
  ObjectiveCiteView,
  PackageVersionView,
  PublishStatusView,
} from "../../gate/types";
import { PlanCard } from "../PlanCard";
import styles from "./PublishCard.module.css";

/**
 * PublishCard — checkpoint 5: preview the exact export, then seal it.
 *
 * Shows what will actually be published (the lesson plan sheet + confirmed
 * objectives, the same page you hand to a colleague), a preview-then-confirm
 * action for sealing the version, and — once sealed — the immutable version
 * record with a tamper-evident JSON export.
 *
 * The card holds no policy: `onPublish` is the only way out, and the parent
 * turns it into a REAL teacher turn + `gate.publish`. The AI never publishes;
 * the gate throws FabricatedConfirmationError on anything forged.
 *
 * Safety rules this surface keeps (design review, A1):
 *  - Sealing is irreversible, so it is never one tap: a confirm step quotes
 *    the version contents and defaults focus to "Keep editing".
 *  - Focus never strands on <body>: after a seal lands it moves to the sealed
 *    panel; after the confirm closes it returns to the acting control.
 *  - ONE live region announces seal results and refusals.
 *  - The gate's reason stays reachable: aria-disabled (focusable) with a
 *    state-bearing label, never a hidden `disabled` control.
 */
export interface PublishCardProps {
  /** Small caps kicker, e.g. "Lesson 3 · How AI answers are built". */
  courseLabel?: string;
  courseId: string;
  /** The course package title (what gets sealed). */
  title: string;
  /** Live `publishStatus()` from the gate. */
  status: PublishStatusView;
  /** Confirmed objectives — the citation key of what ships. */
  objectives: readonly ObjectiveCiteView[];
  /** The confirmed plan's activities (what ships). */
  activities: readonly ActivityView[];
  totalMinutes: number;
  /** The gate's own confirmed LessonPlan, rendered as the preview sheet. */
  plan: LessonPlanView | null;
  /** Latest sealed version (null = never published). */
  published: PackageVersionView | null;
  /** True when there are unpublished changes after the last seal. */
  unpublishedChanges?: boolean;
  teacherName?: string;
  /** Parent records a REAL teacher turn + gate.publish for the next version. */
  onPublish: () => void;
  /** Parent downloads the sealed package as JSON with a sha-256 digest. */
  onExport?: () => void;
  /** Parent-surfaced notice (seal result or gate refusal), announced politely. */
  notice?: string | null;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
};

export function PublishCard({
  courseLabel,
  courseId,
  title,
  status,
  objectives,
  activities,
  totalMinutes,
  plan,
  published,
  unpublishedChanges = false,
  teacherName,
  onPublish,
  onExport,
  notice = null,
}: PublishCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [hintFlash, setHintFlash] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const sealPanelRef = useRef<HTMLHeadingElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSealed = published !== null;
  const nextVersion = published ? published.version + 1 : 1;
  const nextVersionLabel = nextVersion === 1 ? "First version" : `Version ${nextVersion}`;

  // The destructive step defaults to the safe choice.
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  // Focus moves to the sealed panel when a seal lands — never strands on <body>.
  const prevSealedVersion = useRef<number | null>(null);
  useEffect(() => {
    if (published && published.version !== prevSealedVersion.current) {
      prevSealedVersion.current = published.version;
      setConfirming(false);
      sealPanelRef.current?.focus();
    } else if (!published) {
      prevSealedVersion.current = null;
    }
  }, [published]);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // One live region: announce immediately + clear short-lived flashes.
  useEffect(() => {
    if (notice) {
      setAnnouncement(notice);
    }
  }, [notice]);

  const flashHint = (text: string) => {
    setHintFlash(true);
    setAnnouncement(text);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setHintFlash(false), 1200);
  };

  const reviewClick = () => {
    if (!status.canPublish) {
      const text =
        status.blockers.length === 1
          ? `Cannot publish yet: ${status.blockers[0]}`
          : `Cannot publish yet — ${status.blockers.length} things need your attention first.`;
      flashHint(text);
      return;
    }
    setConfirming(true);
  };

  const statusChip = isSealed
    ? `Sealed · version ${published!.version}`
    : status.canPublish
      ? "Ready to seal"
      : "Not ready to seal";
  const chipState = isSealed ? "sealed" : status.canPublish ? "ready" : "blocked";

  const sealCopy = (
    <>
      <strong className={styles.sealConfirmTitle}>Seal {nextVersionLabel.toLowerCase()}?</strong>{" "}
      {objectives.length} confirmed objective{objectives.length === 1 ? "" : "s"} and{" "}
      {activities.length} activit{activities.length === 1 ? "y" : "ies"} in “{title}”. Published
      versions are immutable — any later change ships as a new version.
    </>
  );

  return (
    <section className={styles.card} aria-label="Course package — preview and publish">
      {/* The card's ONE live region: seal results and refusals. The parent
          notice is authoritative; the local flash covers blocked-hint clicks. */}
      <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
        {notice ?? announcement}
      </p>

      <header className={styles.header}>
        {courseLabel ? <p className={styles.eyebrow}>{courseLabel}</p> : null}
        <div className={styles.titleRow}>
          <h2 className={styles.heading}>{title}</h2>
          <p className={styles.statusChip} data-status={chipState}>
            {statusChip}
          </p>
        </div>
        <p className={styles.subhead}>
          Everything below is exactly what the sealed package will contain — only objectives you
          confirmed, and a lesson plan you confirmed. Sealing is the teacher’s act; nothing is
          published until you do it.
        </p>
      </header>

      {plan ? (
        <div className={styles.preview} data-print="show">
          <PlanCard
            plan={plan}
            objectives={objectives}
            teacher={teacherName ? { name: teacherName } : undefined}
            showAlignment={false}
          />
        </div>
      ) : (
        <p className={styles.empty}>No confirmed lesson plan yet — publish is blocked until a plan is confirmed.</p>
      )}

      {!status.canPublish && status.blockers.length > 0 ? (
        <ul className={styles.blockers} data-print="hide" aria-label="Why this package cannot be published">
          {status.blockers.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {isSealed && !unpublishedChanges ? (
        <SealedPanel
          panelRef={sealPanelRef}
          version={published!}
          courseId={courseId}
          onExport={onExport}
        />
      ) : (
        <div className={styles.confirmBar} data-armed={status.canPublish ? "true" : "false"} data-print="hide">
          <p className={styles.confirmStatus}>
            {isSealed
              ? `Version ${published!.version} is sealed. Unpublished changes are ready for ${nextVersionLabel.toLowerCase()}.`
              : status.canPublish
                ? `Ready — ${objectives.length} objectives, ${activities.length} activities, ${totalMinutes} minutes.`
                : `Blocked — ${status.blockers.length} reason${status.blockers.length === 1 ? "" : "s"} the teacher must resolve first.`}
          </p>
          <div className={styles.confirmActions}>
            <span
              className={styles.confirmHint}
              id="publish-hint"
              data-flash={hintFlash ? "true" : "false"}
            >
              {status.canPublish
                ? isSealed
                  ? "Any change ships as a new version."
                  : "Sealing is irreversible — preview is below."
                : "Resolve the blockers above to arm this button."}
            </span>
            <button
              type="button"
              className={styles.confirmButton}
              data-armed={status.canPublish ? "true" : "false"}
              aria-disabled={!status.canPublish}
              aria-describedby="publish-hint"
              onClick={reviewClick}
            >
              {isSealed
                ? `Review & publish ${nextVersionLabel.toLowerCase()}`
                : nextVersion === 1
                  ? "Review & publish first version"
                  : `Review & publish ${nextVersionLabel.toLowerCase()}`}
            </button>
          </div>
        </div>
      )}

      {confirming ? (
        <div
          className={styles.sealConfirm}
          role="group"
          aria-label={`Confirm sealing ${nextVersionLabel}`}
          data-print="hide"
        >
          <p className={styles.sealConfirmText}>{sealCopy}</p>
          <div className={styles.sealConfirmActions}>
            <button
              type="button"
              className={styles.sealKeepButton}
              ref={keepRef}
              onClick={() => {
                setConfirming(false);
                flashHint("Seal cancelled — nothing was published.");
              }}
            >
              Keep editing
            </button>
            <button
              type="button"
              className={styles.sealPublishButton}
              data-verb="publish"
              onClick={() => {
                setConfirming(false);
                onPublish();
              }}
            >
              {nextVersion === 1 ? "Publish version 1" : `Publish version ${nextVersion}`}
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------ sealed panel ------------------------------ */

function SealedPanel({
  panelRef,
  version,
  courseId,
  onExport,
}: {
  panelRef: React.Ref<HTMLHeadingElement>;
  version: PackageVersionView;
  courseId: string;
  onExport?: () => void;
}) {
  const activityCount = version.lessonPlan?.activities.length ?? 0;
  return (
    <div className={styles.sealPanel} data-print="hide">
      <h3 className={styles.sealHeading} tabIndex={-1} ref={panelRef}>
        Sealed — version {version.version}
      </h3>
      <p className={styles.sealLead}>
        This version is immutable. Nothing in it can be edited; any later change ships as a new
        version.
      </p>

      <dl className={styles.sealRows}>
        <div className={styles.line}>
          <dt className={styles.lineLabel}>Previous</dt>
          <dd className={styles.lineText}>
            {version.previousVersion === null ? "first version" : `version ${version.previousVersion}`}
          </dd>
        </div>
        <div className={styles.line}>
          <dt className={styles.lineLabel}>Sealed on</dt>
          <dd className={styles.lineText}>
            {new Date(version.publishedAt).toLocaleDateString("en-GB", DATE_FORMAT)}
          </dd>
        </div>
        <div className={styles.line}>
          <dt className={styles.lineLabel}>Contains</dt>
          <dd className={styles.lineText}>
            {version.objectiveRefs.length} objective{version.objectiveRefs.length === 1 ? "" : "s"} ·{" "}
            {activityCount} activit{activityCount === 1 ? "y" : "ies"}
          </dd>
        </div>
        {version.note ? (
          <div className={styles.line}>
            <dt className={styles.lineLabel}>Note</dt>
            <dd className={styles.lineText}>{version.note}</dd>
          </div>
        ) : null}
      </dl>

      {/* Machine keys demoted out of the reading path (A2): the human words
          carry the meaning; ids live on their own quiet line. */}
      <p className={styles.colophon}>
        course <span className={styles.monoId}>{courseId}</span> · sealed by{" "}
        {version.provenance.decidedBy} · {version.provenance.channel} · turn{" "}
        <span className={styles.monoId}>{version.provenance.turnRef}</span>
      </p>

      {onExport ? (
        <div className={styles.exportRow}>
          <button type="button" className={styles.exportButton} onClick={onExport}>
            Export package (JSON)
          </button>
          <p className={styles.exportHint} id="export-hint">
            Includes a sha-256 digest over the payload — anyone can verify the file is unaltered.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default PublishCard;