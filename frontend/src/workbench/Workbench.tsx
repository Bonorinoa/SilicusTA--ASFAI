import { useEffect, useMemo, useRef, useState } from "react";
import { DecisionCard } from "../components/DecisionCard";
import { PrintIcon } from "../components/icons";
import { PlanCard } from "../components/PlanCard";
import { PublishCard } from "../components/PublishCard";
import { TimelineCard } from "../components/TimelineCard";
import { Landing } from "../landing/Landing";
import { LiveCourse } from "../live/LiveCourse";
import { BROWSER_MODE } from "../gate/mode";
import { colorTokens, spacingScale, typeScale } from "../design/tokens";
import { buildAuditedScenario, buildPlanScenario, seedProposals } from "../gate/demo";
import { ConfirmGateHarness } from "../gate/harness";
import { buildSealedExport } from "../gate/seal";
import { useHarnessRevision } from "../gate/useHarness";
import type { CheckpointStatus, ObjectiveCiteView } from "../gate/types";
import styles from "./Workbench.module.css";

/**
 * The component workbench: a small Vite gallery route where DecisionCard and
 * PlanCard are visible and interactive, driven by the REAL confirm-gate core.
 * (A gallery route rather than Storybook: lean dependencies, one build
 * pipeline, and PlanCard's print stylesheet can be judged on a real page —
 * see README.md.)
 */

type TabId = "landing" | "live" | "decision" | "plan" | "publish" | "audit" | "tokens";

const TABS: { id: TabId; label: string }[] = [
  { id: "live", label: "Live course" },
  { id: "decision", label: "Decision card" },
  { id: "plan", label: "Plan card" },
  { id: "publish", label: "Publish" },
  { id: "audit", label: "Audit trail" },
  { id: "tokens", label: "Tokens" },
];

/** The online app opens on the live course; the local app and its tests keep opening on the decision card. */
const HOME: TabId = BROWSER_MODE ? "live" : "decision";

