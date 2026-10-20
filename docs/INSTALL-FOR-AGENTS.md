# Install guide for agents: set Silicus up for a new user

This page is for an AI coding agent (Claude Code, Codex, Hermes) that helps a person try Silicus. Read
[`../AGENTS.md`](../AGENTS.md) first. For what works today, read [`STATUS.md`](STATUS.md). This page does not repeat
status. Where it and STATUS disagree, STATUS wins.

Pick one path with the user:

| Path | Good for | The user supplies |
|---|---|---|
| 1. Try the hosted app | A teacher who wants to look, today, with no install | A browser, and the demo passcode from Augusto |
| 2. Run locally | A developer, or anyone who wants the record on their own disk | Node, a clone of the repo, and (for AI steps) their own model key |
| 3. Self-host on Vercel | Someone who wants their own online copy | Repo access, a Vercel account, a model key, a passcode they choose |

Run every command from the repository root. Each `cd` sits inside a subshell `( ... )`, so the working directory
never moves.

Read the "Agent rules" at the end before you start. They are short.

---

## Path 1: try the hosted app

Site: https://silicus-ta.vercel.app

**The user supplies:** a current browser, and the demo passcode. The passcode comes from Augusto, the owner. It is
not in the repository, and you must not ask for it in chat or type it for the user. The user types it into the app
when the app asks (at the first AI step). The app keeps it for that browser tab only.

**What you do:** nothing to install. Send the user the link and the early-tester page
([`early-testers.md`](early-testers.md)), which says what to try and what is not real yet.

**Verify it is up** (no secret needed):

```sh
curl -sS -o /dev/null -w "%{http_code}\n" https://silicus-ta.vercel.app/
# expected: 200

curl -sS https://silicus-ta.vercel.app/api/worker/status
# expected: JSON with "configured":true and "passcodeRequired":true
```

`configured: true` means the site has a model key and a passcode set. It does not prove the model answers. Only a
real AI step in the app shows that.

**What the user's browser keeps.** The course record lives in this browser (IndexedDB), on this device. It is not
on a server. Reloading the page brings the courses back. Clearing site data, a private window, or another browser
or device does not. To keep a copy, use **Export all courses** (a file the user saves); **Import** reads it back and
checks every record first. Source text and questions do pass through Vercel and the model provider on the way to
the model ([`DEPLOY.md`](DEPLOY.md)), so use public material or material the user may share.

**Common failure, and the fix**

| What the user sees | Why | Fix |
|---|---|---|
| The AI step asks for a passcode again, or says it is wrong | The passcode is per tab, or was typed wrong | Type it again. If it still fails, ask Augusto: it may have changed. |
| An AI step fails after a wait, with a provider or upstream error | The model provider refused (for example, the account is out of credits) | Not a user error. Tell Augusto, with the time. The record is not harmed. |
| Courses are gone | A different browser, a private window, or cleared site data | Import the last exported file. If there is none, the record is gone. |

---

## Path 2: run locally

**Requirement:** Node 22 recommended (>= 18 works for the suites; v24.11.1 passed the full matrix on 19 Oct, see
`/Users/bonorinoa/Hermes/Reports/silicus-sprint-2026-10-19/baseline/BASELINE.md`). Name the Node version in any
result you report. Chrome is needed only for the smoke scripts.

**The user supplies:** a clone of the repository (it is private: Augusto grants access), and, for AI steps, their
own model key. Without a key, everything except the AI steps works.

### 2a. Install and start

```sh
node --version                                  # say which version you used
(cd frontend && npm ci)                         # once; the host and confirm-gate need no install
(cd host && npm start)                          # terminal 1: host on 127.0.0.1:8787, data in ~/.silicus/host
(cd frontend && npm run dev)                    # terminal 2: app at http://localhost:5173
```

The app proxies `/api` to `127.0.0.1:8787`, so the host must use port 8787 when you use the app. To keep test data
away from the user's real data, start the host with another folder:

```sh
(cd host && SILICUS_HOST_DATA="$HOME/silicus-trial" npm start)
```

**Plain `npm start` leaves the worker unconfigured.** It reads only the shell environment. With no worker
variables, every AI step (propose objectives, draft the plan, answer a student question) says it is not
configured. Creating a course, adding sources and writing objectives yourself still work. Drafting a lesson plan
needs the worker, so a new course cannot reach its first published version without it.

**Verify** (in a third terminal, while the host runs):

```sh
curl -sS http://127.0.0.1:8787/api/health
# expected: {"ok":true,"courses":0}   (the number is how many courses the data folder holds)

curl -sS http://127.0.0.1:8787/api/worker/status
# expected with plain npm start: "configured":false
# expected with the worker on (2b): "configured":true, and "zdr":true for the openrouter preset

curl -sS http://localhost:5173/ | grep -o '<title>[^<]*</title>'
# expected: <title>Silicus TA · course authoring, teacher in the loop</title>
```

