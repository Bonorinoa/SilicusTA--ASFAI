# Silicus TA × ASFAI: orchestrator integration evidence

Date: 2026-10-19 (MST). Baseline Silicus source: `20acaea636d79461275f50a3c7a227089c8b612f`; local `main` and GitHub `origin/main` were read back at the same SHA. Product source and production were not changed. Orchestrator model: `gpt-6.1-sol`, `openai-codex`. Specialists and their actual routes are separately recorded; a successful READY probe was not assumed to prove the requested route.

## 1. Board cleanup — completed and read back

All 47 then-visible completed cards on **Default** were archived, not purged. Previously archived: 12; archive readback: 59. All 47 requested IDs were found in the archive; none missing. No running/blocked/todo cards existed when cleanup began. The `sca2-paper-b` board was not touched. Later readiness cards are new work, not cleanup residue. History, comments, attachments and runs were preserved. See `board-cleanup.json`; detailed CLI snapshot lives in the audit scratch directory.

## 2. Parent's own verification at the frozen SHA

Full commands, individual exit codes and elapsed times: `pm-logs/results.json`. Commands were not piped through another command to manufacture a zero exit.

| Check | Actual result |
|---|---|
| Clean frontend `npm ci` | exit 0 |
| `confirm-gate`: `node --test` | 41 pass, 0 fail; exit 0 |
| `host`: `node --test` | 298 pass, 0 fail; exit 0 |
| Root: `node --test api/test/` | 57 pass, 0 fail; exit 0 |
| Frontend: `npm test` | 53 files, 596 tests pass; exit 0 |
| Frontend typecheck + build | exit 0 |
| Host restart E2E | 53/53; exit 0 |
| Studio real-Chrome smoke | 23/23; exit 0 |
| Browser-mode real-Chrome smoke | 339/339; exit 0 |

These are deterministic/mocked integration checks, not real-provider reliability or pedagogical efficacy. Engineer ran the additional classic-host, narrow-width, dependency and performance audits. The first parent host build failed because the parent's newly created dependency symlink pointed to the wrong directory; correcting that audit-only symlink restored the build. This was not a product defect.

## 3. Live Vercel: actual worker path, not mocked content

URL: `https://silicus-ta.vercel.app/`. `/api/worker/status`: HTTP 200, configured true, passcodeRequired true, ZDR true, provider OpenRouter, model `deepseek/deepseek-v4-flash-0731`.

The saved demo passcode was filled only by the browser vault. It never entered chat, a command, or the evidence files.

### Successful teacher-fixture path

A clearly labelled synthetic audit course, not an actual teacher's approval or student record, went through: brief → two objectives derived from typed outcomes → both accepted → real-model plan → confirm → publish version 1. The successful plan request took **6,186 ms** according to the page's resource timing. The resulting plan named unit fractions, ages 8–9, 30 minutes, two activities; each activity cited the corresponding local objective. The teacher-facing published screen explicitly said the student space was a preview on this device, not a reachable student URL.

An earlier successful plan took 15,138 ms. In that first driver attempt, `fill_input` collapsed the newline between two outcomes; an HTMLTextAreaElement native value setter with a real newline produced two separate proposals in the next attempt. The collapsed proposal was a driver artifact, not evidence of a normalization bug. Including the words 'public audit fixture' in the educational brief also made a draft use that phrase pedagogically; that was contaminated fixture input, not a meaningful lesson-quality sample.

One genuine UI lead: immediately after publish, the page still displayed 'Your turn: review and publish' above the published success state. This was sent to the UX lane for reproduction.

### Real-provider failure — current demo blocker

Later student calls failed. A direct authenticated request to the actual site's `/api/worker` returned:

- HTTP **502**;
- error code **UPSTREAM_ERROR**;
- upstream status **402**.

See `pm-live/direct-worker-probe.json`. No provider was switched, and no missing response was synthesized. The existing provider account needs credit before claiming a reliable real-AI committee demo. `configured:true` is only configuration readiness, not provider headroom.

To avoid repeating plan calls after browser harness resets, the committed public fractions fixture was converted to a verified browser backup using `RecordStore`, `buildBackup` and `readBackup`. One course (version 2) imported successfully on the actual deployed bundle. The displayed lesson was the committed 45-minute, three-activity fractions fixture. Three questions — definition, off-topic and assessment — all subsequently displayed 'Silicus couldn’t answer just now. Try again in a moment.' during the 402 failure. They are **availability failures, not passing refusals**. The failure sequence left IndexedDB plus localStorage byte-identical: 11,365 characters before and after. This proves no writes during those failed questions, not successful answer quality.

The instrumentation attached to `window.fetch` after app startup did not observe the app's previously captured fetch reference; its empty response list is not evidence that no requests left the page. Resource timing showed the requests, and the direct probe established the upstream error. The raw helper response and storage evidence are kept under `pm-live/`.

The browser harness also reset several times to `about:blank`, losing its isolated test context; those are test-infrastructure interruptions, not a demonstrated product persistence failure. All smokes were subsequently green. Final cleanup was read back: zero courses in the isolated browser and no sessionStorage keys. No owner's normal browser records were touched.

