# G2a · Structured ages, a skill-map anchor, and cleaner suggestions (host side)

## Why

Owner decision (14 Nov): ages are load-bearing (they drive Marble suggestions, Sarah Chardonnens's AI-use stage,
and the plan's voice), so they become a structured input instead of free text parsed by regexes. A course may also
name one Marble topic as its **skill-map anchor**: the node this lesson is "about" on the map. Prerequisites, the
neighbourhood view and (later, P2) the warm-up and spaced review all key off the anchor.

Worktree: create `/Users/bonorinoa/Hermes/Projects/silicus-wt/G2` on a new branch `feat/g2` **from
`feat/marble-source`** (which holds G1 and G1b). Cards G2b and G2c continue in the same worktree and branch after you.

## Build

1. **Course record.** At creation the host accepts and records `ages: {min, max}` (integers 3 to 99, min ≤ max) and an
   optional `marbleAnchor` (an `mt_*` id that exists in the snapshot). Store them on the `course.created` event, the way
   `objectivesConfirm` is stored per course (`host/course.mjs:48-59`). Bad values are a 400 with a plain message.
   Free-text "who it's for" stays as the teacher's answer and still reaches the drafting prompt; it is never parsed for ages
   when `ages` exists. Older courses without `ages` keep working, and get no Marble suggestions (fail closed, from G1b).
2. **The anchor is a pointer, not an identity.** It never becomes an objective id, never confirms anything, and is not
   in the sealed package's objective list. It may appear in the published version as `skillMap: {anchor, label}` so a
   viewer can show it. Changing it after creation is out of scope.
3. **Derived stage.** A pure function `stageForAges({min})` → 1 (under 8), 2 (8–11), 3 (12–14), 4 (15+): the youngest age
   sets the stage. Expose it in the course view. No AI rule is enforced in this card; P2 uses it.
4. **Relevance.** When a course has an anchor, Marble suggestions prefer the anchor's subject and domain, and the
   dependent-walk in `host/sources/marble.mjs` stops crossing into unrelated domains. The verifier's example: "AI in daily
   life" for ages 8–10 returned "Daily Life in a Roman Town" and "Roman Army and Conquest of Britain"; with an anchor in
   Computing / Artificial Intelligence, those must be gone. Without an anchor, the current behaviour stays, filtered by ages.
5. **A coverage route** for the wizard: given an age range, return the count of topics that overlap it and a per-age count
   (3 to 25), so the UI can draw the histogram strip. Read-only, no log write.
6. **The neighbourhood route**: the anchor's prerequisites two hops up and dependents one hop down, each with id, name,
   ages, subject, domain, strength, reason and evidence lines. Read-only. (G1's topic route may already cover most of it;
   extend rather than duplicate.)

## Acceptance

Tests first. Unit tests for validation, stage, anchor-not-an-objective (sealed package carries no `mt_` in objectives),
relevance (the Roman case), coverage counts (ages 9–10 → 1,320 overlapping topics at the pinned snapshot; ages 19–22 → 0),
legacy course without ages. Browser-host parity for the new routes. All STATUS §3 suites exit 0 on Node 22.
Document the new fields and routes in `host/README.md`. Commit on `feat/g2`, no push.

## Fence

No `confirm-gate/` change. No `api/` change. No UI (G2b does the wizard). Do not touch the plan prompt (P2 does).