### 2b. Turn the AI worker on (needs the user's key)

The worker reads these names. Put the values in `host/.env.worker`. That file is ignored by git
(`.env.*` in `.gitignore`). Never commit it, print it, or paste it into chat.

| Name | Meaning |
|---|---|
| `SILICUS_WORKER_PROVIDER` | `openrouter` (the default preset, with zero-retention routing), `anthropic`, or unset for any chat-completions endpoint |
| `SILICUS_WORKER_URL` | The endpoint. Needed only when the provider is unset. |
| `SILICUS_WORKER_MODEL` | The model. Each preset has a default. |
| `SILICUS_WORKER_ZDR` | Zero-data-retention routing, OpenRouter only. On for the `openrouter` preset; `0` turns it off. |
| `OPENROUTER_API_KEY` | The OpenRouter key (for the `openrouter` preset) |

`host/README.md` (section "The drafting worker") has the full list, including `ANTHROPIC_API_KEY` and
`SILICUS_WORKER_API_KEY`.

Let the user create the file and type the key themselves. The minimum is two lines:

```text
SILICUS_WORKER_PROVIDER=openrouter
OPENROUTER_API_KEY=<the user types their key here>
```

Then start the host through the launcher instead of `npm start`:

```sh
(cd host && npm run start:worker)                                          # needs the user's key
(cd host && SILICUS_WORKER_ENV_FILE="$HOME/.silicus/worker.env" npm run start:worker)   # or a file elsewhere
```

The launcher passes on only the worker names and the key names from that file, never other secrets in it. Verify
with `curl -sS http://127.0.0.1:8787/api/worker/status`: expect `"configured":true`.

### 2c. Optional: connect ASFAI

ASFAI Education is a separate product. Silicus can use it and never requires it. Every course works without it.
The local app can connect to it (OAuth): the teacher starts it from the app and approves it in their own browser.
You never handle the token. Check the state with:

```sh
curl -sS http://127.0.0.1:8787/api/asfai/status
# expected before connecting: {"connected":false,...}
```

The online app (paths 1 and 3) does not connect to ASFAI from a browser tab.

### 2d. Optional: run the checks

The full list, with what each one needs, is in [`STATUS.md`](STATUS.md) section 3. Two quick ones that need no
secret:

```sh
node --test api/test/
(cd frontend && npm run build)
```

Do not quote old test totals as today's. Report what you ran, with its exit code and Node version.

**Common failure, and the fix**

| What you see | Why | Fix |
|---|---|---|
| Every AI step says "not configured"; `/api/worker/status` says `"configured":false` | The host was started with plain `npm start` | Stop it, then `(cd host && npm run start:worker)` with the user's key file |
| `start:worker` exits 1: `No drafting-worker credential found: set ...` | No key in the named file or the shell | The user adds the two lines to `host/.env.worker`. The message names the file. |
| The app loads, but every action fails; the dev server logs `ECONNREFUSED 127.0.0.1:8787` | The host is not running, or runs on another port | Start the host on 8787 |
| `EADDRINUSE` on 8787 or 5173 | Something else already uses the port | Ask the user what it is. Do not stop a process you did not start. |

---

## Path 3: self-host on Vercel

This deploys a copy the user owns. It changes something outside this machine, so **do it only when the user says so,
in their own words, for each push and each deploy.** Read [`DEPLOY.md`](DEPLOY.md) first; it is the reference for
this path.

**The user supplies:** access to the repository (private: ask Augusto), their own fork or copy, a Vercel account
(logged in by the user), an OpenRouter key, a model slug, and a passcode they choose and share only with their
testers.

### 3a. Fork and link (needs the user's account)

1. The user forks the repository on GitHub, or makes a private copy, and clones it.
2. In Vercel, the user imports the fork as a new project. `vercel.json` already holds the build: it installs
   `frontend/`, builds it with `VITE_SILICUS_MODE=browser`, and serves `frontend/dist` with the three functions
   in `api/`. Do not change those settings.

Check the online build locally first (no secret needed):

```sh
(cd frontend && VITE_SILICUS_MODE=browser npm run build)
node --test api/test/
```

### 3b. Set the variables (needs the user's key)

The user sets each one in the Vercel project, for Production and for Preview. The CLI asks for the value, so the
value never lands in a file, a commit or the chat. The user can also set them in the Vercel dashboard.

