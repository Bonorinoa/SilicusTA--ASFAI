# D2 · Design review against drift (18 Nov 2026)

Card D2 (t_22890842), creative. Branch `feat/d2` from `main` at `ba68025` (N5 and N6 merged). Worktree
`/Users/bonorinoa/Hermes/Projects/silicus-wt/D2`. Node v22.22.3. No push.

**Reference:** D1 decisions (`silicus-private/sketches/2026-11-17-new-course-flow-v2/DECISIONS.md`), the studio tokens
(`--fn-*` in `studio/studio.css`, `--color-*`/`--space-*`/`--text-*` in `design/tokens.css`), Public Sans + Source Serif 4,
the 640 px sheet.

## How the shots were taken (all scripted, no model)

`studio-smoke.mjs` (browser host, IndexedDB, scripted worker) and `live-host-smoke.mjs` (Node host, mock worker) gained an
opt-in hook: with `D2_SHOTS=<dir>` set, `snap(name)` shoots the viewport at 1280×800 (DPR 1) and 390×844 (DPR 2), plus a
full-page copy, then restores the viewport and scroll. Unset (the normal run), it does nothing. Three screens are only
reached with D2_SHOTS set in the Node walk (Rehearse, Learn and Brief, by navigation after the archive check).

```sh
D2_SHOTS=<dir> node frontend/scripts/studio-smoke.mjs      # exit 0, 108 PASS, 40 shots
(cd frontend && npx vite build)                            # host-mode build for the Node walk
D2_SHOTS=<dir> node frontend/scripts/live-host-smoke.mjs   # exit 0, 89 checks, 34 shots
```

