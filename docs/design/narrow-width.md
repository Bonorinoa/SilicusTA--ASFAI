# Narrow widths: the shell holds from 320px

Branch `fix/narrow-shell`. The product owner opened `#/live` in a narrow window and reported "the UI seems
broken": elements squeeze onto one line, text and buttons clip at the edges. This branch is the shell, the
landing and the intake surfaces; the decision / plan / publish cards are a parallel round.

![Before, 380px: the masthead without its promise](img/narrow-380-shell-header-before-landing.png)

*Before. Below 640px the header was the wordmark and nothing else — the promise line had been hidden by a
breakpoint, so the header read as half-finished.*

![After, 380px: the promise takes its own line](img/narrow-380-shell-header-after-landing.png)

*After. The promise is set under the wordmark like a standfirst. Nothing is dropped; nothing is squeezed.*

## How it was measured

`frontend/scripts/narrow-shell.mjs` — a copy of `browser-mode-smoke.mjs`, adapted for layout. It builds the
app with `VITE_SILICUS_MODE=browser`, serves it with **exactly** the headers `vercel.json` sets (strict CSP
included) and the same two mock functions, then drives the whole teacher story through the UI (name the
course → confirm materials → answer the intake → paste material → propose → accept → draft → confirm →
publish → a student asks) so every surface a teacher can reach is on the page. At each width it records:

- `documentElement.scrollWidth` vs `clientWidth` — does the page scroll sideways;
- **every element whose right edge passes the viewport's right edge** (and any starting left of it), named by
  stable structure (aria-labels and tags, never a hashed CSS-module class), with its ancestor chain;
- **every element whose own box is smaller than its content** (`scrollWidth > clientWidth`) — text or a button
  label being cut off. A deliberately hidden control (the 1px file input) is not counted as a clip.

It exits non-zero if any surface this round owns overflows. The model is instant here: this harness measures
layout, not timing.

```sh
node frontend/scripts/narrow-shell.mjs                    # 320, 380, 480, 768, 1440
NARROW_SHELL_WIDTHS=380 node frontend/scripts/narrow-shell.mjs
NARROW_SHELL_SHOT_SUFFIX=after SILICUS_SMOKE_SHOTS=docs/design/img node frontend/scripts/narrow-shell.mjs
```

## The defects, with evidence (before)

Every row below is from the harness on `main` at `e33844f`, at the width in the second column. "Mine" counts
overflowing elements on the surfaces this round owns; the page also carried overflows inside the cards, which
belong to the parallel round.

| # | Surface | Width | Evidence (before) | Cause |
|---|---|---|---|---|
| 1 | Masthead | ≤ 640 px | "The AI proposes. You decide." was **gone**: `@media (max-width: 40rem) { .tagline { display: none } }`. The header was a wordmark with an empty right half | A breakpoint hid the product's first honesty claim instead of re-setting it |
| 2 | Hero steps line | 380 px | Four stacked lines; lines 2–4 each began with a dangling `→` | The inline arrow chain wrapped mid-phrase, and the arrow stays with the wrapped item |
| 3 | Stage header (course title + meta) | 320 px | `h1`, `p.sub` and their wrapper: left 52 → right **347** (295 px wide) in a 320 px viewport | The wrapper had no `min-width: 0`, and `.sub` carries an unbreakable `urn:uuid:…` — the token set the row's minimum width |
| 4 | Course library row | 320 px | Row content 214 > box 182 | The row's text column had no `min-width: 0`, so the long title's minimum width pushed the row |
| 5 | Materials panel | 320 px | The whole section: left 52 → right **328** (276 px) where 216 px was available; the file input alone was 276 px | `input[type=file]`'s own default width set the card's minimum, and the panel — a flex item in a row of buttons — could not shrink below it |
| 6 | Pinned copies row | 380 px | Status span left 290 → right **402**; row content 328 > box 234 | `.pinRow` is a four-column grid, `3rem 9rem 7rem 1fr` — 340 px of fixed columns, wider than the viewport |
| 7 | Material panel, file chooser | 320 px | The browser's own "No file chosen" status truncated to **`N...n`** | Chrome's native file control has no room for its status text in a ~190 px column. Not caught by the harness: the text lives in the control's shadow DOM, so no `scrollWidth` reports it — found by looking at the screenshot |

