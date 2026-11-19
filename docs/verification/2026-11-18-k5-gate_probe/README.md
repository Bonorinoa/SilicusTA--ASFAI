# K5V probe (run against `git archive feat/k5` @ e300f18, Node v22.22.3 = /Users/bonorinoa/.local/bin/node)

Setup: `git archive feat/k5 | tar -x -C $T; (cd $T/frontend && npm ci)`; copy the two `.mjs` files into `$T/frontend/scripts/`.

- `runsuites.sh $T $LOGDIR` — every STATUS §3 suite except live-host-smoke and the paid ones, exit code per line in `logs/summary.txt`.
- `node frontend/scripts/live-host-smoke.mjs` — K5's own, default ports 8787/5173 (free at the time), `logs/live-host-smoke.log`.
- `k5v-probe.mjs` — a copy of live-host-smoke.mjs plus my own checks (untouched pin -> Matches; rewritten -> Differs; revision words on
  the Objectives step; two-version comparison; header and overflow measurements at 390 px; screenshots).
  `SMOKE_HOST_PORT=8801 SMOKE_APP_PORT=5190 K5V_SHOTS=<dir> node frontend/scripts/k5v-probe.mjs`  -> `logs/k5v-probe.log`.
- `k5v-browser-probe.mjs` — a copy of studio-smoke.mjs (browser host) plus: revise by rewording, RevisionNote, publish v2, two pins,
  version comparison. `node frontend/scripts/k5v-browser-probe.mjs` -> `logs/k5v-browser-probe.log`.
- Mutation: replace `const cmp = comparePin(pin, anchor);` in `studio/RecordCard.tsx` with a constant, run
  `npx vitest run src/studio/RecordCard.test.tsx` -> `logs/mut1.log`, `logs/mut2.log` (baseline `mut0.log`).
- Red provenance: export `44f4619`, copy `K5.polish.test.tsx` (minus the `namesFromProposals` import, which does not exist there), run it ->
  `logs/red-prov.log` (5 failed); same file on feat/k5 -> `logs/green-prov.log` (5 passed).
