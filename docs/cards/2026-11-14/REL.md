# REL · Release gate, cross-family (Codex): is `main` ready to deploy?

You may block. You run on **openai-codex / gpt-5.6-sol**, a different model family from every producer in this round (Opus and
DeepSeek) and from the earlier Sonnet gates. Runs on the `main` sha the PM gives once N5, N6 and D2 are merged and L2 has reported.

Read `docs/STATUS.md`, `docs/NEXT.md` (the owner decisions box), every gate record from `docs/verification/2026-11-1[4-8]-*.md`, and the L1 and L2 records.
Read the private folders they point to, but never copy source text into the repository.

1. **Suites.** From a clean `git archive` export: every STATUS §3 suite plus studio-smoke and narrow-shell, on `/Users/bonorinoa/.local/bin/node`
   (v22.22.3). Give counts and exit codes.
2. **Locks.** For each STATUS section 2 lock, plus "AI never grades", "the teacher confirms", "material text transient for new
   writes", "objective identity is the local URN", and "student chat is not evidence": name the code that enforces it and
   one test that fails if it breaks. Run that mutation yourself. Report any lock whose only defence is the prompt.
3. **Open conditions.** Collect every unclosed condition from the gate records since 14 Nov (KV, KV2, K5V, N1V, N5V, N6V, D2, L2).
   Classify each: blocks the demo, before 11 Dec, or roadmap.
4. **Fresh eyes.** Walk one course end to end yourself in real Chrome with the scripted worker (no paid calls): the wizard, the map,
   sources, objectives, the plan with an edit, publish, the pin check, Rehearse. Report anything the Claude gates missed.
5. **The Vercel path.** Read `api/` and `vercel.json` against what the app now asks of them (per-task reasoning, deadlines, fetch
   checks). Will production behave like the local host? Name every difference.

Record `docs/verification/2026-11-<dd>-release-gate.md` on `verify/release`, commit, no push. The verdict is **SHIP / SHIP WITH
CONDITIONS / DO NOT SHIP**, with the exact list the owner must accept.