| State | 320 | 380 | 480 | 768 | 1440 |
|---|---|---|---|---|---|
| landing + onboarding | 0 | 0 | 0 | 0 | 0 |
| onboarding, intake question | **4** | 0 | 0 | 0 | 0 |
| materials panel | **25** | 0 | 0 | 0 | 0 |
| full live course | **6** | **2** | 0 | 0 | 0 |
| record band, delete confirm | **6** | **2** | 0 | 0 | 0 |

*Overflowing elements on the surfaces this round owns, before. The landing itself was never the problem — the
product owner's report was about the surfaces a course opens up.*

## What changed

One breakpoint throughout — `40rem`, the project's own — and four sheets: `Workbench.module.css` (the shell),
`LiveCourse.module.css` (stage header, pins, hero), `OnboardingChat.module.css` (the shared intake sheet used
by the onboarding card, the material panel and the student chat) and `CourseLibrary.module.css`.

**The masthead keeps its promise.** The `display: none` is gone; the masthead wraps, and below 40rem the
tagline takes its own line under the wordmark at `--text-sm`. A promise is not chrome.

**The steps line becomes a numbered ledger.** Below 40rem it stops being an arrow chain that wraps mid-phrase
and becomes what the markup always said it was — an `<ol>` — with a counter, hairline spacing and the serif
italic text unchanged. Above 40rem the arrow chain is untouched.

![Before, 380px: a wrapped arrow chain](img/narrow-380-hero-steps-before-landing.png)

*Before. Three of four lines start with a dangling arrow.*

![After, 380px: a numbered ledger](img/narrow-380-hero-steps-after-landing.png)

*After. The list's own order, set like a contents page.*

**Nothing sets its own minimum width.** `min-width: 0` on the wrappers that hold teacher-written text (the
stage header's title block, the library row's text column, the material panel itself); `max-width: 100%` and
`width: 100%` on the text fields and the file chooser; `max-width: 100%` on every verb, so a long label wraps
its own words instead of running past the page.

**Teacher-written text can break anywhere.** `overflow-wrap: anywhere` on the title, the meta line (which
carries an unbreakable urn), the pin digests and details, the transcript's said lines and standing notes, and
the library's title and meta. `anywhere`, not `break-word`, because these elements are flex and grid children
whose minimum size would otherwise stay the longest word's.

**The pin row stacks.** Below 40rem the four fixed columns become two lines: `v1 … NOT CHECKED`, then the
digest and what it says.

**The rhythm tightens, the measure does not.** Below 40rem the stage's gutters come in from 32px to 16px and
the cards' from 20px to 16px, and the page's vertical pauses shrink — so a 320px window keeps a ~190px
measure inside the card and a ~224px column on the page instead of spending 60% of its width on margins.

**The file chooser is a house-styled button.** The browser's own control cannot survive a narrow column: at
320px Chrome truncated its "No file chosen" status to `N...n`. It is now out of the layout and driven by a
quiet **Choose a file** label — the same pattern the record band already uses for *Import* — so no width can
truncate it, and the chosen file still appears by name in the list above as soon as it lands. The focus ring
moves onto the button that drives it.

## The wide screen did not move

The harness records every surface's bounding box, so this is exact rather than a matter of looking: at
**1440px the geometry is identical** between the pre-fix code and this branch, in all five states (landing,
intake question, materials panel, full live course, delete confirm) — the same left and right edge for every
surface. Of the four full-page screenshots the browser smoke takes at 1440px, three are byte-identical
between the two builds; the fourth (`03-course-top.png`) differs only in the data each run mints — a fresh
course UUID, pin digest and timeline timestamps — not in any layout band.

## Before / after

| State | Width | `scrollWidth` vs `clientWidth` | Overflowing on my surfaces |
|---|---|---|---|
| landing + onboarding | 320 | 320 / 320 → 320 / 320 | 0 → **0** |
| onboarding, intake question | 320 | 971 / 320 → 967 / 320 | 4 → **0** |
| materials panel | 320 | 971 / 320 → 967 / 320 | 25 → **0** |
| materials panel | 380 | 971 / 380 → 967 / 380 | 0 → **0** |
| full live course | 320 | 600 / 320 → 596 / 320 | 6 → **0** |
| full live course | 380 | 600 / 380 → 596 / 380 | 2 → **0** |
| full live course | 480 | 600 / 480 → 596 / 480 | 0 → **0** |
| full live course | 768 | 768 / 768 | 0 → **0** |
| full live course | 1440 | 1440 / 1440 | 0 → **0** |
| record band, delete confirm | 320 | 600 / 320 → 596 / 320 | 6 → **0** |
| record band, delete confirm | 380 | 600 / 380 → 596 / 380 | 2 → **0** |

