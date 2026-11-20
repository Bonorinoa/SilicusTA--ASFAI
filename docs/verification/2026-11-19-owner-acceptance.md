# Owner acceptance of the REL2 conditions, 19 November 2026

**Status:** a dated record. Do not edit it. Add a newer record instead.

The owner accepted all three conditions from `docs/verification/2026-11-19-release-gate-2.md` §5 on 19 November 2026,
in the PM session, with the words "accept all three". This records that acceptance. It is not a deployment.

1. **"AI never grades" is enforced, not guaranteed.** It rests on the prompt, the refusal flag and the partial input and
   output nets. The landing page states it as a flat claim (`frontend/src/landing/Landing.tsx:35`). The committee framing
   is "refuses grading; tested, not guaranteed."
2. **Reliability was shown, not proven.** One 12/12 run (p95 37.5 s) on one model route, plus the gate's own 4/4. The L2
   stress failures stay on the record. This is not an availability guarantee.
3. **The build had not been exercised on Vercel** at the time of the gate. A preview deployment of this sha was made
   afterwards, for the owner's retest. It is not production.

The owner has not yet said "deploy". Production is unchanged.
