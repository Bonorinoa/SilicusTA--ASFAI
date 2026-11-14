# U1V · Independent verifier gate on U1 (asfai-education CORS fork branch)

You may block. Read the U1 card summary (your parent) and `docs/cards/2026-11-14/U1.md`.

## Check

1. **Independence**: producer route from `/Users/bonorinoa/.hermes/profiles/engineer/logs/agent.log`; flag a Claude fallback.
2. Fresh clone of `Bonorinoa/asfai-education` branch `fix/cors-browser-mcp-clients` into a scratch directory.
   On Node 22: `npm ci`, tests, lint, build (and plugin build/smoke if present). Report counts and exit codes.
3. Diff against the recorded upstream sha: only the named routes plus one helper and tests. No credentials header.
   Unset env var gives byte-identical responses (prove it with a test or a local `next start` and `curl`).
4. Security read: exact-match origins (no substring or regex surprise, no `null` origin accepted), `Vary: Origin` on
   every echoed response, preflight does not leak anything for unlisted origins.
5. The PR description draft is accurate against the diff.

## Verdict

ACCEPT / ACCEPT WITH CONDITIONS / BLOCK, with HIGH/MEDIUM/LOW findings and file:line. Write it to
`docs/verification/2026-11-14-u1-cors-verifier.md` on a branch `verify/u1` in your own Silicus worktree, commit,
do not push.
