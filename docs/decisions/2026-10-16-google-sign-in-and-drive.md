# Decision memo: Google sign-in and Google Drive import (for Stephen and Michael)

Status: proposed, not built. Owner request 2026-10-16: "a landing page and google auth, perhaps users could have
the convenience to simply import their materials from google docs/sheets or other connector."

## The two asks are different decisions

| | Google sign-in (identity) | Drive import (a connector) |
|---|---|---|
| What changes | Who the teacher is, and where their record lives | One more way to add a material |
| Today | No accounts. The online record lives in the teacher's browser (IndexedDB); the local app keeps it on disk | Paste, text file, public link; this sprint adds PDF/DOCX/PPTX upload |
| Cost | A server-side store for records, sessions, deletion and export per user; data-governance review | A Google Cloud OAuth client + API key; a CSP change; a governance check for teacher files |
| Owner | Stephen (infra) | Augusto, with Michael for the ASFAI side |

## Recommendation

1. **Drive import first, without sign-in.** Use the Google Picker with the `drive.file` scope: the teacher picks one
   document; the app can read only the files the teacher picked, not their Drive. The document is exported as text
   in the browser and goes through the same material path as an uploaded file, so "material never persists" still
   holds. Docs → plain text, Slides → text, Sheets → CSV.
   Needs: a Google Cloud project with an OAuth client (authorized JavaScript origin = the production URL) and an API
   key, both created by Augusto; the CSP must allow Google's script and frame origins (today it is `'self'` only),
   which is a deliberate loosening the verifier reviews; while the app is in Google's "testing" status only listed
   test users can grant access, which is fine for a pilot.
2. **Sign-in when there is something to sign in TO.** Accounts only pay off when records live on a server
   (sharing a course with a colleague, a student link, more than one device). That is Stephen's architecture call:
   which store, which region, retention, deletion, and whether the login is Google, ASU SSO, or both. Until then a
   "Sign in with Google" button would be decoration on a public demo.
3. **Governance before either.** Teacher materials may include student work. ASU's data-classification check and
   the Google Workspace terms decide what may be imported; "LMS = connector, not home" stays the rule.

## Questions for this weekend

- Stephen: is a server-side record in scope for the Dec 1 MVP, and on what host? Google login, ASU SSO, or both?
- Michael: does ASFAI's side want a shared identity with Silicus later, or stay accountless (as today's OAuth is)?
- Augusto: OK to create the Google Cloud project for the Picker pilot (testing status, named test users)?
