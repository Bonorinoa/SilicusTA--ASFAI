# ASFAI Education MCP: repository contract and Marble boundary

**Checked:** 2026-10-06 (MST)
**Repository:** [`redbeard-26/asfai-education`](https://github.com/redbeard-26/asfai-education) at `dac19d3da211e22c3fd6cb4613add16e652131c9`.
**Purpose:** describe the MCP surface implemented in this snapshot, what the docs intend, where Marble enters, and what a Silicus host still has to own.

## Executive summary

ASFAI Education is a separate MCP-first education reference product—not Silicus TA, not an LMS, and not a central student database. Its HTTP MCP route registers nine gateway tools. One gateway, `asfai_graph`, calls a local TypeScript module that fetches Marble's public topic and dependency JSON files from GitHub, indexes them in process memory, and exposes graph search/traversal actions. The ASFAI Learning client uses one authenticated remote ASFAI MCP connector, not an additional Marble MCP.

The connected host remains responsible for teacher interaction, reading source materials, generation, and teacher confirmation. ASFAI validates typed artifacts and provides data/workflow boundaries; a successful schema validation or `ready_to_draft` state is not itself proof a teacher confirmed the result. Private records are caller/user-owned and must be saved and read back through the named storage resource. For Silicus, integrate at schemas and checkpoints while keeping Silicus as the teacher/student product surface.

## 1. Product and HTTP transport

The repository README identifies a deployable Next.js education service with the MCP at `/education/api/mcp`. `src/app/api/[transport]/route.ts` calls `createMcpHandler`, registers tools through `registerAsfaiTools`, and wraps the handler in authentication requiring OAuth scope `asfai`. The route is accountless in the sense described by the project: connector OAuth does not require an ASFAI learner account; private provider/storage grants are separately tenant-bound.

**MCP HTTP path (source-level):**

```text
Host / installed ASFAI Learning client
       │ HTTPS, OAuth scope asfai
       ▼
ASFAI Education /education/api/mcp
       ├── public metadata + graph: asfai_capability, asfai_graph, asfai_run
       ├── caller-owned workflow state: asfai_session, asfai_lesson, asfai_evidence, asfai_resource
       └── authenticated external/private boundary: asfai_storage, asfai_classroom
```

The README and `docs/CAPABILITIES-AND-MCP.md` state that CI tests the exactly-nine-tool default surface. `tests/lessons/mcp-tools.test.ts` checks the actual registered set and separately describes a 172-entry capability catalog. **Do not confuse catalog entries with 172 individually registered MCP tools or infer every catalog workflow has equal implementation maturity.**

| Gateway | Main responsibility in repository documentation/source |
|---|---|
| `asfai_capability` | Discover capability definitions/skills and provide action schemas where published |
| `asfai_graph` | Public graph search, objective lookup, prerequisite neighbors, frontier/path, standard-code mapping check |
| `asfai_run` | Prepare versioned capability instructions and run contracts |
| `asfai_session` | Portable/resumable learner dialogue, rooms, formative quiz actions |
| `asfai_lesson` | Educator/student lesson operations, outline/plan validation and run actions |
| `asfai_evidence` | Assessment/evidence workflows and progress exchange |
| `asfai_resource` | Educator resources, transforms, workflow/job actions |
| `asfai_storage` | Private storage configuration, save locations, persistence/read-back helpers |
| `asfai_classroom` | Provider-neutral classroom import/export/assignment/evaluation exchange |

The exact action names/schemas are versioned and distributed through gateway action + payload; callers should ask `asfai_capability/action_schema` where supported rather than guess fields. `docs/EDUCATOR-ARTIFACT-WORKFLOWS.md` specifically says its first contract release publishes six preparation/validation schemas and graph search/alignment verification; other grouped actions are not yet published through `action_schema`.

## 2. Graph and Marble runtime path

### Source fact: a live fetch/cache integration exists

`src/lib/education-graph.ts` sets `TAXONOMY_SOURCE` to `https://github.com/withmarbleapp/os-taxonomy` and fetches the raw GitHub `main` URLs for `data/topics.json` and `data/dependencies.json`. It uses `fetch(..., { cache: "no-store" })`, indexes topic IDs and hard/soft prerequisite/unlock relationships in memory, and caches the graph in a warm process for `86_400_000` ms (24 hours). Search is a lexical/ranked term matcher. Neighbor, frontier and path functions traverse the graph.

`src/lib/register-asfai-tools.ts` registers `asfai_graph` and routes its action names to that module. Its `verify_standard_alignment` action states the limitation explicitly: it verifies that a code is mapped to the objective in the current Marble graph; it does not verify the official standards wording and does not prove a prior lesson plan actually consulted the graph.

**This is an active ASFAI Education integration with Marble's public data, but it is not evidence of a Marble-operated API, nor a separate Marble MCP connector.** The service fetches static public files. `docs/ASFAI-PRIOR-ART.md` discusses an older, separate `asfai-constitution` implementation that vendored two Marble JSON files; do not confuse that historical architecture with this Education repo's current runtime fetch/cache.

### Documented ontology boundary

`docs/TAXONOMY-AND-DATA-SOURCES.md` says not to treat a single public taxonomy as universal truth. It proposes three connected layers:

```text
canonical assessable objectives
       ↓
source/framework alignments
       ↓
local courses, activities, projects, resources
```

Marble is described as a useful seed for discovering topics and traversing prerequisites, not a complete objective, evidence, student-state, rubric, or LMS model. ASFAI recommends preserving IDs and provenance in documented imports, and not copying the full dataset into its repo by default. `docs/CAPABILITIES-AND-MCP.md` and the README say the upstream fetch/cache remains in use and Marble taxonomy files are not copied into the catalog/deployment.

### Reproducibility caveat

The inspected implementation fetches mutable `main` URLs. Its 24-hour in-memory TTL is a runtime cache, not a release pin, durable snapshot, or manifest-hash verification mechanism. A course package requiring reproducible proposals should record the exact taxonomy version/source checksum or its own reviewed snapshot. That is a design recommendation; this source revision does not implement that pinning.

## 3. Data ownership and non-model boundary

`docs/ARCHITECTURE.md`, `docs/STORAGE-AND-MCP.md`, and the code describe a sharp separation:

- **Public/cacheable:** graph metadata and capability definitions.
- **Private:** learner profiles, sessions, attempts, reports, teacher workspaces and course materials. These are stored in storage the user/owner controls, not retained as ASFAI's fallback education record.
- **Classroom:** provider bridge and roster/context transport; Classroom is not the source of truth for mastery.
- **AI host:** performs document interpretation, extraction, retrieval judgment, tutoring, generation, and assessment. ASFAI does not claim to run a backend OCR, embeddings, retrieval, tutoring or answer-generation model.

The `asfai_storage` workflow returns portable state/storage pointers and expects the host to save and independently read back the value before it reports persistence succeeded. Without a compatible store, private persistence remains pending rather than silently moving into an ASFAI database.

`docs/DATA-MODEL.md` describes a larger architectural model (objective, evidence events, claims, learner-objective state). Treat it as a model/design contract, not proof the MCP stores a central learner ledger. The runtime and docs emphasize caller-owned state.

## 4. Teacher authoring and human checkpoints

`docs/EDUCATOR-ARTIFACT-WORKFLOWS.md` describes the host/MCP split: the connected assistant reads attachments and creates draft prose; ASFAI preparation actions return missing-information questions and validators check typed results. The MCP does not claim to render or retain the teacher's draft. It describes a `clarifying → ready_to_draft → draft → reviewed` state model, with explicit review before publication.

Operational implications for a Silicus host:

1. The host must actually ask the teacher for missing course, audience, objective, or material context, then stop for the teacher's response. Do not fill missing fields yourself to push a tool into `ready_to_draft`.
2. A proposal is not confirmation. The host must surface objective and lesson-plan proposals for teacher accept/edit/drop/add decisions and persist the resulting teacher choices/provenance in Silicus's product records.
3. `validate_outline` or `validate` returning valid means the submitted payload passes a schema/logic contract; it is not evidence that a human reviewed it.
4. The preparation artifact's “decision trace” is an audit aid in a portable returned object, not a hidden MCP-side interaction history database.
5. Tool annotations may be conservative at whole-gateway level. The docs note `asfai_lesson` may be marked mutating because of separate artifact relay operations even when `prepare_outline` is read-only; inspect per-action behavior and require confirmation for real external mutations.

This boundary aligns with Silicus's teacher-confirmation checkpoints. It is a host/product responsibility, not something to infer from an AI draft or graph match.

## 5. Licensing and publication

The ASFAI repo's own code/docs are Apache-2.0 only where contributors can license them. `docs/LICENSING.md` explicitly says Apache-2.0 does not relicense third-party taxonomy, standards, media, or learner records. For Marble, it names ODbL 1.0 for the database and CC BY-SA 4.0 for Marble-authored text. `withmarbleapp/os-taxonomy/PROVENANCE.md` separately lists upstream rights for standards included or referenced in the standards JSON.

Therefore, do not put Marble or third-party standards data into an Apache-only package without keeping attribution, data lineage, exact source terms and any share-alike/redistribution obligations. For Silicus implementation, keep local objectives and original application code separable from imported/aligned third-party material; get qualified licensing review before redistributing a derivative database or standard text.

## 6. What this means for Silicus TA 3.0

- **Silicus is the product; ASFAI is a native protocol/records integration.** Avoid reimplementing ASFAI gateways inside Silicus and avoid reducing Silicus to a plugin wrapper.
- **Do not bind durable course/learner state only to `mt_*`.** Keep stable local objective IDs/statements and optional, versioned Marble alignments.
- **Local objectives are first-class.** Empty, overly broad, or age-mismatched graph results should lead to teacher-named local outcomes, not authoring refusal or forced Marble binding.
- **A Marble `evidence` string/assessment prompt is an authoring aid, not a formal rubric or mastery claim.** Student chat is not student evidence; teacher onboarding is distinct from student use.
- **Own confirmation UX and durable course packages in Silicus.** ASFAI validates portable structures and serves public graph information; it does not store Silicus's proposed course/lesson history for it.
- **Keep the first product slice constrained to ages 5–14.** Marble is an optional menu, not a required ontology for higher education; university examples are architecture stress tests and should use local outcomes.

## 7. Checked source paths

All ASFAI links below are pinned to checked commit `dac19d3da211e22c3fd6cb4613add16e652131c9` so the paths remain reproducible:

- [`README.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/README.md) — project boundary, current architecture, `/education/api/mcp` route.
- [`src/app/api/[transport]/route.ts`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/src/app/api/%5Btransport%5D/route.ts) — authenticated MCP HTTP transport.
- [`src/lib/register-asfai-tools.ts`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/src/lib/register-asfai-tools.ts) — nine gateways, actions, routing, graph alignment check.
- [`tests/lessons/mcp-tools.test.ts`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/tests/lessons/mcp-tools.test.ts) — registered-surface assertion and catalog distinction.
- [`src/lib/education-graph.ts`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/src/lib/education-graph.ts) — raw Marble data fetch, process cache, graph operations.
- [`docs/CAPABILITIES-AND-MCP.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/docs/CAPABILITIES-AND-MCP.md) — default gateways, catalog distinctions, no-vendoring statement.
- [`docs/STORAGE-AND-MCP.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/docs/STORAGE-AND-MCP.md) — user-owned storage and graph source/cache documentation.
- [`docs/TAXONOMY-AND-DATA-SOURCES.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/docs/TAXONOMY-AND-DATA-SOURCES.md) — three-layer ontology and Marble role.
- [`docs/EDUCATOR-ARTIFACT-WORKFLOWS.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/docs/EDUCATOR-ARTIFACT-WORKFLOWS.md) — preparation/validation/review workflow and host responsibilities.
- [`docs/LICENSING.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/docs/LICENSING.md) and [Marble `PROVENANCE.md`](https://github.com/withmarbleapp/os-taxonomy/blob/main/PROVENANCE.md) — source-specific license boundary.
- [`docs/ASFAI-PRIOR-ART.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/docs/ASFAI-PRIOR-ART.md) — older vendored-data predecessor, clearly separate from the current Education repo fetch/cache.

**Bottom line:** ASFAI Education already integrates the Marble taxonomy by fetching and caching its open JSON graph behind `asfai_graph`; it does not turn Marble into the MCP, a student database, or an LMS. Silicus should natively consume ASFAI's schemas and checkpoints while keeping its own teacher-facing product, local objectives, course state, and human confirmation gates.