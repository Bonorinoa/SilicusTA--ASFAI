# Lesson-planning object (for the MCP)

**From:** Augusto (usefulness / lesson planning)
**To:** Stephen (infra), Michael (repo)
**Date:** 2026-09-02
**Status:** implement against this; bikeshed names if needed, not the splits

This is the minimum object graph the December prototype must speak. It is aligned to existing `asfai-education` records (`CourseKnowledgePackage`, `CourseMaterialVersion`, local vs public objectives, prepare-then-confirm). Cloudflare vs current AWS host is a deploy choice. **Do not key learner or course state only on Marble `mt_*` IDs.**

## Non-goals (December)

- Student accounts or a central student dossier
- Writing new nodes into Marble / Open Map
- Required embeddings (optional later)
- RA / graduate / university as the *pilot story* (university corpora are a *stress test* only)
- GUI as the runtime (ChatGPT / Codex calling MCP is the runtime)

## The four records

```text
CoursePackage 1──* MaterialVersion
      │
      └──* ObjectiveRef     public (Marble) | local (this course)
                ▲
LessonPlan ─────┘  each Activity cites ObjectiveRefs + MaterialVersions
```

Teacher confirms at each gate. AI proposes; it never publishes.

### 1. CoursePackage

| Field | Notes |
|---|---|
| `courseId` | URN, stable |
| `version` | integer; never overwrite, always bump |
| `title`, `description` | |
| `status` | `draft` \| `published` \| `retired` |
| `owner` | teacher identifier (not an ASFAI account required) |
| `objectiveRefs[]` | confirmed only |
| `materials[]` | see below |
| `retrievalModes[]` | `host_native` \| `lexical` \| `direct_reading` (embeddings optional, not required) |

### 2. MaterialVersion

Teacher content only. **Reject or quarantine files that look like student work** (names, grades, submissions).

| Field | Notes |
|---|---|
| `id`, `materialId`, `version` | immutable version |
| `title`, `mediaType` | |
| `locator` | R2 key / URL / Pod href |
| `sha256`, `bytes` | |
| `pages[]` / `chunks[]` | page-aware if the host can extract |
| `provenance` | extractor, time, host |

### 3. ObjectiveRef

```json
{
  "id": "urn:uuid:…",
  "kind": "public" | "local",
  "publicId": "mt_…",
  "statement": "Train a 2-class model in Teachable Machine and say what the examples did.",
  "alignment": {
    "publicId": "mt_…",
    "relationship": "closeMatch" | "relatedTo" | "exactMatch",
    "confirmedByEducator": true
  },
  "confirmedByEducator": true
}
```

- `kind: public` → `publicId` required (Marble).
- `kind: local` → `statement` required; `alignment` optional.
- Unconfirmed proposals must not appear on a published lesson plan.

### 4. LessonPlan

The usefulness object. Not a chat transcript.

```json
{
  "id": "urn:uuid:…",
  "courseId": "…",
  "courseVersion": 1,
  "title": "…",
  "audience": { "ageRangeStart": 7, "ageRangeEnd": 9 },
  "status": "draft" | "confirmed",
  "activities": [
    {
      "id": "…",
      "title": "Sort smart vs not-smart devices",
      "minutes": 15,
      "objectiveIds": ["…"],
      "materialVersionIds": ["…"],
      "learnerDoes": "…",
      "teacherDoes": "…",
      "evidenceIfAny": "none | observation | work-product",
      "notEvidence": "Asking the assistant a question is not evidence."
    }
  ]
}
```

`status: confirmed` only after an explicit teacher yes.

## Teacher checkpoints (protocol, not manners)

The MCP (or the host following a skill) must stop and wait at:

1. **Files** — “These N files will be course materials. Student work? Wrong file?”
2. **Outline** — proposed sequence from the syllabus/slides; teacher edits.
3. **Objectives** — proposed public matches + proposed locals; teacher accept / rename / drop / add.
4. **Plan** — the `LessonPlan` JSON (or a readable rendering of it); teacher confirms.
5. **Publish** — bump `CoursePackage.version`, set plan `confirmed`.

Preview-then-confirm on 4–5. No silent publish.

## Suggested MCP surface (map to existing ASFAI names if we extend that server)

Keep the callable set small:

| Tool / action | Does |
|---|---|
| `create_course` / `version_course` | package |
| `add_material` | teacher file → stored object + metadata |
| `propose_objectives` | returns *proposals* (`confirmedByEducator: false`) |
| `confirm_objectives` | teacher decisions |
| `propose_lesson_plan` | draft `LessonPlan` |
| `confirm_lesson_plan` | gate |
| `get_course` / `export_course` | full JSON round-trip |

Do **not** add `write_to_marble`. Teacher-invented skills stay on the course.

If this is a new Cloudflare worker rather than `asfai-education`, **the JSON above is still the contract.** Silicus 3.0 will call this, not your D1 tables.

## Storage

| What | Where |
|---|---|
| Schemas, code | Git repo |
| Marble Open Map | fetch/cache; do not fork into D1 as the writable ontology |
| Teacher materials | hosted object store OK for prototype (R2); teacher-only |
| Course + lesson JSON | D1 or equivalent, versioned |
| Student progress | **not here.** Optional later: teacher’s own Sheet via Google connector |

## December success (MCP)

A teacher, in ChatGPT or Codex, can: upload materials → confirm objectives (including at least one **local**) → confirm a lesson plan → export JSON. A second host can load that export.

University PDFs (ECON 167) may be used as a **stress test** that locals work. The gathering demo should be 5–14 / AI-literacy (Marble 21 + locals).