```sh
npx vercel login                                     # the user logs in; needs the user's account
npx vercel link                                      # links this folder to the user's project
npx vercel env add OPENROUTER_API_KEY production     # needs the user's key
npx vercel env add OPENROUTER_API_KEY preview
# ...and the same for each name below
```

| Name | Required | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | The OpenRouter key. Sent only to OpenRouter. |
| `SILICUS_WORKER_MODEL` | yes | The OpenRouter model slug. The browser cannot change it. |
| `SILICUS_DEMO_PASSCODE` | yes | The shared passcode the app sends with each AI request |
| `SILICUS_WORKER_ZDR` | no | Zero-retention routing. On unless set to exactly `0`. |
| `SILICUS_DAILY_CAP` | no | Model calls per function instance per UTC day (default 300) |
| `SILICUS_WORKER_MAX_TOKENS` | no | Reply cap (default 4000, never higher) |
| `SILICUS_WORKER_REASONING` | no | `low` (default), `medium`, `high`, `off`, or `model-default` |
| `SILICUS_TYPICAL_SECONDS` | no | Wait ranges the app shows; see `DEPLOY.md` |

A change takes effect on the next deployment. Tell the user to also set a credit limit on the OpenRouter key: the
rate limit is best effort, not a spending limit.

### 3c. What fails closed

- No key, no model or no passcode: `POST /api/worker` answers 503 and calls nothing.
- No passcode: `POST /api/fetch` answers 503 too. Neither route is ever an open proxy.
- A wrong or missing passcode: 401 `BAD_PASSCODE`. Wrong guesses count toward the rate limit.
- Zero-retention on with a model that has no zero-retention endpoint (free models): the call fails. It is never
  retried somewhere that keeps data.
- Over the size limits: 413. Upstream over 115 seconds: 504.

### 3d. Verify after the user deploys

Replace `<site>` with the user's deployment address.

```sh
curl -sS https://<site>/api/worker/status
# expected: "configured":true, "passcodeRequired":true, "zdr" as the user set it

curl -sS -X POST -H "content-type: application/json" -d "{}" -w "\nHTTP %{http_code}\n" https://<site>/api/worker
# expected with no passcode: {"error":{"code":"BAD_PASSCODE"}} and HTTP 401

curl -sS -o /dev/null -w "%{http_code}\n" https://<site>/api/test/index.js
# expected: 404 (the tests are not deployed)
```

Then the user opens the site, types their passcode at the first AI step, and checks that one AI step answers.

**Common failure, and the fix**

| What you see | Why | Fix |
|---|---|---|
| `"configured":false`, or AI steps get 503 | A required variable is missing, or was set after the last deploy | Set it for that environment, then redeploy |
| AI steps get 502 after a wait | The provider refused; status 402 means the OpenRouter account is out of credits | The user funds the account. Nothing in the app needs a change. |
| Every AI call fails at once with ZDR on | The model has no zero-retention endpoint | Choose a model with one. Turning ZDR off (`0`) means the provider's normal retention terms apply: public material only. |
| The build fails | The project's build settings override `vercel.json` | Remove the overrides in the Vercel project settings; `vercel.json` holds the build |

---

## Agent rules

- **Never print, log or commit a secret.** Keys and passcodes are typed by the user into the place that needs them
  (`host/.env.worker`, a Vercel prompt, the app's passcode box). Do not echo them, `cat` the env file, or put them in
  a commit message or a chat. Do not read unrelated secret files (`~/.hermes/.env` and the like).
- **Never push, deploy or change a hosted project without the user's word.** Ask each time. A local run is fine.
- **Do not stop a process you did not start.** Ports 8787 and 5173 may belong to the user.
- **ASFAI is optional.** Never tell a user they need an ASFAI account.
- **The student space is a preview on the teacher's device.** Students cannot open a published course from their
  own device yet.
- **The teacher confirms; the AI proposes.** Do not click a confirm or a publish for the user.
- **First users are teachers of learners aged 5 to 14.** Research-assistant and graduate-school use are parked.
- **Report what you ran.** Each command, its exit code, and the Node version. A green test run is not proof that
  the live model works.

What not to claim, and what to say instead (the full table is in [`early-testers.md`](early-testers.md)):

| Do not say | Say instead |
|---|---|
| "Your students can open this" | "The student space is a preview on this device." |
| "The AI can never grade" | "The AI is told not to grade, and the server refuses common ways of asking. It is not a guarantee." |
| "Your sources are never stored" | "Source text is read in this tab and forgotten on reload. Older or imported courses can still hold text." |
| "Your data is private" | "The record stays in your browser, but text sent to the AI passes through Vercel and the model provider." |
| "The log cannot be changed" | "The log is tamper-evident, not tamper-proof." |