Contact sheets (each tile is labelled "scripted worker"; the header says SCRIPTED WORKER (no model)):
`docs/img/2026-11-18-design-review-{browser,node}-{desktop,390}.png`. Browser host: 20 screens. Node host: 17 (the
plan's "edited" and "add activity" states and the Learn chat are browser-only; the Node walk does not make them).
Screens: landing, studio home, wizard welcome + six steps, Brief, Objectives, Plan view, Plan edit, (browser) plan after
an edit and the add-activity form, Publish top and "Your record", Rehearse, Learn.

Artefacts in the shots that are not design: the full-page copies draw the sticky header mid-page (a puppeteer full-page
effect); the Rehearse shot repeats "What is a fraction?" because studio-smoke's G4 check cancels the passcode 20 times.

## Drift table

Severity: **High** = visibly broken; **Medium** = off-system and noticeable; **Low** = off-scale but hard to see.

| # | Screen (card) | What drifted | Severity | Status |
|---|---|---|---|---|
| 1 | Rehearse and Learn, while an answer takes over 10 s (N1 × K3) | N1's `<Elapsed/>` sits inside the `.typing` bubble, and `.typing span` styles every span as a 7 px dot. The counter became a fourth dot with "12 s" spilling out of it. | High | **Fixed.** Dot rule is now `.typing span:not([data-elapsed])`, and the counter is muted 13 px tabular text. The scripted worker answers in under 1 s, so no walk reaches it. The repro uses the module's rules, before and after: `docs/img/2026-11-18-design-review-typing-counter.png` |
| 2 | Plan edit form, add-activity form (N3, N5) | Save / Cancel / Add activity were a new button variant: 6 px radius, 13 px medium, about 30 px tall, beside the studio's 44 px, 7 px, 15 px semibold footer buttons. Below the 44 px touch target at 390. | Medium | **Fixed** (`PlanCard.module.css` `.editCancel, .editSave`: 44 px, 7 px, `--text-base`, `--weight-semibold`; colours unchanged) |
| 3 | Plan step "Your edits" trace (N3) | `font-size: var(--fn-text-sm, 0.875rem)`. `--fn-text-sm` does not exist, so it was always 14 px, off the 13/15 scale | Low | **Fixed** → 0.9375rem (studio body) |
| 4 | Plan edit form (N5) | Cites checkboxes at 0.9rem; `.editChoices`, `.shapeRow`, `.addActivity` gaps in ad-hoc rem (0.25/0.35/0.4/0.75) | Low | **Fixed** → `--text-sm`, `--space-1/2/3/4` |
| 5 | Plan sheet, its Edit chips and the N3/N5 forms | The sheet's sans text uses `--font-ui` (system UI: SF on a Mac), not Public Sans, so the edit inputs and buttons are in a different face from the studio's own inputs. The sheet predates D1; N3/N5 inherit it. | Medium | **Left for PM.** One alias (`--font-ui: var(--fn-sans)` under the studio root) would fix it. It changes the printed sheet and the token layer, and D1 §7 marked that merge as a separate tidy-up. |
| 6 | Add-activity / edit form "Cites" (N5) | Checkboxes read "Objective 1 … Objective 4" with no statement, so the teacher cannot see what they cite without scrolling up | Medium | **Left for PM.** This is content, not style: it needs the statement (or a short form) passed to the form |
| 7 | Plan sheet Edit / Move / Remove chips (N3, N5) | About 24 px tall at 390, under the 44 px target the rest of the studio keeps | Low–Medium | **Left for PM.** A 44 px chip would change the sheet's density. Needs a decision, for example a larger hit area with the same look. |
| 8 | Course header (K5 Rehearse button + long titles) | Node host at 1280 with "Lesson 3 · AI literacy": the status pills, Rehearse and About wrap to a second header row. At 390 on Objectives, "About" takes a row of its own. | Medium | **Left for PM.** Needs a header truncation rule, and narrow-shell checks this header |
| 9 | Rehearse | Two-column page about 1190 px wide, not the 640 sheet; "Run" buttons are 36 px | Low | **Left.** This predates D1 (the simulator and probes side by side on purpose), so it is not drift since D1 |
| 10 | Publish · "Your record" (K5) | Close to the system: `--fn-*` only, studio buttons, serif heads. Small nits: a rule under the card title that the sibling cards ("Make changes") lack, and the pin row's detail repeats "Version 1" ("Version 1 is exactly as you published it") | Low | **Left.** Copy is K5's and tested nearby. Not worth a churn |
| 11 | Learn · offered lesson items (K3) | Hex colours (`#5a3d24`, `#fbf3e6`, `#ecdcc4`, `#b5651d`) | n/a | **Not drift.** The student surface has its own warm palette (`.learn` sets `--learn-teal`/`--learn-gold`, and sibling `.learn*` classes use the same hexes) |
| 12 | Rehearse / Learn "General explanation, not from your lesson" and the nudge line (N4) | Read the code only: Learn uses the existing `.learnSource` pill. Rehearse puts it in the trace label ("Nudge on a try-first activity · …"). No new style. | n/a | **Not shot.** It needs an 18+ course or a general answer, and the scripted walks make neither. The attempt-first reply is shot (browser 19, Learn chat). |
| 13 | Wait lines, timeout fallbacks (N1) | The WaitLines counter uses the existing `.sub` line. No new colour or size | n/a | **Not shot** (it needs a wait over 10 s). No drift found in the code |
| 14 | Objectives authorship (N6) | "Your own objective" under a teacher row uses the existing meta style, next to "From material:" and "Accepted ·" | n/a | No drift |
| 15 | Wizard steps 1–6, landing, home | Match D1: 640 sheet, condensed step 1, one credit on the map, the foot carries the choice. No drift found | n/a | No drift |

Copy voice (N2, N4, K5): plain second person ("You edited…", "Your turn: …", "Matches the record") throughout. Nothing
reads in a different voice.

## Suites after the fixes (`feat/d2` at f5b9ae8 for code; this record adds docs/images only)

Node v22.22.3, each command un-piped from the worktree root (`d2_suites.sh` in the creative scratch):

| Command | Exit | Result |
|---|---|---|
| `(cd confirm-gate && node --test)` | 0 | 52 pass, 0 fail |
| `node --test api/test/` | 0 | 59 pass, 0 fail |
| `(cd host && node --test)` | 0 | 483 pass, 0 fail |
| `(cd host && node scripts/e2e-restart.mjs)` | 0 | 58/58 |
| `(cd frontend && npm test)` | 0 | 644 tests, 73 files |
| `(cd frontend && npm run build)` | 0 | built |
| `node frontend/scripts/browser-mode-smoke.mjs` | 0 | 316/316 |
| `node frontend/scripts/studio-smoke.mjs` | 0 | 108/108 |
| `node frontend/scripts/live-host-smoke.mjs` | 0 | 89/89 |
| `node frontend/scripts/narrow-shell.mjs` | 0 | 68/68 |

These totals equal N6V's on `feat/n6`, so the fixes changed no test's meaning. Fence: nothing under `confirm-gate/`, `api/`
or `host/` changed. There was no model call (scripted and mock workers only).
