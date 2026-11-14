# U1b · The verifier's condition on the CORS branch: a look-alike origin test

Fork clone `/Users/bonorinoa/Hermes/Projects/asfai-education-fork`, branch `fix/cors-browser-mcp-clients` (head
`77abe82`). Read the U1V record: `git -C /Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff show verify/u1:docs/verification/2026-11-14-u1-cors-verifier.md`.

The verifier found that 3 of 4 mutations of the exact-match origin check survive the tests. Add tests that kill them:
look-alike origins (a listed origin plus a suffix, a prefix, a different port, a different scheme, a trailing slash,
upper case, `null`, and a list entry with surrounding spaces) must get no CORS headers. Show each mutation from the record
now failing the suite. Run the repo's checks on Node 22 (test, lint, build, plugin build and smoke). Push the branch to the
fork only. Update the PR description draft on the Silicus branch `docs/upstream-cors` if anything changed.

Fence: tests only, unless a test exposes a real bug (then fix it, minimal, and say so). No PR, no issue comment,
nothing pushed to `redbeard-26`.
