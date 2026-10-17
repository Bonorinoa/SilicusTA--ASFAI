# Checkpoint — 16 October 2026

The weekend prototype plus the final-sprint copy, merged to `main` and deployed.
Production: <https://silicus-ta.vercel.app> at `3ed0d10`. Remote has one branch: `main`.

## What shipped

| Piece | What it is | Where it sits |
|---|---|---|
| Weekend share | Student helper scope, Brief, workspace, uploads, suggestions, landing | `30acb50` (release merge) |
| Final sprint | Rail caption `Model name:`, landing "How it works", helper relabelled "Check a student question", README says ASFAI is a protocol | `9bbbc0e` |
| Smoke follow-ups | Narrow-window exemption, smokes follow the new copy | `ec9d16e`, `3ed0d10` |

Tag `v0.3.0` points at `ec9d16e`, one commit behind production. It was not moved.

## How it was verified

- Independent verifier, grok-4.7 via the SuperGrok seat (the Codex seat returned 429; Augusto retargeted). Different family from the nous producer.
- NO BLOCK on exactly `9bbbc0e`. Report: `docs/verification/2026-10-16-final-sprint.md`.
- Suites re-run on that sha, exit codes not taken through a pipe: confirm-gate 41/41, host 296/296, frontend 528/528 in 41 files, build 0. confirm-gate diff empty.
- The three commits after `9bbbc0e` change four smoke scripts only. Product paths (`README.md`, `docs`, `frontend/src`, `host`, `confirm-gate`, `api`) are identical to the verified sha. Those smoke edits were not re-run by the verifier.
- Production bundle at the checkpoint contains the new copy ("How it works", "Check a student question").

## Known gaps at this checkpoint

1. **No new test that a children's Marble id cannot be auto-bound.** Older tests were cited. A miss is still supposed to become a teacher-named local objective. Not re-proved against a live undergraduate topic.
2. **Course library vs a temporary plan** was not built. A course list already exists. A second object was parked.
3. **BYOK, ASFAI-as-account, landing animations** were parked. The public host still uses the passcode.
4. **The verification report was untracked until this checkpoint commit.** The sha it judges did not move.
