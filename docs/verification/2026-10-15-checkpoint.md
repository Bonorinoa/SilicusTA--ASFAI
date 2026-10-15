# Checkpoint — 15 October 2026

The day's work, merged into `main`, verified, and deployed to production as the October demo checkpoint.
Production: <https://silicus-ta.vercel.app> · `main` at the merge of the rounds listed below.

## What shipped

| Round | What it does | Verified by |
|---|---|---|
| Faster drafting | The proxy decides reasoning effort from the server (`SILICUS_WORKER_REASONING`, low by default). Plan drafting fell from ~53 s to 9–23 s measured against the real model. A reply cut off by the length limit becomes a plain refusal, not a JSON error. Function deadline raised to 120 s, site request deadline to 120 s, status check bounded at 10 s. | Verifier, three rounds, NO BLOCK |
| Waiting experience | One honest waiting card for every AI step: what is happening in words with real counts, a live clock against the usual range, a "What the model sees" disclosure, a calm line when it runs long, and a true receipt on finish. Browser mode lands on the course, not the design workbench. | Verifier, two rounds, NO BLOCK |
| Narrow window | Everything holds from 320 px up: the masthead keeps its promise, the steps read as a numbered ledger, the pinned-copy row stacks, and a file chooser that clipped its own status is a house-styled button. Counts read "1 objective", "1 minute", "1 event". | Verifier round 1 BLOCK (fixed), round 2 BLOCK on one doc number (fixed), round 3 did not complete (below) |
| Onboarding clarity | Plain-language first run ("What name should this course show for you?"), an honest rail for where the teacher is in the intake, and a material step that says names only. | Verifier, NO BLOCK |
| Local worker start | The local app starts its drafting worker from one named env file, instead of silently failing when `SILICUS_WORKER_*` is unset. | Verifier, NO BLOCK |
| YouTube first run (design) | The design deck for the first run when the source is a YouTube video. | Verifier round 1 BLOCK (fixed), round 2 NO BLOCK |
| One notice, shown once | A single notice was rendered visibly by the course view and echoed by two cards, with two `role=alert` regions as well. Now one visible render and one live region. | Counted in vitest and in the browser smoke (was 3, is 1) |

## How it was verified

- **Suites at the checkpoint:** confirm-gate 41, api 57, host 262, restart e2e 53/53, frontend 286 + tsc + build,
  live-host smoke 62/62, browser-mode smoke 208/208 (wide + 380 px), narrow-shell 16/16.
- **Independent verifier** on a different model family, per round; reports in this folder.
- **Deployed build at narrow widths:** `node frontend/scripts/prod-narrow.mjs` — 45/45 at 320, 380 and 480 px.
- **Production after deploy:** page 200, `/api/worker/status` configured with zero-retention and the usual-wait
  figures, missing passcode 401, the served bundle carries the latest change, the new onboarding copy is live,
  and the notice counts 1 on the page.

## Known gaps at this checkpoint

1. **The verifier did not complete its last round.** Three attempts ended with
   `session_turn_lease_lost` — Hermes' own session lock, not a finding — after a Codex call took 520 s. Two of
   those attempts also fell back to a free model, which does not keep data private and hung once for 49 minutes.
   Round 2 had already passed every code change and blocked only on one number in a design doc; that number was
   fixed and checked here by execution. **The owner approved shipping on that basis.**
2. **The verifier's fallback chain must change** before real student data is anywhere near it (see the locks:
   free models are not zero-retention).
3. ~~Narrow-window verification is from the local harness, not a resized production tab.~~ **Closed the same day.**
   The agent browser ignores viewport resizing, so `frontend/scripts/prod-narrow.mjs` drives the *deployed* site
   with puppeteer (which sets a real viewport), walks the onboarding, and applies the narrow harness's
   predicates plus a content-clipping check. At the checkpoint: 45 checks, 0 failures at 320, 380 and 480 px on
   `https://silicus-ta.vercel.app`. Run it with `node frontend/scripts/prod-narrow.mjs` (optionally one width).
4. **Online, teachers can name materials but not paste their text.** The intake says so plainly. The local app
   has the paste-text panel; the online build does not.
5. Some rows inside the decision-history and objectives cards are still narrower than their content at 320 px.
   The page does not scroll sideways; the harness's broadest predicate flags them.
6. **asfai-education PR #15** still needs a reviewer, and the ASU data-classification check is still outstanding
   before teacher files or real students.
