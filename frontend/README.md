# Silicus TA 3.0 — design-system foundation

Tokens-first styling and two flagship components for the teacher-facing product,
exercised in a live component workbench and bound to the real **confirm-gate**
state machine (`../confirm-gate/`) — the UI renders gate state and dispatches
teacher verbs into it; it never decides anything itself.

```
frontend/
  src/design/        tokens.css + tokens.ts (mirrored, parity-tested)
  src/gate/          the confirm-gate binding: harness, demo scenarios, crypto shim
  src/components/    DecisionCard/  PlanCard/  icons
  src/workbench/     the gallery route (the workbench)
  src/test/          vitest setup
```

## Design language — "a considered ledger"

Teachers read and write text all day, so the interface is set like a document,
not a dashboard: warm paper surfaces and ink-dark text, one accent hue
(fountain-pen ink blue) used only where a teacher acts, and headings/proposals
in a serif display face that reads like a well-set syllabus while the UI chrome
stays in a quiet sans. Restraint is the aesthetic — hairline rules do the work
that shadows and pills do in generic SaaS, state colors are muted and semantic
and never carry meaning alone (every state ships a glyph + a text label), and
motion appears only where it explains a state change (a proposal row settling
into accepted/renamed/dropped, 120–240 ms, gone under `prefers-reduced-motion`).
Craft references: Linear's restraint, Stripe's polish on trust surfaces, and a
printed course handout you'd be happy to hand to a colleague.

## Tokens (`src/design/tokens.css` mirrored by `src/design/tokens.ts`)

All component styling consumes these variables — nothing hard-codes a color
(`src/design/tokens.test.ts` fails the build if a hex/rgb/hsl value appears in
`src/components/**` or `src/workbench/**`). Every documented text pair clears
WCAG AA (≥ 4.5:1; control borders ≥ 3:1), asserted in the same test.

| Group | Tokens | Values |
|---|---|---|
| Surfaces | `--color-canvas`, `--color-paper`, `--color-paper-raised`, `--color-sunken` | `#efe9dc`, `#fbf8f1`, `#fffdf8`, `#eae3d3` |
| Ink | `--color-ink`, `--color-ink-soft`, `--color-ink-muted` | `#221f1a`, `#4e4941`, `#6b6459` |
| Rules | `--color-rule`, `--color-rule-strong`, `--color-border-card`, `--color-border-control` | `#cfc3a8`, `#b3a586`, `#d5cab3`, `#8a8170` (control borders ≥ 3:1) |
| Accent (one hue) | `--color-accent`, `--color-accent-strong`, `--color-accent-soft`, `--color-accent-line` | `#2c4a66`, `#223b53`, `#e6ebf0`, `#a9bacb` |
| State (muted) | `--color-{proposed,accepted,renamed,dropped,added}` + `…-bg` washes | `#6b6459`, `#4a6642`, `#7a5c22`, `#87473c`, `#6a4a63` |
| Type | `--font-display` (**Source Serif 4**, self-hosted — variable 200–900, OFL), `--font-ui` (system sans), `--font-mono` | — |
| Type scale | `--text-2xs … --text-2xl` (paired leadings `--leading-2xs … --leading-2xl`) | 0.625 → 2.5 rem (10 → 40 px), 4px grid |
| Leading / tracking | `--leading-tight/snug/normal/relaxed`, `--tracking-label`, `--tracking-micro`, `--tracking-display` | 1.12 / 1.3 / 1.55 / 1.7 |
| Spacing | `--space-1 … --space-20` | 0.25 → 5 rem (4 px rhythm) |
| Radii | `--radius-xs/sm/md/lg/pill` | 2 / 3 / 5 / 8 / 999 px |
| Elevation | `--shadow-hairline/card/page/lift` | hairlines first; shadows barely there |
| Motion | `--duration-quick/base/slow`, `--ease-settle`, `--ease-standard` | 120 / 180 / 240 ms; reduced-motion collapses all to 0.01 ms |

## Components

### `DecisionCard` — checkpoint 3 (objectives)

Renders objective **proposals** as a ledger of rows: the proposed statement
(serif), a quiet provenance line (`from your slides p.4 · aligns to mt_K6qtan847r
(suggested)` — alignment is garnish, demoted from "(suggested)" to its
relationship word once a teacher decision lands), and the four teacher decision
verbs as explicit actions. Nothing is ever pre-confirmed; the honest resting
state reads "Nothing confirmed yet."

```tsx
<DecisionCard
  rows={harness.views()}                 // ProposalView[] derived from gate state
  onDispatch={(intent) => …}             // the ONLY output: DecisionIntent
  onConfirm?={() => …}                   // CONFIRM bar advance hook
  checkpointStatus?={"pending" | "open" | "confirmed"}
  courseLabel?={"Lesson 3 · AI literacy"}
  notice?={"Refused by the confirm-gate (ALREADY_DECIDED)."}
/>
```

