# Silicus TA 3.0: next session plan

Written 13 November 2026 by the PM session, for whoever picks the project up next. This is a plan, not status.
Status is [`STATUS.md`](STATUS.md) (read its 13 November owner box first). Where this page and STATUS disagree,
STATUS wins.

## 1. Where we are, in five lines

- Product code is `v0.6.0` (`3a01b1d`), deployed on Vercel. Nothing in the product has changed since 19 October.
- One teacher on one device can go from materials to a published lesson. Students cannot reach it (STATUS §2 item 1).
- The local app can draw "suggested alignment" from ASFAI's Marble map and from a local ontology file. The online
  app cannot (CORS, asfai-education #16).
- A course holds one lesson. A course of lessons is an open design decision, not a missing screen (§2 item 5).
- Team: Augusto plus agents build. Michael holds institutional access. Stephen is out.

## 2. Goal: an internal member demo in December

Date not recorded in this repo. A 6 October session mentions 1 December; confirm it before planning backwards.

Two strategies were discussed on 12 to 13 November. **The owner leaned toward B.** Confirm before work starts.

| | A. ASFAI-integration-first | B. Polish + labelled design mock + two live lessons (recommended) |
|---|---|---|
| What members see | Connect ASFAI and suggested alignment, live | The real teacher walk, twice, plus a labelled picture of what is not built |
| Depends on Michael | Yes for the deployed site (#16) | No. ASFAI is one beat on the local app |
| Risk | A week spent on auth plumbing members cannot click | Overselling the mock. Every mock panel must be stamped |

## 3. Work packages for strategy B

Each package ends in a file or a commit you can open. No deploy and no push without the owner (AGENTS.md).

**WP0. Re-freeze.** On a clean `main`, run the suites in STATUS §3 on Node 22 and write a dated record under
`docs/verification/`. STATUS §6 says refresh only from a frozen sha with a record.

**WP1. Two live lessons on the local app.** Use the Marble walk in
[`committee/2026-11-12-marble-examples.md`](committee/2026-11-12-marble-examples.md):
- Lesson 1: Smart Versus Not-Smart Devices (`mt_WRRv1ABECC`, ages 5 to 8).
- Lesson 2: AI in Daily Life (`mt_AzTrT5ySCx`, ages 5 to 12). The graph says lesson 1 is its hard prerequisite.
- Today these are two course records, one lesson each. Do not build a course object for the demo.
- Done when: `GET /api/asfai/status` says connected on the local host; `GET /api/knowledge/status` lists
  `asfai-graph` and `local-ontology`, both enabled; each plan shows at least one `asfai:` suggestion with an age
  label; both lessons are published and rehearsed; a dated walk record is committed.
- Before WP1, confirm the local worker route (`SILICUS_WORKER_*`, `host/README.md`). The ZDR preset is OpenRouter
  DeepSeek, which failed once in October for lack of credit. The native Anthropic wire is not zero-retention, and
  the host says so.

**WP2. Polish only what the walk touches.** Candidates, each needing the owner's copy decision first:
- §2 item 11: the two retired "seal" strings.
- §2 item 10: the "gone when you reload" claim with no guard.
- The publish step and the landing line that say class codes are not live. Keep them true.
- Do not open the full gap list as a sprint. Items 3, 4, 13 and 16 are trust-core or record changes and need a
  failing test first.

**WP3. A labelled design mock.** One local HTML page, built on the style of
[`committee/2026-11-12-student-preview.html`](committee/2026-11-12-student-preview.html):
- A course holding lessons 1 and 2, with the prerequisite edge shown.
- A student opening lesson 2 from a class code (not built: stamp it).
- The suggested-alignment strip as the plan shows it today (built, local app only: say so).
- Done when: every unbuilt panel carries a NOT BUILT stamp, no panel has a login form, and the page names the
  record it was checked against. No edits to `frontend/`, `host/`, `api/` or `confirm-gate/`.

**WP4. A demo script.** One page: the walk order, what to click, and the STATUS speech conditions
(C-1, C-2, C-3, C-5, C-7) said aloud. Include one wrong-grain query ("maximum likelihood") to show that an empty
or childish Marble hit means a local objective, not a failure.

## 4. Ask Michael for these (he has the access we do not)

| # | Ask | Needed for | Source |
|---|---|---|---|
| 1 | Fix browser CORS on the education MCP | Any ASFAI use in the deployed app | asfai-education #16; STATUS §2 item 12 |
| 2 | Decide what replaces the closed clarification-receipt PR | Any claim that ASFAI recorded a human answer | issue #14, PR #15 closed unmerged |
| 3 | Where members reach the app; who owns the Vercel project and the worker key | December demo on the deployed site; worker funding | was Stephen's question in `decisions/2026-10-16-google-sign-in-and-drive.md` |
| 4 | Close the three pre-pilot conditions: ASU data classification, a reviewer for partner changes, a no-retention record for the drafting model | Any real teacher files or students | STATUS §2 item 12 |
| 5 | Where student records may live | Class codes, students reaching a course | STATUS §2 item 1; `design/backend-asks.md` #1, #2 |

For strategy B, only #3 matters before December. #1 matters only if members should click Connect ASFAI on the
deployed site. #4 and #5 come before any pilot.

## 5. Decisions owed by Augusto

1. A or B (section 2).
2. Copy for §2 items 10 and 11.
3. Whether raw-API courses should stop auto-confirming objectives (item 2 residual). Trust-core change.
4. Refuse, warn or accept on importing a legacy record with raw text (item 13).

## 6. Parked, and why

- **Sarah Chardonnens.** Her question is which confirmations count as learning. Draft a one-page ask
  (kanban `silicusta-sprint` `t_74bab6e3`, held). Augusto sends it. Build nothing from her ideas until she names
  the checkpoints.
- **Stephen asks** (`t_dcfa4715`): cancelled.
- **Hosting Silicus inside ASFAI.** Silicus is the product; ASFAI is the protocol. A private URL is hosting. It does
  not fix CORS, the receipt, or the Hermes connector login.
- **Students, RA and graduate use.** Unchanged locks (STATUS §5).

## 7. Notes for the agent who runs this

- Hermes kanban workers were dying before any model call on 12 November (`Kanban owner refused`). One-shot
  `hermes -p <profile> chat --query-file <brief> -Q` worked. Check the board before relying on it.
- The code graph project id is `Users-bonorinoa-Hermes-Projects-silicus-asfai-handoff`.
- Commit with the owner's git identity, or Vercel blocks the build (AGENTS.md). A push to `main` deploys.
