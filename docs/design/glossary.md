# Silicus glossary and copy contract (sprint weekend-share, 2026-10-16)

One meaning per word, everywhere: UI copy, rail rows, student helper, landing page, docs. Owner feedback: the
hierarchy "course vs lesson plan vs something else" was unclear, so the student helper's scope was confusing.
This file is the contract; a lane that needs a new term adds it here first.

## The hierarchy (what a teacher builds)

```
Course            the thing in "Your courses": a title, who it is for, and the teacher's materials list
 └─ Brief         the teacher's own answers: topic, who it is for, what learners should be able to do
     └─ Objectives    what learners should be able to do, each confirmed by the teacher
         └─ Lesson plan   activities with minutes, each citing confirmed objectives
             └─ Version N   a published (sealed) copy of objectives + lesson plan. Students use this.
```

- In this prototype a course holds ONE lesson plan. Say so where it matters ("One lesson per course in this
  prototype"); do not imply multi-lesson courses exist.
- "Outline" is retired as a teacher-facing word. The checkpoint the gate calls `outline` is shown as **Brief**:
  the teacher confirms their own answers, which are on screen at that moment (never a button with nothing to
  confirm). The gate id stays `outline`; only the label changes.
- "Package" is a machine word. Teacher-facing: "the published version". Keep "package" only inside Record details
  and the export file name.
- "Sealed": use "published" in teacher copy; "sealed" may appear once, in the publish confirmation, explained as
  "it can't be changed; changes become version 2".

## The actors (rail legend and anywhere else)

| Actor | One-line role (legend) | Never |
|---|---|---|
| You | your decisions | — |
| Silicus | keeps the record and the rules | "verified", "secure", "guarantees" |
| Drafting model | proposes and drafts, never decides | "decided", "confirmed", "approved" |
| ASFAI | asks questions about your lesson, checks the plan's format against its shared lesson format and skill map | "approved", "validated your teaching" |

**What "Check the plan with ASFAI" does (say it next to the button, one sentence):**
"ASFAI checks that the plan is in its shared lesson format and that each activity points to an objective. It
does not judge whether the lesson is good." After a run, the button reads "Check again" and the result line says
when it ran ("Checked 2 minutes ago: no format problems").

## The student helper

- Name in UI: **Student helper**. Section title on the published view: "Try the student helper".
- Scope line, always visible above the input (counts from the published version):
  "Answers only from version {N} of this lesson: {k} objectives and {m} activities. It has not read your
  materials, and nothing a student asks is saved."
- Answer labels (under each answer):
  - basis `plan`: "From Objective 2 · Activity 2: Place unit fractions" (existing format).
  - basis `explanation`: "Explains an idea in Objective 2. The explanation is the AI's, not your plan's words."
- Refusal sentences (exact strings; host constants, smokes assert them):
  - `off_topic`: "That isn't part of this lesson. Ask your teacher."
  - `assessment`: "I can't tell you how you're doing. Your teacher decides that."
  - (Retired: "That isn't in this course yet. Ask your teacher." — "yet" promised content that may never come.)

## Objective sources (labels under each proposed objective)

| Label | Who wrote it | Reserved? |
|---|---|---|
| from your answer | teacher (local path) | yes, teacher only |
| from your answer to ASFAI | teacher (ASFAI path) | yes, teacher only |
| your own objective | teacher (added by hand) | yes, teacher only |
| from material: {names} | drafting model, from the teacher's files | model |
| suggested by Silicus | drafting model, complementing the teacher's outcomes | model |

Suggested objectives: the teacher must have at least one outcome of their own first; Silicus suggests at most
three; each one is accepted, reworded or dropped like any other proposal. Button: "Suggest up to 3 more".
Explainer under it: "Silicus reads your outcomes and suggests ones that would round out the lesson. You decide."
