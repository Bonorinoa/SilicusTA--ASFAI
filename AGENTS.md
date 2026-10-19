# Agent bootstrap: Silicus TA 3.0

Read these before you change or claim anything. This file points. It does not hold status.

1. Current status: [`docs/STATUS.md`](docs/STATUS.md). Check its header for the sha and date. Where any other
   document disagrees with it, STATUS wins.
2. What each document is, and whether it is current or historical: [`docs/INDEX.md`](docs/INDEX.md).
3. Dated records in `docs/verification/`, `docs/decisions/` and `.hermes/plans/` are historical. Never edit them.
   Add a newer record or a pointer instead.

## Locks (the owner decides any change)

- ASFAI Education is a separate protocol product. Silicus can use it and never requires it.
- The browser host and the Node host have different authority. Do not treat them as equal.
- Material text is transient. It holds for new writes. It is still violated for legacy and imported records (STATUS
  section 2, item 13). Do not describe it as fully current behaviour.
- AI never grades. This rests on the prompt, the refusal flag and a partial regex net (STATUS
  section 2, item 8). Do not call the net a guarantee.
- Student chat is not learning evidence.
- Objective identity is the local URN.
- The teacher confirms. The AI proposes.
- No decorative Google sign-in.
- RA and graduate-school use are parked.

## Rules

- **No deploy, push or release without the owner's explicit instruction.**
- Run commands from the repository root with each `cd` in a subshell, for example `(cd host && node --test)`.
  Do not add `--test-force-exit`: it hides hangs. Name the Node version in any result.
- Do not present an old passing suite as today's. Take test totals from a dated record or a parent-finalized
  report. Mark unfinalized runs PENDING.
- A green test run is not live reliability. The paid student-helper eval and the production model path are
  separate checks (STATUS header).
- Paper numbers and scope decisions belong to Augusto.