The remaining `scrollWidth` above `clientWidth` at 320–480px is **inside the cards** (DecisionCard, PlanCard,
PublishCard, TimelineCard) — the parallel round's fence. The harness reports those lines as `(not mine)` and
counts them separately, so the shell's own gate is not masked by them. The landing, where the whole page is
this round's, never scrolls sideways at any width.

## Proof (380px, cropped to the surface)

| Surface | Before | After |
|---|---|---|
| Masthead | [before](img/narrow-380-shell-header-before-landing.png) | [after](img/narrow-380-shell-header-after-landing.png) |
| Hero steps line | [before](img/narrow-380-hero-steps-before-landing.png) | [after](img/narrow-380-hero-steps-after-landing.png) |
| Onboarding card | [before](img/narrow-380-onboarding-card-before-landing.png) | [after](img/narrow-380-onboarding-card-after-landing.png) |
| Materials panel | [before](img/narrow-380-materials-panel-before-materials.png) | [after](img/narrow-380-materials-panel-after-materials.png) |
| Student chat | [before](img/narrow-380-student-chat-before-course.png) | [after](img/narrow-380-student-chat-after-course.png) |
| Record band ("this browser keeps the record") | [before](img/narrow-380-record-band-before-landing.png) | [after](img/narrow-380-record-band-after-landing.png) |
| Data controls, confirm state | [before](img/narrow-380-record-band-before-confirm.png) | [after](img/narrow-380-record-band-after-confirm.png) |
| Pinned copies | [before](img/narrow-380-pinned-copies-before-course.png) | [after](img/narrow-380-pinned-copies-after-course.png) |

## What is held by a test

`frontend/src/live/narrow-width.test.tsx` — 12 tests. jsdom applies no CSS-module rules and no media queries,
so the layout itself is proved in real Chrome by the harness; what is pinned here is the contract that made
the narrow window broken, so it cannot come back quietly:

- the masthead's promise is never hidden by a breakpoint, and the masthead wraps;
- one narrow breakpoint (`40rem`) in every sheet it touches;
- the classes holding the teacher's own words declare `overflow-wrap: anywhere`;
- no control declares a width without `max-width: 100%`; text fields take the column;
- the wrappers that can sit in a row of buttons declare `min-width: 0`;
- the pin row has a stacked narrow fallback; the steps line has its numbered fallback;
- the file chooser is out of the layout and driven by a label (the truncation the harness cannot see);
- **the honesty copy is byte-for-byte what it was** on the surfaces touched here — the material's retention
  sentence, the plain truth when the worker is not zero-retention, and the student chat's "Asking here is not
  evidence of learning, and nothing you ask is saved."

## Copy

**No copy changed.** Not one word on the surfaces this round touches: the masthead's promise, the hero's
assurance line, the onboarding's "on this device" and "not sent to ASFAI" lines, the material panel's
retention paragraph, the student chat's not-evidence sentence, the record band's "this browser keeps the
record". The only text that moves is the steps line's arrows becoming the list's own numbers below 40rem,
which is typesetting, not wording.

The one new string is **"Choose a file"**, the label that now drives the file chooser (it replaces the
browser's own "Choose Files / No file chosen" control, which no width could keep whole). It names the act and
nothing else — no claim about what happens to the file, because the panel's retention paragraph above it
already says that, unchanged.

## Notes for the next round

- **No token or base-style change was needed.** Every fix lives in the component sheets; `tokens.css` and
  `base.css` are untouched (both are fenced anyway).
- **The record band needed no rule**, and it is fenced: `BrowserRecord.module.css` sits under
  `frontend/src/browser/*`, which this round may not edit. It measured clean at every width and in both
  states (idle and delete-confirm), so nothing was left undone — but if a future change to that band breaks
  at a narrow width, it cannot be fixed from this branch's fence.
- **`.actions`** in `LiveCourse.module.css` is a row of buttons that also carries the material panel. That is
  why the panel needed `min-width: 0`: a card in a row of buttons is sized by its widest control unless it is
  told it may shrink. Worth remembering before adding another card to that row.
