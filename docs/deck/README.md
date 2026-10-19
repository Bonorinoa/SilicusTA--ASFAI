# Silicus TA 3.0: how it works (slide deck)

`silicus-ta-3.0-how-it-works.html` is one self-contained file (images embedded, no network). Open it in a browser.

- Keys: right arrow, space, PageDown for next; left arrow, PageUp for previous; Home and End. The position is kept in the URL hash and in localStorage.
- Print or save as PDF: one slide per page (1920 by 1080).
- Grounded on `main` at the commit shown on the title slide. Every screenshot is a capture of the built app (`frontend`, Chrome) running against the real host
  (`host`), driven through a real course on a public YouTube lecture with a free OpenRouter worker. The test counts on the Verified slide were re-run on that commit.
- It is a generated artifact: regenerate it rather than editing the HTML by hand.

## Historical artifact (audit of 2026-10-19)

The HTML is grounded on `main @ bd01d4f` (14 October; 20 slides). It is kept unchanged as a record of that
day. Do not present it as current. For current status, see [`../STATUS.md`](../STATUS.md). These claims from
the deck have changed since:

- "Waiting on OpenRouter credits". The production AI path ran on 17 October with the ZDR worker
  (`../verification/2026-10-17-studio-redesign.md`).
- "Hosting: local-first … design toward a static site". The static site plus proxy was built on 14 October
  (`acdf31e`). Students still cannot reach a published version.
- "A model could still phrase a mastery claim … nothing enforces it". The host now overrides with an
  `assessment` refusal (`1ea3ac9`), plus a pattern check on the question (`20acaea`). Neither is a guarantee
  about how an answer is worded.
- The numbers on the "Verified" slide (41 / 236 / 188 / 53 / 62) are for `bd01d4f` only.
- The screenshots show the app as it was on 14 October, run through the local host. The online build and the
  studio at `#/studio` (17 October) are not in the deck.
