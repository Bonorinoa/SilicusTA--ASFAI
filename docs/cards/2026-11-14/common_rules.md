
---

# Common rules (every card in the 14 November round)

## Context you need, in five lines

- Silicus TA 3.0 is a teacher authoring app: a teacher gives material and intent, an AI proposes, the teacher
  confirms each step, a lesson plan is published. Repository root: `/Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff`.
- Read `AGENTS.md`, then `docs/STATUS.md` (its 13 November owner box first), then `docs/NEXT.md`. STATUS wins.
- December goal (owner, 14 Nov): a polished **teacher** experience for an ASFAI member demo; the student side is a
  labelled preview. Target date 1 December, hard stop 5 December. Theme: AI that is designed, not only a chat.
- The knowledge graph is **Marble** (open data, `withmarbleapp/os-taxonomy`, ODbL-1.0). We read it ourselves; we
  do not depend on the ASFAI MCP server for the demo.
- Team: Augusto (owner) plus agents build. Michael holds ASFAI's institutional access. Stephen is out.

## Locks (the owner decides any change)

- The teacher confirms. The AI proposes. Clients send intents, never provenance.
- Objective identity is the local URN. A Marble id (`mt_*`) is never an objective's identity and is never bound
  automatically. It may be kept as a `closeMatch` the teacher accepted.
- Material text is transient. AI never grades. Student chat is not learning evidence. No decorative Google sign-in.
- Do not touch `confirm-gate/` unless your card says so, and then only test first.
- Access stays the single demo passcode. Do not build accounts, invite codes or ASFAI login in this round.

## Working rules

- **Never switch branches in the root checkout.** Other cards run there at the same time. Make your own worktree:
  `git -C /Users/bonorinoa/Hermes/Projects/silicus-asfai-handoff worktree add /Users/bonorinoa/Hermes/Projects/silicus-wt/<CARD> -b <branch> main`
  and run `npm ci` inside its `frontend/` (and `host/` if it has a lockfile) before tests.
- Run commands from the worktree root with each `cd` in a subshell: `(cd host && node --test)`. Node v22.22.3
  (`node -v` first and name it in your report). Never add `--test-force-exit`.
- Commit with the repository's own git identity. Never pass `git -c user.name=…`. **No push, no deploy, no PR,
  no email.** The owner does those.
- Never read, print or copy a secret (`.env*`, tokens, API keys). If you need a credential that is not present,
  block with `kind=needs_input` and say which file the owner must create.
- Do not edit dated records under `docs/verification/`, `docs/decisions/`, `.hermes/plans/`, or `docs/STATUS.md`.
- Every number in your report comes from a command you ran in this card, with the command shown.
- Sarah Chardonnens's booklets are licensed material. They live only in
  `/Users/bonorinoa/Hermes/Projects/silicus-private/sarah/` (outside git). Never copy their text into the repository.
  Restate ideas in your own words, credit "Sarah Chardonnens, SYNAPSE model (University of Fribourg)", quote at most
  a short phrase.

## Report (in your kanban_complete summary and metadata)

Five fields: **Root** (worktree path and branch), **Acceptance** (each item: met / not met, with evidence),
**Artifact** (paths and the commit sha), **Fence** (confirm nothing outside it was touched), **Open** (what you
could not do and why). Put the commands and exit codes in metadata `tests_run`.