| Prop | Type | Notes |
|---|---|---|
| `rows` | `readonly ProposalView[]` | `src/gate/types.ts`; status ∈ proposed / accepted / renamed / dropped / added |
| `onDispatch` | `(intent: DecisionIntent) => void` | `{verb:"accept"\|"drop", proposalId}` · `{verb:"rename", proposalId, statement}` · `{verb:"add", statement}` |
| `onConfirm` | `() => void` | fires from the CONFIRM bar (armed only when every proposal has a decision; mirrors the gate auto-confirming checkpoint 3) |
| `checkpointStatus` | `"pending" \| "open" \| "confirmed"` | real `gate.checkpoints().objectives.status` |

Verb semantics (identical to the gate's `VERBS`): **accept** enters the
confirmed set unchanged; **rename** versions the wording while the objective id
stays stable (the original proposal record is never rewritten — the row shows
"as proposed: …"); **drop** removes it (terminal — and never one tap: a confirm
step quotes the statement and defaults focus to "Keep it"; on an already-decided
row the same gate action is labelled **Revoke**); **add** authors a new **local** objective, confirmed immediately
because the teacher *is* the decision. Row actions reflect exactly the legal
moves per state (one content-shaping decision per proposal; dropped proposals
cannot be revived).

### `PlanCard` — checkpoint 4's confirmed `LessonPlanRecord`, as a page

```tsx
<PlanCard
  plan={gate.confirmLessonPlan(…)}       // the gate's own LessonPlanRecord
  objectives={gate.confirmedObjectives()} // the citation key at the foot
  teacher?={{ name, confirmedAt }}
  onPrint?={() => window.print()}
/>
```

Sets the plan like a printed syllabus: title (serif display, 34px screen / 26pt
print), audience band (`Ages 8–10`), timing (`40 minutes · 3 activities · Course
version 1`), numbered activity rows, and — as ONE label/value list with a single
6rem gutter and one label style — *Learners* / *Teacher* / *Evidence* / *Not
evidence* per activity, objective citations as superscript markers keyed under
"Objectives referenced", and the contract's honesty line as a quiet footer:
*"Asking the assistant a question is not evidence."* Print: chrome hidden,
physical units (10.5pt body, 150mm measure), headings never end a page, no
mid-activity breaks. Page geometry is global in `src/styles/print.css`
(`@page { size: A4; margin: 20mm 22mm 22mm }`) — a CSS module cannot scope an
at-rule, so leaving it in the component made the plan govern every print in the
app. Print the Plan tab of the workbench to judge it.

### `AiWaiting` — every AI step, honestly

One component for proposing objectives, drafting the plan and a student's answer (compact variant): plain
words with real counts, a live clock, the usual range (`typicalSeconds` from the worker status, else
`objectives 3–15`, `plan 5–25`, `answer 2–8`), "What the model sees", a true receipt computed from the
resulting view, and no progress bar. See `../docs/design/waiting-experience.md`.

## Binding to the confirm-gate core (architecture)

`../confirm-gate/confirm-gate.mjs` and `host-guard.mjs` are imported **directly
and unmodified** (relative `.mjs` imports). Components hold no policy: a
DecisionCard action becomes a `DecisionIntent`, the parent turns it into a real
teacher turn (`TurnLedger`'s `TeacherChannel#say`, the host-transport moment)
and then `gate.confirmObjectives({ provenance citing that turn, decisions })`.
`src/gate/harness.ts` is that minimal wiring for stories/tests/workbench; the
gate rejects anything that isn't backed by a recorded teacher turn with
`FabricatedConfirmationError` (asserted in `harness.test.ts` — an assistant turn
can never confirm anything).

- **`node:crypto` shim.** `confirm-gate.mjs` imports `node:crypto`
  (`createHash("sha256")` for `add` idempotency keys, `randomUUID` for local
  ids). The browser has neither, so `vite.config.ts` aliases `node:crypto` →
  `src/gate/crypto-shim.mjs`, a pure-JS SHA-256 + UUIDv4 with **byte-identical
  output** to Node's (parity-tested against the real `crypto` builtin). The gate
  itself is untouched, so browser-minted and host-minted idempotency keys match.
- **`host-guard.mjs` is pure JS** (no Node-only imports) and bundles as-is; the
  harness uses its `TurnLedger`/`TeacherChannel` exactly as the host transport
  would.

## Accessibility

Floor: AA contrast (tested), visible focus rings on every control
(`:focus-visible`, 2 px accent outline), ARIA labels naming the verb *and* the
target (`Accept objective: "…"`), a single live region announcing state changes,
and state never color-only — every state shows a glyph + text label.

Safety & audit affordances (design review A1 — each one pinned by a test in
`DecisionCard.test.tsx`, describe block "safety behaviors"):

- **Nothing irreversible is one tap.** Drop/Revoke opens a confirm step quoting
  the statement; the safe choice ("Keep it") holds focus by default.
- **Focus is never stranded.** After any decision lands, focus moves to the row's
  action group instead of falling to `<body>` (Accept/Drop unmount their button).
- **One live region.** A single `aria-live="polite"` node announces decisions and
  the all-decided milestone; two independent regions would race and silently drop
  an announcement (that race was caught by a test and fixed).
- **The CONFIRM bar explains itself.** `aria-disabled` (focusable — not a hidden
  `disabled` control) with a state-bearing label ("Confirm 3 objectives — 2
  decisions left" → "Confirm 3 objectives · build the plan"), an
  `aria-describedby` hint, and a "✓ Ready" mark so readiness is never colour alone.
- **44 px minimum targets** on every verb, Add and Confirm control.
- Motion (row settle, statement swap, armed bar) is disabled under
  `prefers-reduced-motion: reduce`.

Keyboard map (verified in `DecisionCard.test.tsx`):

| Key | Effect |
|---|---|
| `Tab` | per row `Accept → Rename → Drop`, rows in order, then `Add objective`, then `Confirm objectives` (always reachable: when disarmed it is `aria-disabled` — still focusable — and activating it flashes the reason instead of confirming) |
| `Enter` / `Space` on a verb button | dispatches the verb (accept / open-rename / open-add / open the drop confirm) |
| `Enter` on **Drop** / **Revoke** | opens the confirm step — the terminal verb is never a single keystroke; focus lands on **Keep it** |
| `Enter` on **Keep it** / **Drop it** | cancels / commits the drop (or revoke); focus returns to the row's action group |
| `Enter` on **Rename** | opens the inline editor (one keystroke from the row), focus moves into it |
| `Enter` in the editor | commits the rename (dispatches `{verb:"rename"}` — id stays stable) |
| `Shift+Enter` in the editor | inserts a line break instead of committing |
| `Esc` in the editor | cancels, nothing dispatched, focus returns to **Rename** |
| `Enter` on **Add objective** | opens the authoring editor (same Enter/Esc contract) |

Unchanged or empty rename wording is refused inline with a hint (the gate would
answer `STATEMENT_UNCHANGED` / `BAD_STATEMENT`), so the teacher never hits a
protocol error from the editor.

## Two builds: host mode and browser mode

`VITE_SILICUS_MODE` is read at build time (`src/gate/mode.ts`).

- **unset (host mode, the default):** the Live tab is a client of the Node host at `/api` (the vite dev/preview
  proxy forwards it to 127.0.0.1:8787). All existing tests and `scripts/live-host-smoke.mjs` run this way.
- **`browser` (the online app; what `vercel.json` builds):** the teacher's browser is the host. `transport.ts`
  sends the same intents to the same handler in-page (`src/browser/browserHost.ts` over `host/handler.mjs`); the
  record is kept in IndexedDB; the only network calls are the site's `/api/worker` (model proxy) and `/api/fetch`
  (guarded link reader), behind a demo passcode kept in sessionStorage. The UI says this browser keeps the
  record, offers Export all courses / Import / Delete all data from this browser, and says plainly that ASFAI and
  YouTube need the local app.

```sh
node scripts/browser-mode-smoke.mjs   # builds browser mode, serves it with vercel.json's headers + mock functions, drives Chrome
```

## Workbench & commands

```sh
npm install
npm run dev       # workbench at http://localhost:5173
npm run build     # tsc -p tsconfig.json && vite build
npm test          # vitest run — 32 tests (6 files)
```

The workbench is a **Vite gallery route** (hash tabs: *Decision card* / *Plan
card* / *Tokens*), not Storybook — a deliberate call for this foundation slice:
one build pipeline and lean dependencies (the stack brief's "keep dependencies
lean"), instant HMR for the December MVP work, and — decisive for PlanCard — a
real page whose `@media print` output can be judged as typesetting without
Storybook's iframe/chrome polluting the print. It doubles as the seed of the
product's own component gallery. The Decision tab runs a live `ConfirmGate` with
a side panel showing real checkpoint/decision state; the Plan tab renders a
fully real scenario (propose → accept / rename / drop / add → propose plan →
confirm plan, every step a recorded teacher turn) with a **Print this plan**
button; the Tokens tab is the swatch/type/spacing specimen.

Demo content is illustrative (a fictional teacher, sample provenance lines and
Marble ids); the state machine behind it is not — it is `../confirm-gate`.
