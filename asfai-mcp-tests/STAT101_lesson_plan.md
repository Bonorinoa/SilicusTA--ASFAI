# Lesson plan: From Sample Stories to Sampling Variability

**Course:** Introductory Statistics (STAT 101 / first-year undergraduate)  
**Audience:** University freshmen (gen-ed or social-science track); HS algebra; no calculus  
**Length:** 75 minutes · early unit  
**ASFAI outline:** `lesson-outline.undergrad-stats.descriptive-sampling-variability` v1 — **validated** (`valid: true`)  
**Stakes:** Formative / pilot only (not for consequential grading)

---

## Learning outcomes

By the end of class, students will be able to:

1. **Summarize a sample** — compute and interpret sample mean, median, and standard deviation in context.
2. **Separate targets from estimates** — distinguish a population parameter from a sample statistic and explain why a statistic can change from sample to sample.
3. **See variability** — use a simple repeated-sampling activity to describe the center and spread of sample means qualitatively (no formal CLT).
4. **Speak carefully** — identify and correct the misuse of treating one sample mean as if it were the certain population mean.

> Public ASFAI Marble graph had no undergrad-specific nodes for this topic, so outcomes are **local** (scoped course IDs), with a light GAISE-college alignment note only.

---

## Materials

| Item | Notes |
|---|---|
| Mini-dataset (~20 values) | e.g. student commute times (minutes) |
| Finite population deck | ~40 index cards with the same variable for sampling lab |
| Calculator / spreadsheet | optional |
| Board / shared doc | class dotplot of sample means |
| Exit tickets | paper or 3-item LMS form |

---

## Timeline (75 min)

### 1. Hook — one number, many stories (8 min)
**Purpose:** Activate prior ideas about averages; surface uncertainty about generalizing from one sample.

**Teacher moves**
- Project: “Campus survey, n = 20, mean commute = **24 minutes**.”
- Ask (do not correct yet): *What does this tell us? What doesn’t it?*
- Park 3–4 student claims on the board.

**Students do**  
Say what the average seems to mean about *all* students on campus, and name one uncertainty.

---

### 2. Mini-lesson — mean, median, SD in context (18 min)
**Purpose:** Shared language for sample summaries.

**Teacher moves**
- Same mini-dataset on the board/table.
- Compute **mean** and **median** together; ask when they diverge (skew / outlier).
- Introduce **SD** as a *typical distance from the mean*, in the data’s units — not “the average error of the mean.”
- Model one interpretation sentence: *“In this sample, a typical commute is about X minutes away from the average.”*

**Students do (pairs)**  
Write one plain-language sentence each for mean, median, and SD. Flag one value that pulls the mean.

**Look-fors:** units present; SD not misread as SE; outlier effect noted.

---

### 3. Parameter vs statistic (10 min)
**Purpose:** Give later inference a clean landing pad.

**Teacher moves**
- Population vs sample; **parameter** (often unknown) vs **statistic** (from data in hand).
- Map: today’s sample mean = statistic.
- Four quick labels (parameter / statistic / not enough info).

**Students do**  
For each statement, choose a label and justify in one sentence.

Example prompts you can use:
1. “The mean commute of *all* enrolled students this term.” → parameter (if that population is intended)
2. “The mean of our n = 20 survey.” → statistic
3. “The true proportion of students who bike.” → parameter
4. “24 minutes is exactly how long every student commutes.” → neither / false claim

---

### 4. Lab — many samples, many means (22 min)
**Purpose:** Make sampling variability *visible*.

**Teacher moves**
1. Finite population of ~40 cards (commute times). Optionally announce the population mean after means are posted.
2. Each pair draws SRS of **n = 5**, computes sample mean, posts a dot on the class **dotplot of means**.
3. Facilitate noticing:
   - means **differ** across pairs;
   - they **cluster**;
   - optional 2-minute demo: one pair repeats with **n = 10** → less wild means.
4. Vocabulary pin: *sampling variability* of the sample mean.

**Students do**  
Draw sample → mean → plot → write (1) how your mean compares to others, (2) what would happen if every pair could sample many times.

**Important evidence note:** this is **collaborative** evidence of participation/process. Individual mastery waits for the exit ticket.

---

### 5. Discussion — the overconfident headline (8 min)
**Purpose:** Practice responsible communication.

**Bad headline:** “Campus commute is exactly 24 minutes.”

**Students do**  
Rewrite so it does not pretend one sample mean is the certain population value.  
(Good shape: sample size, estimate language, uncertainty / variability.)

---

### 6. Exit ticket — individual check (9 min)
**Purpose:** Individual formative evidence of the outcomes.

**Items (suggest)**
1. For `{12, 13, 14, 15, 40}`: mean vs median — which is larger and why?
2. Label: “Average height of all first-years at the university” vs “Average height in a random sample of 30 first-years.”
3. One sentence: why can two random samples from the same population have different means?

**Scoring policy:** formative only; no consequential grade. Spot-check misconceptions same day or next class opener.

---

## Differentiation & access

- Dataset as large-print / digital table  
- Calculator or spreadsheet allowed  
- Oral exit-ticket option  
- Dotplot must not rely on color alone  

---

## What this lesson deliberately does *not* do

- No formal sampling distribution math / CLT proof  
- No confidence intervals yet (natural **next** lesson)  
- No high-stakes grading of today’s exit ticket  

**Natural sequel:** “From the dotplot of means to a confidence interval for the mean.”

---

## ASFAI run notes (for the host, not for students)

- Flow used: `asfai_capability` → `education-lesson-authoring` → `asfai_lesson.prepare_outline` → host draft → `validate_outline` ✅  
- `asfai_graph.search_objectives` returned no undergrad matches (Marble is K–12-leaning); local outcomes used on purpose  
- Outline is **caller-owned**; not saved to a Pod unless you connect storage and explicitly save  
- Full published lesson package (immutable artifacts, assessment methods, report config) is a follow-on via `prepare_authoring` → `validate` → `review` after you approve this outline

---

## Mini-dataset starter (commute minutes, n = 20)

```
18 22 25 19 30 27 21 24 23 40
15 28 26 20 22 35 17 24 29 16
```

Rough teacher key (compute live with the class rather than spoiling): mean ≈ 24.05; median = 23.5; clear right skew from 35/40.

Population deck: duplicate/extend these values to ~40 cards so pairs can sample without depleting the story.
