Probes for docs/verification/2026-11-17-k-gate.md (verifier, KV gate on feat/k @ 87b96cc). Nothing here is product code.

- `kv-k2.mjs`, `kv-m1.mjs`: copy into `host/` of a clean `git archive feat/k` export and run `node kv-k2.mjs` (Node 22). kv-m1's three "refuses" FAILs are my own wrong expectation: validation lives in `host/handler.mjs`, below which `CourseSession.create` normalises instead of throwing.
- `probe-head.mjs` + `probe-walk-landing.mjs` / `probe-walk6.mjs` / `probe-walk8.mjs`: `cat probe-head.mjs probe-walk6.mjs > frontend/scripts/kv-probe.mjs` inside the export (so `puppeteer-core` resolves), then `node scripts/kv-probe.mjs`. They build the browser-mode app, serve it with the vercel.json headers and a mock worker/fetch, and drive real Chrome. walk-landing: landing-link check on every studio screen. walk6: unreadable pages (403/404/504) and Details. walk8: "Propose objectives from sources" after adding a source.
- `logs/`: summary.txt is the suite exit table for the export; base-* are the same two failing smokes at 437f053 (green).
- The K3 mutation run is a six-mutant loop over `host/student.mjs`; its table is in the record.
