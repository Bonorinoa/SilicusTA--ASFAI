# What a teacher can edit (inventory)

Owner decision, 18 Nov: "everything generated should be editable". The AI proposes, and the teacher may change
any proposed content. Each edit of the lesson plan is one chained `plan.edited` event: the field path, the hash
of the value it replaced, and the cleaned new value. It is the same event on the Node host and in the browser
host, and `frontend/src/browser/browserHost.test.ts` checks that both logs match byte for byte. The code that
decides what is editable is `host/plan-edit.mjs` (`EDITABLE_PATHS`).

| What the teacher sees | Editable | Since | Path |
|---|---|---|---|
| Objective proposals | yes (accept, rename, reword, drop, add) | before N3 | gate decisions |
| Plan title | yes | N3 | `title` |
| Evidence for the session | yes | N3 | `sessions.N.evidence.whatLearnerProduces` |
| Activity title, minutes, phase, learners first, learners, teacher, then they decide, AI status, without AI, evidence, not evidence | yes | N3 | `activities.N.<field>` |
| Objectives an activity cites (only the confirmed objectives) | yes | N5 | `activities.N.objectiveIds` |
| Later review: what changes, prompt | yes | N3 | `spacedReviews.N.whatChanges`, `.prompt` |
| Later review: timing (days) and form | yes | N5 | `spacedReviews.N.afterDays`, `.form` |
| Add, remove or reorder activities (one per save; the K2 minutes check re-runs) | yes | N5 | `activities.add`, `activities.N.remove`, `activities.N.moveTo` |
| Skill map: the "why" line beside each suggested part | **no, on purpose** | | |
| Skill map: thread names | **no, on purpose** | | |

The skill-map "why" lines and thread names are read-only on purpose. They explain a choice (which part of
the map to teach from). They are not lesson content, and none of them reaches the plan or the published
version. The teacher responds to them by choosing or not choosing a part, not by rewording them.
`READ_ONLY_GUIDANCE` in `host/plan-edit.mjs` lists them, and a test checks that no editable path touches them.

Not in this table: who authored a proposal, as stored in the record (C4). That waits for the owner.
