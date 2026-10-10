# Lesson plan: Teaching a computer with examples

**Course:** AI literacy — What is a computer that learns?  
**Audience:** Year 3–4 (ages 7–9), mixed ability, no coding  
**Length:** 60 minutes  
**Stakes:** Formative / pilot only — not for report grades  
**Spine:** `lesson-outline.ai-literacy.teaching-with-examples-7-9` v1 — **validated** (`valid: true`)

Assumed teacher materials (stand-in for a short slide deck): everyday-object photos; a mixed “sort pile”; a laptop/tablet with Teachable Machine (or paper-card fallback).

Public map (ages 7–9, Computing / AI): *Patterns and Classification*; *Machine Learning Basics*. *AI Mistakes and Limitations* is nearby (hard unlock after ML basics) — we only *touch* a mistake, we do not claim that whole node. *Data and Information for Computers* is a hard prerequisite of ML basics; this hour treats “examples = what we showed the computer” lightly. If the class has never talked about data, spend 3 minutes in the three-steps block naming it.

**Local outcome (not a public-map node):** train a two-class model, test a new example, compare few vs many examples. The public *Machine Learning Basics* node *mentions* Teachable Machine as suggested evidence; we still treat the lab as a **local, observable doing** so “they heard the three steps” is not the same as “they trained a model.”

---

## Learning outcomes

By the end of the hour, learners will be able to:

1. **Sort and say the rule** — sort a mixed set and explain the rule they used.  
2. **Say the three steps** — examples → pattern → prediction about something new.  
3. **Train and test** *(local)* — train a two-class model, test a new example, say what changed with few vs many examples.  
4. **Talk about a miss** — give one wrong prediction and say the computer only knows patterns from what it was shown.

---

## Timeline (60 min)

### 1. Hook — a machine that seems to know you (6 min)
**Purpose:** Activate everyday experience without treating a chat answer as understanding.

**Teacher:** Show one familiar thing (auto-correct, a video “up next,” face unlock). Ask: *Does it know you, or did someone show it many examples?* Park 3 answers. Do not correct yet.

**Learners:** Name the example and one guess about how it decides.

**Not evidence:** Listening to the hook.

---

### 2. We sort; computers need many examples (10 min)
**Purpose:** Pattern-and-classification in the room.

**Teacher:** Dump a mixed pile (buttons, leaves, animal cards). “Sort these. Then tell me your rule.”

**Learners (pairs):** Sort; write the rule in one sentence.

**Look-fors:** A rule other people could follow; “I just knew” is not enough.

**If stuck:** Give two finished sorts and ask which rule is easier to teach a machine.

---

### 3. Three steps (10 min)
**Purpose:** Shared language before any tool.

**Teacher:** Board: **1. Give examples  2. Find a pattern  3. Guess about something new.** Map the pair-sort onto the three steps. Name “the examples” as *data* in one sentence if that word is new.

**Learners:** Choral then pair: say the three steps in order, with their sort as the example.

**Look-fors:** Order correct; “prediction” = a new thing, not repeating a training card.

---

### 4. Lab — train a two-class model (18 min)
**Purpose:** They *do* training; pair product is practice, not an individual grade.

**Setup:** Teachable Machine (or similar), two classes the school can photograph (e.g. pencil vs eraser, smile vs not). Webcam or a folder of stills.

**Teacher:** Demo 8–10 examples per class, train, test one new object. Then: “Your turn — start with only **three** examples per class, test, then add more.”

**Learners (pairs):**
1. Create two classes; add 3 examples each; train; test a new example; note the guess.  
2. Add examples until each class has ~15; train again; test the **same** new example.  
3. On a scrap: *few examples → …* / *many examples → …*

**Fallback (no webcam / blocked site):** Paper “training cards.” A hidden classmate is the “computer”: they only see cards you show, then guess a new card. Same few-vs-many structure.

**Look-fors:** They can point to *which examples* they showed; they notice a change after adding examples.

**Assistance:** Teacher may click the UI; learners must choose examples and the test object.

---

### 5. Few vs many, and a mistake (10 min)
**Purpose:** A miss is a pattern gap, not a magical failure.

**Teacher:** Harvest 2–3 wrong guesses. Ask: *What had we not shown it?* Deliberately test something **outside** both classes (a third object) if no pair produced a miss.

**Learners:** One sentence: “It got ___ wrong because we only showed it ___.”

**Not evidence of the public ‘AI mistakes’ topic as a whole** — only this one observation.

---

### 6. Individual check-out (6 min)
**Purpose:** One independent account per learner. Pair lab does **not** count as individual evidence.

**Each learner (spoken or sticky note), no helper:**
1. The three steps, in order.  
2. One thing they showed the computer.  
3. One thing it got wrong, or what they would show it next time.

**Teacher:** Tick 1–3; note who needed the three steps prompted. Keep this formative.

---

## Materials

| Item | Notes |
|---|---|
| Sort pile | ~20 mixed objects or printed pictures |
| 1–2 devices | Teachable Machine; offline paper-card fallback |
| Two easy classes | Objects in the room |
| Scrap paper | few vs many; exit notes |
| Optional slides | Hook image; three-steps slide; lab steps |

---

## Evidence (formative)

| Outcome | What you might see | Confounded if… |
|---|---|---|
| Sort + rule | Pair rule sentence | Teacher supplied the rule |
| Three steps | Exit item 1, unprompted | They only repeated the board in the mini-lesson |
| Train/test *(local)* | Lab scrap + you saw them train | Partner did all the clicking and choosing |
| A miss | Exit item 3 or section 5 sentence | They describe a sci-fi failure, not *their* model |

Asking an assistant “what is machine learning?” is **not** evidence for any of the four.

---

## Accessibility / safety

- Webcam: school policy; no faces as training classes unless policy allows. Prefer objects.  
- Motor / vision: teacher or peer as clicker; learner still chooses examples.  
- If a learner is distressed by “the computer got it wrong,” reframe: *we didn’t show it enough yet.*

---

## Teacher confirm (HITL)

This plan is a **draft**. Before you teach it: drop/rename outcomes, swap the two classes, or cut the lab to paper-only. Nothing here is published or saved to a student record.
