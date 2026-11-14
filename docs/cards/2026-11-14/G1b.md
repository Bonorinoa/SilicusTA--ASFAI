# G1b · Marble source: the verifier's conditions

Continue in worktree `/Users/bonorinoa/Hermes/Projects/silicus-wt/G1`, branch `feat/marble-source` (head `b3db0c7`).
Read the verifier record first: `git show verify/g1:docs/verification/2026-11-14-g1-marble-verifier.md` (§7, §8).

## Owner decisions (14 Nov)

- **C2, attribution: comply exactly with upstream.** Use the upstream credit line verbatim, wherever Marble is
  credited (the attribution file next to the snapshot and the Landing credit, and add a short credit line in the
  studio where Marble suggestions appear):
  *Marble Skill Taxonomy (v1) · © Generative Spark, Inc. (Marble) · https://withmarble.com · licensed under ODbL 1.0
  (database) and CC BY-SA 4.0 (content).*
  Re-read upstream `README`, `LICENSE` and `LICENSE-CONTENT` at the pinned commit
  (`d4440e28d8fa0fb4a59b4accf3dd1cdde6297d63`) and follow anything else they require. Rename the attribution file to
  something licence-neutral (for example `MARBLE-ATTRIBUTION.md`), name both licences with links, and state that the
  trimmed snapshot is a derived database offered under ODbL 1.0 with its content under CC BY-SA 4.0. Remove the
  "Database Contents License" wording.
- **C1, ages: free text is no longer parsed for new work.** Card G2a replaces the free-text audience with structured
  ages. In this card only: make the source **fail closed** when no age band can be read (no citations), keep the
  existing parser for older records, widen it for the phrasings in the record (`19 year olds`, `16 to 18 year olds`,
  `17 and 18 year olds`, `N–M year olds`), and add each as a test. "Econometrics for 2nd-year undergraduates" and any
  unreadable text must return nothing.

## Also fix (verifier LOW items)

- L1: a malformed URI on the topic route returns 400, not 500. Fix the same pattern on the two older routes the
  record names, with a test each.
- L2: the browser-host guard asserts the exact forged value `mt_1` in `alignment.publicId`, not a prefix.
- L3: Landing says "ages 3–15".

## Acceptance

Tests first for C1 and L1. All STATUS §3 suites exit 0 on Node 22 (confirm-gate, api, host, e2e restart, frontend
test + build, studio smoke, browser-mode smoke). Commit on `feat/marble-source`, no push.

## Fence

No `confirm-gate/`, no `api/` change. No new UI beyond the credit line.
