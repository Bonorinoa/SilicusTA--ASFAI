# Marble Skill Taxonomy and ASFAI Education: what is open and how they connect

**Checked:** 2026-10-06 (MST)
**Primary sources inspected:** `withmarbleapp/os-taxonomy` at `96a7933754af672e1bfdbf7ecb05c325860c6e0d`; `redbeard-26/asfai-education` at `dac19d3da211e22c3fd6cb4613add16e652131c9`. These are separate products/repos.

## Executive summary

Marble’s relevant open-source release is the **Marble Skill Taxonomy**, a versioned, static JSON learning graph—not a hosted learning service or an MCP. ASFAI Education has a concrete runtime integration: its `asfai_graph` MCP gateway calls code that fetches Marble’s public `topics.json` and `dependencies.json`, caches the parsed graph in a warm server process for 24 hours, and serves search/traversal actions. That is distinct from exposing a Marble-operated API or separate Marble MCP connector.

For Silicus TA 3.0, use Marble as an optional public alignment/graph source, while teacher-confirmed local outcomes, versioned course materials/plans, and Silicus task/checkpoint behavior remain product-owned. Empty or wrong-grain graph matches should not block teaching.

## 1. What Marble publishes

**Repository:** [github.com/withmarbleapp/os-taxonomy](https://github.com/withmarbleapp/os-taxonomy), produced by Marble / Generative Spark, Inc. README identifies v1: 1,590 micro-topics, 3,221 prerequisite relationships, eight subject areas, ages approximately 4–15. It is a connected graph, with topic IDs (`mt_…`), descriptions, age ranges, evidence suggestions, assessment prompts, standards references, and hard/soft prerequisite edges with rationales.

Repository data and schemas include:

- `data/topics.json` — topic nodes
- `data/dependencies.json` — prerequisite edges
- `data/curriculum-standards.json` — standards and references
- `data/clusters.json` — domain summaries
- `data/manifest.json` — release counts and file SHA-256 checksums
- `schema/*.schema.json`, `scripts/validate.mjs` — schemas and dependency-free validator

The repository describes the release as “pure data — no runtime, no dependencies.” It explicitly excludes semantic embeddings and child/user mastery data. The interactive visualization is linked from the README at [withmarble.com/curriculum](https://withmarble.com/curriculum); it is not the data API required by ASFAI’s implementation.

### Licensing is layered

The upstream README and `LICENSE`, `LICENSE-CONTENT`, `PROVENANCE.md` say:

- Database/collection/relationships: **ODbL 1.0** (attribution; share-alike obligations for derivative databases).
- Marble-authored text: **CC BY-SA 4.0** (attribution and share-alike for adaptations).
- Extracted curriculum standards are **not relicensed by Marble**. Each retains upstream terms. `PROVENANCE.md` distinguishes full-text material from codes-only records: e.g. NGSS, C3 and IB PYP are codes-only in the published data pending permissions; UK National Curriculum and Common Core text are included under their respective terms. Check the upstream provenance and current license before redistribution.

These are source-reported terms, not legal advice. Do not assume the ASFAI repo’s Apache-2.0 license applies to Marble data or third-party standards. The taxonomy README says a produced work/product can be used commercially, but derivative database obligations still need design and legal review for any redistribution.

## 2. ASFAI Education MCP and the actual integration

**Repository:** [github.com/redbeard-26/asfai-education](https://github.com/redbeard-26/asfai-education), inspected at commit above. ASFAI Education describes an MCP-first education architecture with accountless/user-owned private storage boundaries; it is not Silicus TA and is not an LMS.

`src/lib/register-asfai-tools.ts` defines nine default MCP gateway tools; `tests/lessons/mcp-tools.test.ts` asserts the registered surface is exactly those nine. The HTTP transport is wired in `src/app/api/[transport]/route.ts`, which requires an OAuth token with scope `asfai`. The repo README identifies the deployed route as `/education/api/mcp`.

| Gateway | Documented domain |
|---|---|
| `asfai_capability` | capability discovery and skill routing |
| `asfai_graph` | public learning-graph lookup and traversal |
| `asfai_run` | versioned capability-run preparation |
| `asfai_session` | resumable learner sessions, rooms, quizzes |
| `asfai_lesson` | lesson authoring, validation, review, publication/run actions |
| `asfai_evidence` | assessment/evidence transforms and progress exchange |
| `asfai_resource` | educator resources and workflow artifacts |
| `asfai_storage` | user-owned private storage operations |
| `asfai_classroom` | provider-neutral classroom exchange |

This table is the repository’s documented contract surface; it does not imply that every catalog capability has a dedicated tool or that every listed action should be called without its own schema, state-owner, and confirmation requirements. The `asfai_graph` action set includes program listing, objective search/get, neighbors, program objectives, frontier, path, and standard-alignment verification. See `docs/CAPABILITIES-AND-MCP.md`, `docs/STORAGE-AND-MCP.md`, and `src/lib/register-asfai-tools.ts` for routing and action details.

The current `asfai_graph` runtime fetches the full upstream v1 topics/dependencies data files rather than a version-pinned reviewed subset; this is distinct from the docs’ recommendation to use a small reviewed subset as a future prototyping/import strategy. The deployment docs say taxonomy files are not copied into the image/repository. Pinning a release/checksum or creating a subset would be a deliberate reproducibility/license design change, not current behavior.

Implementation trace:

```text
Marble GitHub JSON (topics + dependencies)
     ↓ raw GitHub fetch in src/lib/education-graph.ts
ASFAI server-process cache (24h TTL; in-memory graph indexes)
     ↓ search / lookup / neighbors / frontier / path
asfai_graph MCP gateway in src/lib/register-asfai-tools.ts
     ↓ called by an authorized host
Teacher/learner-facing application workflow
```

`src/lib/education-graph.ts` names the upstream source and fetches:

- `https://raw.githubusercontent.com/withmarbleapp/os-taxonomy/main/data/topics.json`
- `https://raw.githubusercontent.com/withmarbleapp/os-taxonomy/main/data/dependencies.json`

It constructs in-memory ID, prerequisite, and unlock maps; the cache TTL is `86_400_000` ms. Searches use lexical/ranked text matching, not evidence of a semantic vector search. Graph methods use topic IDs and prerequisite structure. `verify_standard_alignment` explicitly says it verifies only that a cited code is mapped in Marble’s graph; it does not verify the official standards text or prove a plan consulted the graph.

**Important distinction:** this is an actual ASFAI Education runtime fetch/cache of Marble data, but the code inspected is not a separate Marble-hosted API dependency and the ASFAI Learning plugin exposes one remote ASFAI MCP connector—not an extra Marble MCP. A third-party `taxonomy-mcp` repository surfaced in research, but it is not shown as an ASFAI-owned or required integration in these source paths.

## 3. Intended ontology boundary

`docs/TAXONOMY-AND-DATA-SOURCES.md` explicitly says not to treat a single public taxonomy as universal truth. It recommends three connected layers:

```text
canonical assessable objectives
        ↓
framework/source alignments
        ↓
local courses, activities, projects, resources
```

The doc calls Marble a useful seed for discovery and prerequisite traversal, but says a topic is not always a sufficiently precise observable objective, evidence prompts are not formal rubrics, Marble has no student/evidence/mastery/roster record model, and redistribution carries licensing duties. It recommends documented import/transformation, preserving IDs and provenance, and not copying the whole dataset into the ASFAI repo by default. `docs/LICENSING.md` keeps original code/docs under Apache-2.0 while retaining third-party data terms.

## 4. Product implications for Silicus TA 3.0

1. **Keep the product split:** Silicus owns the teacher/student surface, named tasks, materials/course packages, checkpoints, and any teacher-confirmed local objectives. ASFAI is an independent records/protocol product and native integration target.
2. **Do not key course or learner state solely by `mt_*`.** Preserve optional Marble alignment, but retain stable Silicus/course-local objective IDs and teacher-authored statements.
3. **Make public graph use optional and reviewable.** A match is a proposal/reference, not teacher approval; teacher accepts, edits, drops, or adds objectives before a confirmed plan.
4. **Handle coverage gaps normally.** Marble v1 is aimed at primary/elementary ages. Empty or inappropriate matches on high-school/university topics should route to a teacher-named local outcome, not force a `mt_*` binding.
5. **Do not treat prompts or chat as learning evidence.** Marble evidence/assessment prompts are suggestions. Student chat is not mastery. Silicus checkpoints remain human-in-the-loop; ASFAI’s graph does not decide.
6. **Avoid blind vendoring.** The current ASFAI code fetches from the mutable `main` URLs and applies a 24-hour runtime cache. That is convenient but raises reproducibility/availability questions for Silicus: pin release/commit and verify manifest hashes if a stable course package/export requires repeatable graph snapshots. This is a recommendation, not an assertion that current ASFAI has implemented pinning.
7. **Preserve licensing/provenance** if copying, transforming, or redistributing data; separate original Silicus code and locally authored objectives from Marble-derived database/text, with attribution and source-specific standard terms.

## 5. Open questions to resolve before architecture freeze

- Does the deployed ASFAI service’s environment and failure behavior match this checked source revision when GitHub is unavailable or the cache expires?
- How will an exported course record the exact Marble dataset revision/checksum used for a proposal or alignment?
- What are the precise distribution obligations if Silicus stores selected Marble-derived rows or creates a derivative database? Obtain qualified licensing review.
- Which standard-text sources may be redistributed in a given Silicus package, beyond storing codes and mappings?
- What teacher-facing wording makes the public graph’s age/grain limits visible without asking teachers to become competency-framework designers?

## Sources (direct paths)

### Marble
- [README.md](https://github.com/withmarbleapp/os-taxonomy/blob/main/README.md) — scope, data layout, examples, licensing, exclusions.
- [`data/manifest.json`](https://github.com/withmarbleapp/os-taxonomy/blob/main/data/manifest.json) — version, counts, source list, checksums.
- [`data/topics.json`](https://github.com/withmarbleapp/os-taxonomy/blob/main/data/topics.json) and [`data/dependencies.json`](https://github.com/withmarbleapp/os-taxonomy/blob/main/data/dependencies.json) — published graph data.
- [`LICENSE`](https://github.com/withmarbleapp/os-taxonomy/blob/main/LICENSE), [`LICENSE-CONTENT`](https://github.com/withmarbleapp/os-taxonomy/blob/main/LICENSE-CONTENT), [`PROVENANCE.md`](https://github.com/withmarbleapp/os-taxonomy/blob/main/PROVENANCE.md), [`CHANGELOG.md`](https://github.com/withmarbleapp/os-taxonomy/blob/main/CHANGELOG.md) — license and source caveats.

### ASFAI Education
- [`docs/TAXONOMY-AND-DATA-SOURCES.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/docs/TAXONOMY-AND-DATA-SOURCES.md) — Marble’s role and proposed layered ontology.
- [`docs/STORAGE-AND-MCP.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/docs/STORAGE-AND-MCP.md) — public graph and runtime source description.
- [`docs/CAPABILITIES-AND-MCP.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/docs/CAPABILITIES-AND-MCP.md) — nine gateway catalog, capability/catalog vs tools distinction, graph fetch note.
- [`docs/LICENSING.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/docs/LICENSING.md) — separate code/data licenses and provenance expectations.
- [`src/lib/education-graph.ts`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/src/lib/education-graph.ts) — concrete raw GitHub fetch, 24-hour process cache, in-memory graph search/traversal.
- [`src/lib/register-asfai-tools.ts`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/src/lib/register-asfai-tools.ts) — registered gateway names/actions and routing.
- [`docs/ASFAI-PRIOR-ART.md`](https://github.com/redbeard-26/asfai-education/blob/dac19d3da211e22c3fd6cb4613add16e652131c9/docs/ASFAI-PRIOR-ART.md) — historical, separate earlier implementation that vendored two Marble JSON files; do not confuse it with the current Education repo’s remote fetch/cache.

---

**Bottom line:** Marble is an openly published but multiply licensed, bounded K–12 skill graph. ASFAI Education actively fetches and serves that graph through `asfai_graph`, while leaving learner/private state in separate owner-controlled storage and distinguishing Marble alignments from canonical objectives. Silicus should integrate at those data and confirmation boundaries—Marble is a helpful menu, not the product, course database, or grading authority.