function tabFromHash(): TabId {
  // The landing is the explicit "#/". No hash at all keeps opening where it always did (HOME).
  if (window.location.hash === "#/") return "landing";
  const raw = window.location.hash.replace(/^#\/?/, "");
  return TABS.some((t) => t.id === raw) ? (raw as TabId) : HOME;
}

/** Three lines of type on an ink-blue ground: the same mark as the favicon, drawn from the tokens. */
function Mark() {
  return (
    <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className={styles.markGround} width="32" height="32" rx="7" />
      <rect className={styles.markLine} x="7" y="9" width="18" height="3" rx="1.5" />
      <rect className={styles.markLine} x="7" y="15" width="13" height="3" rx="1.5" opacity="0.85" />
      <rect className={styles.markLine} x="7" y="21" width="8" height="3" rx="1.5" opacity="0.7" />
    </svg>
  );
}

export function Workbench() {
  const [tab, setTab] = useState<TabId>(() =>
    typeof window === "undefined" ? HOME : tabFromHash(),
  );

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // The course page reads as the product in BOTH apps (online and local): a masthead, no tabs. The component
  // workbench stays one quiet footer link away, and its hash routes (#/decision, #/publish, ...) still work.
  const product = tab === "live";

  // The landing draws its own banner, main and footer.
  if (tab === "landing") return <Landing />;

  return (
    <div className={styles.shell}>
      {product ? (
        <header className={styles.masthead} data-print="hide">
          <a className={styles.wordmark} href="#/live" aria-label="Silicus TA, home">
            <Mark />
            <span className={styles.wordmarkName}>Silicus <span className={styles.wordmarkTa}>TA</span></span>
          </a>
          <p className={styles.tagline}>The AI proposes. You decide.</p>
        </header>
      ) : (
        <header className={styles.chrome} data-print="hide">
          <div className={styles.brand}>
            <p className={styles.brandName}>Silicus TA 3.0</p>
            <p className={styles.brandNote}>design workbench · tokens-first · bound to confirm-gate</p>
          </div>
          <nav className={styles.tabs} aria-label="Workbench sections">
            {BROWSER_MODE ? (
              <a className={styles.tab} href="#/live" onClick={() => setTab("live")}>Back to the course</a>
            ) : null}
            {TABS.map((t) => (
              <a
                key={t.id}
                className={styles.tab}
                href={`#/${t.id}`}
                data-current={tab === t.id ? "true" : "false"}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
              >
                {t.label}
              </a>
            ))}
          </nav>
        </header>
      )}

      <main className={styles.stage}>
        {tab === "live" ? <LiveCourse /> : null}
        {tab === "decision" ? <DecisionDemo /> : null}
        {tab === "plan" ? <PlanDemo /> : null}
        {tab === "publish" ? <PublishDemo /> : null}
        {tab === "audit" ? <AuditDemo /> : null}
        {tab === "tokens" ? <TokensSheet /> : null}
      </main>

      {product ? (
        <footer className={styles.colophon} data-print="hide">
          <p className={styles.colophonText}>
            A prototype. Teachers decide every step; the AI only proposes and drafts.{" "}
            {BROWSER_MODE ? "Your record stays in this browser." : "Your record stays on this computer."}
          </p>
          <a className={styles.colophonLink} href="#/decision" onClick={() => setTab("decision")}>Design system</a>
        </footer>
      ) : null}
    </div>
  );
}

/* --------------------------- DecisionCard demo ---------------------------- */

function DecisionDemo() {
  const harness = useMemo(() => {
    const h = new ConfirmGateHarness({ courseTitle: "Lesson 3 · AI literacy" });
    seedProposals(h);
    return h;
  }, []);
  const revision = useHarnessRevision(harness);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(() => harness.views(), [harness, revision]);
  const checkpoints = useMemo(() => harness.gate.checkpoints(), [harness, revision]);
  const decisions = useMemo(() => harness.gate.decisions(), [harness, revision]);
  const confirmed = useMemo(() => harness.gate.confirmedObjectives(), [harness, revision]);
  const publish = useMemo(() => harness.gate.publishStatus(), [harness, revision]);

  return (
    <div className={styles.demoGrid}>
      {/* One notice, at the section level — the cards no longer echo it (see LiveCourse). */}
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      <DecisionCard
        rows={rows}
        courseLabel={harness.courseTitle}
        checkpointStatus={checkpoints.objectives.status as CheckpointStatus}
        onDispatch={(intent) => {
          const result = harness.dispatch(intent);
          setNotice(result.ok ? null : `Refused by the confirm-gate (${result.code}): ${result.message}`);
        }}
        onConfirm={() =>
          setNotice(
            "Objectives checkpoint confirmed by the gate (auto: every proposal carries a decision). The lesson-plan step would open next.",
          )
        }
      />

      <aside className={styles.gatePanel} data-print="hide" aria-label="Confirm-gate state">
        <h2 className={styles.gateHeading}>Confirm-gate state</h2>
        <p className={styles.gateNote}>
          Live from the real state machine at <code>../confirm-gate/</code> — every verb above is a
          recorded teacher turn in the ledger.
        </p>

        <table className={styles.gateTable}>
          <caption className={styles.srOnly}>Checkpoint states</caption>
          <tbody>
            {(["files", "outline", "objectives", "plan", "publish"] as const).map((id) => (
              <tr key={id}>
                <th scope="row">{id}</th>
                <td>
                  <span data-status={checkpoints[id].status}>{checkpoints[id].status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className={styles.gateSubheading}>Teacher decisions ({decisions.length})</h3>
        <ul className={styles.gateList}>
          {decisions.map((d) => (
            <li key={d.id}>
              <span data-verb={d.verb}>{d.verb}</span>{" "}
              <span className={styles.turnRef}>→ {d.provenance.turnRef}</span>
              {d.statement ? <span className={styles.decisionStatement}> “{d.statement}”</span> : null}
            </li>
          ))}
          {decisions.length === 0 ? <li className={styles.gateNote}>Nothing confirmed yet.</li> : null}
        </ul>

        <h3 className={styles.gateSubheading}>Confirmed objectives ({confirmed.length})</h3>
        <ul className={styles.gateList}>
          {confirmed.map((o) => (
            <li key={o.id}>{o.statement ?? o.publicId}</li>
          ))}
        </ul>

        <p className={styles.gateNote}>
          publishStatus: {publish.canPublish ? "can publish" : `${publish.blockers.length} blocker(s)`}
        </p>
      </aside>
    </div>
  );
}

/* ---------------------------- Publish demo (5) ---------------------------- */

function PublishDemo() {
  const harness = useMemo(() => buildPlanScenario().harness, []);
  const revision = useHarnessRevision(harness);
  const [notice, setNotice] = useState<string | null>(null);

  const published = useMemo(
    () => harness.publishedVersions().at(-1) ?? null,
    [harness, revision],
  );
  const status = useMemo(() => harness.gate.publishStatus(), [harness, revision]);
  // Any change after a publish demotes checkpoint 5 to pending.
  const unpublishedChanges =
    harness.gate.checkpoints().publish.status === "pending";
  const plan = useMemo(() => harness.gate.currentPlan(), [harness, revision]);
  const objectives: ObjectiveCiteView[] = useMemo(
    () =>
      harness.gate.confirmedObjectives().map((o) => ({
        id: o.id,
        kind: o.kind,
        statement: o.statement ?? o.publicId ?? "",
        publicId: o.publicId,
        alignment: o.alignment
          ? { publicId: o.alignment.publicId, relationship: o.alignment.relationship }
          : undefined,
      })),
    [harness, revision],
  );
  const totalMinutes = plan?.activities.reduce((n, a) => n + a.minutes, 0) ?? 0;

  const onPublish = () => {
    // The PARENT records a real teacher turn, then asks the gate to publish.
    const result = harness.publishCourse();
    setNotice(
      result.ok
        ? `Version ${result.version} sealed — the course package is immutable from now on.`
        : `Refused by the confirm-gate (${result.code}): ${result.message}`,
    );
  };

  const onExport = () => {
    const version = harness.publishedVersions().at(-1);
    if (!version) return;
    const payload = {
      package: version,
      decisions: harness.gate.decisions(),
      exportedAt: new Date().toISOString(),
    };
    const exported = buildSealedExport(payload);
    const json = JSON.stringify(exported, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `silicus-course-version-${version.version}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported version ${version.version} as JSON with a sha-256 integrity digest.`);
  };

  return (
    <div className={styles.demoGrid}>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      <PublishCard
        courseLabel={harness.courseTitle}
        courseId={harness.courseId}
        title={plan?.title ?? harness.courseTitle}
        status={status}
        objectives={objectives}
        activities={plan?.activities ?? []}
        totalMinutes={totalMinutes}
        plan={plan}
        published={published}
        unpublishedChanges={unpublishedChanges}
        teacherName="R. Okonkwo"
        onPublish={onPublish}
        onExport={onExport}
      />

      <aside className={styles.gatePanel} data-print="hide" aria-label="Publish gate state">
        <h2 className={styles.gateHeading}>Checkpoint 5 — publish</h2>
        <p className={styles.gateNote}>
          Live from the real state machine: the teacher’s publish call records a genuine turn in
          the ledger, then the gate seals an immutable version. The UI cannot publish on its own —
          fabricated provenance throws <code>FabricatedConfirmationError</code>.
        </p>
        <table className={styles.gateTable}>
          <caption className={styles.srOnly}>Publish facts</caption>
          <tbody>
            <tr>
              <th scope="row">publish checkpoint</th>
              <td>
                <span data-status={harness.gate.checkpoints().publish.status}>
                  {harness.gate.checkpoints().publish.status}
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row">versions sealed</th>
              <td>{harness.publishedVersions().length}</td>
            </tr>
            <tr>
              <th scope="row">decisions recorded</th>
              <td>{harness.gate.decisions().length}</td>
            </tr>
            <tr>
              <th scope="row">teacher turns</th>
              <td>{harness.ledger.size}</td>
            </tr>
          </tbody>
        </table>
        <p className={styles.gateNote}>
          After sealing, try the Audit trail tab — the timeline you see there is this gate’s own
          record.
        </p>
      </aside>
    </div>
  );
}

/* ----------------------------- Audit demo (C) ------------------------------ */

function AuditDemo() {
  const scenario = useMemo(() => buildAuditedScenario(), []);

  return (
    <div className={styles.demoGrid}>
      <TimelineCard
        courseLabel={scenario.harness.courseTitle}
        events={scenario.events}
      />

      <aside className={styles.gatePanel} data-print="hide" aria-label="Audit facts">
        <h2 className={styles.gateHeading}>The ledger, unedited</h2>
        <p className={styles.gateNote}>
          Every node above is a gate record — a recorded teacher turn behind each decision, a
          version record behind each seal. Nothing is re-created for display.
        </p>
        <table className={styles.gateTable}>
          <caption className={styles.srOnly}>Audit summary</caption>
          <tbody>
            <tr>
              <th scope="row">versions sealed</th>
              <td>{scenario.harness.publishedVersions().length}</td>
            </tr>
            <tr>
              <th scope="row">latest version</th>
              <td>{scenario.published.version}</td>
            </tr>
            <tr>
              <th scope="row">decisions recorded</th>
              <td>{scenario.harness.gate.decisions().length}</td>
            </tr>
            <tr>
              <th scope="row">timeline nodes</th>
              <td>{scenario.events.length}</td>
            </tr>
          </tbody>
        </table>
        <h3 className={styles.gateSubheading}>What changed per version</h3>
        {scenario.harness.versionChanges().map((change) => (
          <p key={change.version} className={styles.versionDiff}>
            <span className={styles.versionDiffHead}>
              v{change.version}
              {change.previousVersion ? ` → from v${change.previousVersion}` : " (first seal)"}
            </span>
            {change.added.length > 0 ? (
              <span className={styles.versionDiffLine}>
                added: “{change.added.join("” · “")}”
              </span>
            ) : null}
            {change.removed.length > 0 ? (
              <span className={styles.versionDiffLine}>
                removed: “{change.removed.join("” · “")}”
              </span>
            ) : null}
            {change.added.length === 0 && change.removed.length === 0 ? (
              <span className={styles.versionDiffLine}>no objective changes</span>
            ) : null}
          </p>
        ))}
        <p className={styles.gateNote}>
          The trail is append-only — version 1 kept the objectives that were confirmed when it
          sealed, even though a later revision shipped a new objective in version 2.
        </p>
      </aside>
    </div>
  );
}

/* ----------------------------- PlanCard demo ------------------------------ */

function PlanDemo() {
  const harness = useMemo(() => buildPlanScenario().harness, []);
  const revision = useHarnessRevision(harness);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  const plan = useMemo(() => harness.gate.currentPlan(), [harness, revision]);
  const invalidation = useMemo(() => harness.planInvalidation(), [harness, revision]);
  const objectives = useMemo<ObjectiveCiteView[]>(
    () =>
      harness.gate.confirmedObjectives().map((o) => ({
        id: o.id,
        kind: o.kind,
        statement: o.statement ?? o.publicId ?? "",
        publicId: o.publicId,
      })),
    [harness, revision],
  );
  const cited = useMemo(() => {
    if (!plan) return [];
    const ids = [...new Set(plan.activities.flatMap((a) => a.objectiveIds))];
    return ids.map((id) => ({
      id,
      statement: harness.objectiveWording(id),
    }));
  }, [harness, revision, plan]);

  // The re-confirm step defaults to the safe choice (A1: never one tap).
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  if (!plan) return null;

  const dropDemo = (objectiveId: string) => {
    const result = harness.dispatch({ verb: "drop", proposalId: objectiveId });
    setNotice(
      result.ok
        ? "That objective was dropped — the plan cites something no longer confirmed, so it is invalidated."
        : `Refused by the confirm-gate (${result.code}): ${result.message}`,
    );
  };

  const reconfirm = () => {
    // The PARENT records a real teacher turn, then re-confirms the plan.
    harness.confirmPlan("Re-confirm this lesson plan after invalidation.");
    setConfirming(false);
    setNotice(
      "Plan re-confirmed — still not publishable until every cited objective is confirmed again.",
    );
  };

  const gapText = invalidation.invalidated
    ? invalidation.gaps.map((g) => `“${g.statement}” (cited in ${g.citedIn.join(", ")})`).join("; ")
    : "";

  return (
    <div>
      <div className={styles.planToolbar} data-print="hide">
        <button
          type="button"
          className={styles.printButton}
          onClick={() => window.print()}
          aria-label="Print this lesson plan"
        >
          <PrintIcon />
          <span>Print this plan</span>
        </button>

        <label className={styles.demoControl}>
          <span className={styles.demoControlLabel}>Demo review flow</span>
          <select
            className={styles.demoSelect}
            aria-label="Demonstrate invalidation: drop a cited objective"
            value=""
            onChange={(e) => {
              if (e.target.value) dropDemo(e.target.value);
            }}
          >
            <option value="">Drop a cited objective…</option>
            {cited.map((o) => (
              <option key={o.id} value={o.id}>
                {o.statement.length > 56 ? `${o.statement.slice(0, 56)}…` : o.statement}
              </option>
            ))}
          </select>
        </label>

        <p className={styles.gateNote}>
          This record is the gate’s own confirmed LessonPlan — accept / rename / drop / add ran
          through real teacher turns first.
        </p>
      </div>

      <PlanCard
        plan={plan}
        objectives={objectives}
        teacher={{ name: "R. Okonkwo", confirmedAt: new Date() }}
        onPrint={() => window.print()}
        invalidation={invalidation}
      />

      {invalidation.invalidated ? (
        <div className={styles.reconfirmBar} data-print="hide">
          <p className={styles.reconfirmStatus}>
            This plan is invalidated and cannot be published until the cited objective is
            confirmed again.
          </p>
          {confirming ? (
            <div
              className={styles.reconfirmConfirm}
              role="group"
              aria-label="Confirm re-confirming this plan"
            >
              <p className={styles.reconfirmText}>
                <strong className={styles.reconfirmTitle}>
                  Re-confirm this plan exactly as it reads?
                </strong>{" "}
                It was invalidated because {gapText} is no longer confirmed. Re-confirming does
                not fix the citation — it still cannot be published until every cited objective
                is confirmed again.
              </p>
              <div className={styles.reconfirmActions}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  ref={keepRef}
                  onClick={() => {
                    setConfirming(false);
                    setNotice("Re-confirm cancelled — the plan stays invalidated.");
                  }}
                >
                  Not yet
                </button>
                <button type="button" className={styles.primaryButton} onClick={reconfirm}>
                  Re-confirm plan
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.reconfirmActions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => setConfirming(true)}
              >
                Re-confirm plan
              </button>
            </div>
          )}
        </div>
      ) : null}

      {notice ? (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------ tokens sheet ------------------------------ */

const COLOR_GROUPS: { title: string; names: (keyof typeof colorTokens)[] }[] = [
  {
    title: "Surfaces & ink",
    names: [
      "color-canvas",
      "color-paper",
      "color-paper-raised",
      "color-sunken",
      "color-ink",
      "color-ink-soft",
      "color-ink-muted",
      "color-rule",
      "color-rule-strong",
      "color-border-card",
      "color-border-control",
    ],
  },
  {
    title: "Accent (one hue)",
    names: ["color-accent", "color-accent-strong", "color-accent-soft", "color-accent-line"],
  },
  {
    title: "State (muted, semantic — print & icon fills only)",
    names: [
      "color-proposed",
      "color-proposed-bg",
      "color-accepted",
      "color-accepted-bg",
      "color-renamed",
      "color-renamed-bg",
      "color-dropped",
      "color-dropped-bg",
      "color-added",
      "color-added-bg",
    ],
  },
];

const TYPE_SPECIMEN: { token: keyof typeof typeScale; face: "display" | "ui"; sample: string }[] = [
  { token: "text-2xl", face: "display", sample: "Seeing the claim" },
  { token: "text-xl", face: "display", sample: "Learning objectives" },
  { token: "text-lg", face: "display", sample: "Students can explain what an algorithm is." },
  { token: "text-md", face: "display", sample: "Learners underline the claim in a paragraph." },
  { token: "text-base", face: "ui", sample: "UI body — quiet, adult, trustworthy." },
  { token: "text-sm", face: "ui", sample: "Controls and secondary copy." },
  { token: "text-xs", face: "ui", sample: "from your slides p.4 · suggested match" },
  { token: "text-2xs", face: "ui", sample: "MICRO LABELS · TRACKED SMALL CAPS" },
];

function TokensSheet() {
  return (
    <div className={styles.tokens}>
      {COLOR_GROUPS.map((group) => (
        <section key={group.title}>
          <h2 className={styles.gateHeading}>{group.title}</h2>
          <ul className={styles.swatches}>
            {group.names.map((name) => (
              <li key={name} className={styles.swatch}>
                <span className={styles.chip} style={{ background: `var(--${name})` }} />
                <code>{name}</code>
                <span className={styles.hex}>{colorTokens[name]}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <h2 className={styles.gateHeading}>Type scale</h2>
        <ul className={styles.specimen}>
          {TYPE_SPECIMEN.map((row) => (
            <li key={row.token}>
              <span
                style={{
                  fontFamily: `var(--font-${row.face})`,
                  fontSize: `var(--${row.token})`,
                }}
              >
                {row.sample}
              </span>
              <code className={styles.hex}>{row.token}</code>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className={styles.gateHeading}>Spacing (4px rhythm)</h2>
        <ul className={styles.spacing}>
          {Object.entries(spacingScale).map(([name, value]) => (
            <li key={name}>
              <span className={styles.spaceBar} style={{ width: `var(--${name})` }} />
              <code className={styles.hex}>
                {name} · {value}
              </code>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className={styles.gateHeading}>Motion</h2>
        <p className={styles.gateNote}>
          Only where it explains state: a decision row settling into accepted / renamed / dropped,
          120–240ms, <code>var(--ease-settle)</code>. Collapses to instant under{" "}
          <code>prefers-reduced-motion</code>.
        </p>
      </section>
    </div>
  );
}

export default Workbench;
