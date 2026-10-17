# 2026-10-17 — Studio redesign (PM verification)

**Artifact:** `b96b102` on `redesign/field-notes` → merged `--ff-only` to `main`; production deploy READY
(`dpl_7fXoutJomABq645KpiLcjbfy9yYC`, alias `https://silicus-ta.vercel.app`).
**Producer:** Claude Code (an independent UI/UX pass over the frontend).
**Verifier:** dispatched separately (Sonnet 5.5, ASU seat); **ACCEPT** with 6 non-blocking findings
(see below). This file records the PM's own runs and the caveats.

## Verifier verdict (commit b96b102)

ACCEPT. Ran on a clean `git archive b96b102` checkout: frontend 533/533, host 296/296,
confirm-gate 41/41, build exit 0, studio smoke 22/22, browser-mode smoke 339/339, api 57/57.
Product locks PASS (thin client, material-never-persists with a marker test, honest waiting,
Soon badges, student preview label, landing trust claims, dependencies).

Non-blocking findings:
- **F1** — the landing's "gone when you reload" trust claim lost its vitest + smoke assertion
  (the product still says it; the regression guard was dropped).
- **F2** — glossary says "Rename", the studio says "Edit" ("Reworded by you"); `#/live` says Rename.
- **F3** — two smoke/vitest checks changed meaning with the product (primary CTA `#/live` → `#/studio`;
  hero screenshot → drawing). Intended.
- **F4** — three smaller guards dropped (footer repetition, unknown-hash, gradient).
- **F5** — the verifier could not re-run the live preview (Vercel SSO wall for plain curl).
- **F6** — the verifier ran on Sonnet 5.5 (same family as the Claude Code producer); the contract's
  §7 different-family rule is not met by that route. The PM's own review was on DeepSeek.

## Production live checks

Phase A (no secret) on `https://silicus-ta.vercel.app`: **15/15 pass** — landing + "Open the studio"
→ `#/studio`; studio home; new course → Brief → objectives from answers (local, no AI); the plan
draft opens the passcode dialog; "Not now" sends nothing; the course is in IndexedDB; a pasted
marker text never reaches storage; no `/api/courses` request leaves the page; reload keeps the
course; **0 CSP violations, 0 console errors**. `/api/worker/status` `configured:true` (ZDR on,
deepseek worker); `/api/worker` and `/api/fetch` 401 without the passcode.

Phase B (the real AI path) is **pending**: the browser backends were unavailable at check time
(cloud BrowserUse not entitled; the local Brave profile held its write lock). The vault has the
production passcode (`vault_70fa884d6cd0`); re-run once a browser is free.

## PM runs (all on `b96b102`, real exit codes)

| Suite | Result |
|---|---|
| `frontend` vitest | 41 files / **533 tests pass** |
| `host` node --test | **296 pass** |
| `confirm-gate` node --test | **41 pass**; `git diff --name-only main -- confirm-gate` empty |
| `npm run build` (incl. tsc) | exit 0; StudioApp is its own lazy chunk |
| `browser-mode-smoke.mjs` | **339/339** (1440 + 380) |
| `studio-smoke.mjs` | **22/22 × 3 consecutive runs** |
| manual real-browser walk | full flow (new course → publish → rehearse → learn), 0 console errors |

Smoke rewrite audit: `check(` count is **142 = 142** vs main; **0 checks removed**; the 11 changed
assertions all follow genuinely-moved copy (Try it→Open the studio, five steps→four, hero
capture→drawing, developers disclosure→Under the hood).

Preview checks (`preview-checks.sh`, deployment `silicus-otpu7s5wi-…`): `/` 200; status
`configured:true` (ZDR on, deepseek worker); `/api/worker` and `/api/fetch` 401 without the
passcode (fail closed); test/lib files 404; browser build's `browserHost-*.js` present;
**0 key-shaped strings**, 0 server env names. The one `npm start` is the landing's intentional
"Under the hood" local-run copy inside a collapsed `<details>`.

## Caveats (not blockers)

1. **No unit tests for the studio.** The 533 tests cover the landing, #/live and components; the
   2,100 new studio lines are covered only by the committed studio smoke + the manual walk.
2. **Objectives auto-confirm.** Once the last proposal is decided the host confirms objectives and
   the studio advances; the teacher cannot add an objective afterwards. Logged as
   `docs/design/backend-asks.md` #13 (P1).
3. **Verifier independence.** The verifier ran on Sonnet 5.5 (ASU seat), the same model family as
   the Claude Code producer — the contract's §7 different-family rule is not met by that route.
   The PM's own review was on DeepSeek (a different family). Treat the Sonnet verdict as a second
   reader, not the independent gate, unless a different-family verifier is also run.
4. **Production `main` is public.** This merge was gated on the verifier's ACCEPT and the owner's
   explicit green gate.