## 4. Live native ASFAI MCP

The installed authenticated connector was called, not inferred from a plugin directory:

- `asfai_capability.manifest`: `asfai-learning` 2.0.0, 172 capabilities (33 platform / 88 educator / 51 student), nine default gateway tools.
- `asfai_graph.search_objectives` for fractions returned actual Marble objectives, standards and age ranges. Public IDs remain optional alignment; Silicus's local objective identity remains independent.
- `asfai_storage.status`: `not_connected`, isLoggedIn false, no fallback private store. **No Pod save/load round trip was claimed.** No connection was revoked as cleanup.
- `asfai_classroom.status`, provider Google: configured true, isLoggedIn false, no granted scopes. **No Google Classroom import, assignment publication or grade passback was attempted.**
- `asfai_lesson.prepare_outline` with new mode and no fabricated answers returned `clarifying` with topic, course, audience and outcomes questions. The audit stopped that clarification sequence instead of inventing a teacher reply.
- `asfai_lesson.validate_outline` accepted the existing committed historical statistics outline. This is a schema-validation contract test, not a new teacher confirmation or a representative 5–14 classroom sample.
- `asfai_resource.validate_grounded_answer`: a public unit-fraction chunk with exact page and quote returned valid true; the same fixture with wrong page and invented quote returned valid false, explicitly naming both errors. No external education record was stored.
- The `action_schema` gateway does not publish a schema for `validate_grounded_answer`; its implementation was inspected in current upstream source before constructing that test. This is a discoverability gap, not proof the action is unavailable.

The external MCP tool results are recorded in this conversation. This file summarizes their actual returned fields; it is not a byte-for-byte RPC capture.

### Local vs browser native connection

A fresh local host was started on 8797 with a clean scratch data directory; frontend on 5183. Its status was configured true, ZDR true, DeepSeek 0731. ASFAI was disconnected initially. A new consent URL was generated and handed to the owner. **Fresh local OAuth consent remains pending unless a later exact status readback supersedes this note.** Tokens from existing data directories were not copied, because refresh tokens rotate.

ASFAI CORS was independently rechecked using Origin `https://silicus-ta.vercel.app`:

| Endpoint | Method | Status | Allow-Origin |
|---|---|---|---|
| protected-resource discovery | GET | 200 | `*` |
| authorization-server discovery | GET | 200 | `*` |
| `/oauth/register` | OPTIONS | 204 | absent |
| `/oauth/token` | OPTIONS | 204 | absent |
| `/oauth/revoke` | OPTIONS | 204 | absent |
| `/api/mcp` | OPTIONS | 204 | absent |

See `asfai-cors.json`. Native ASFAI E2E in the Vercel app is not implemented and remains blocked by this browser contract. A stateless proxy would change who handles the answers/token in transit and needs an explicit architecture/governance decision, not a 'turn it on' flag.

## 5. Partner repository: separate product, separate verification

Fresh public clone: `redbeard-26/asfai-education` at `dac19d3da211e22c3fd6cb4613add16e652131c9`.

- `npm ci`, 97 tests in 21 files, lint, plugin build and plugin smoke: exit 0.
- The initial background runner used Node 24 and emitted an engine warning. The tests were then rerun on the required Node **22.22.3**: 97 pass; Next production build exit 0. Both runs are retained and distinguished in `partner-logs/`.
- Dependency advisories were reported by npm; no automatic `audit fix --force` or partner source change was made.

GitHub readback: issue #14 OPEN; clarification PR #15 **CLOSED and not merged**; CORS issue #16 OPEN. Old roadmap wording that PR #15 is awaiting review is stale. No upstream issue or PR was published in this audit.

## 6. Traversal and falsification

Codebase-memory was used to refresh/index Silicus, inspect the architecture, query complexity and trace the outcomes normalization and student-worker paths. A fresh upstream clone was separately indexed and the source-grounded citation validator inspected. Fully qualified symbol names were used when ambiguous short names produced empty or wrong-looking edges. Graph edges and complexity scores were checked against source; synthetic transitive-loop-depth is not a runtime complexity proof. The old indexed partner checkout no longer existed, so it was not used as current evidence.

Parent independently reran the engineer's public-fixture security probe: exit 0, with results in `pm-logs/independent-security-repro.json`. It confirmed raw material persistence through course creation, null JSON returning 500, normal material proposal text remaining transient, acceptance of semantically inappropriate but citation-valid model text, unbounded OAuth refresh preceding MCP timeout, per-instance quota reset behavior, and private-DNS rejection. These findings are not fixed by this audit. Full severity and priorities belong in the final independent verdict and issue list.

## 7. Sharing boundary

Do not describe this as an independently verified, production-ready student service. A guided, public-data-only architecture demonstration can show completed functionality and honest limitations, but **a reliable real-AI demo is currently blocked by provider credit**, and source-retention/availability defects require triage before an unattended trial. A recording or exported lesson must be labelled as such, never passed off as a fresh successful integration run.
