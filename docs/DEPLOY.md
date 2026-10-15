# Deploying the online prototype on Vercel

The online Silicus runs in the teacher's browser: the course record lives in the browser
(IndexedDB), not on a server. Vercel serves the built app and runs three small, stateless
functions. Nothing about a teacher, a student or a course is stored on Vercel, and the functions
never log a request body.

| Route | What it does |
|---|---|
| `POST /api/worker` | Forwards a chat-completions request to OpenRouter with the secret key. |
| `GET /api/worker/status` | Says whether the proxy is configured and whether zero-retention routing is on. |
| `POST /api/fetch` | Reads one public web page the teacher named and returns its text. |

## Environment variables

Augusto sets these himself in the Vercel project, once for Production and once for Preview:

```sh
vercel env add OPENROUTER_API_KEY production
vercel env add OPENROUTER_API_KEY preview
# ...and the same for each name below
```

The CLI prompts for the value; never put a value in the repo, a commit message or a chat.

| Name | Required | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | The OpenRouter key. Sent only to OpenRouter, as a Bearer token. Never in a response or a log. |
| `SILICUS_WORKER_MODEL` | yes | The OpenRouter model slug. The function always uses this; a model named by the browser is ignored. |
| `SILICUS_DEMO_PASSCODE` | yes | The shared passcode the app sends in the `x-silicus-passcode` header. |
| `SILICUS_WORKER_ZDR` | no | Zero-data-retention routing. On unless set to exactly `0`. |
| `SILICUS_DAILY_CAP` | no | Model calls per function instance per UTC day. Default 300. |
| `SILICUS_WORKER_MAX_TOKENS` | no | Lowers the reply cap below the default of 4000 tokens. It cannot raise it. |

If the key, the model or the passcode is missing, `/api/worker` answers 503 and does nothing.
If the passcode is missing, `/api/fetch` answers 503 too. Neither is ever an open proxy.

Changing a variable takes effect on the next deployment.

## What each guard does

- **Passcode.** Every `POST` needs the right `x-silicus-passcode` header, or it gets 401. The
  check takes the same time whether the guess is close or not. Wrong guesses count toward the
  rate limit.
- **The function decides, not the browser.** The model, the reply cap and the retention routing
  come from the environment. Only `messages`, `response_format`, `temperature` and `max_tokens`
  are read from the request; everything else (`model`, `provider`, `tools`, `stream`, ...) is
  dropped.
- **Zero-data-retention routing.** Unless `SILICUS_WORKER_ZDR=0`, every call asks OpenRouter for
  zero-retention endpoints only (`provider: {zdr: true, data_collection: "deny"}`). If none can
  serve it, the call fails. It is never retried somewhere that keeps data. The status route reports
  `zdr` exactly as configured.
- **Size and time.** A model request over 512 KB is refused (413), and so is a fetch request over
  4 KB. OpenRouter gets 55 seconds (then 504); a web page gets 20 seconds.
- **Errors.** OpenRouter's error text is never passed on, only its status code: `402` means the
  account is out of credits.
- **URL fetch.** This is the same guard the local app uses (`host/materials.mjs`): https only,
  no logins in the link, no private, loopback, link-local or cloud-metadata address, and every
  redirect is checked again before it is followed. YouTube links are refused with
  `YOUTUBE_LOCAL_ONLY`.
- **Rate limit.** 20 requests per 10 minutes per IP address, plus the daily cap.
- **No caching.** Every `/api` response is `Cache-Control: no-store`.

## Honest limits

- **The rate limit is per instance and best-effort.** Counts live in one function instance's
  memory. Vercel can run several instances at once and restarts them freely, so the real ceiling
  is higher than the numbers above and resets on a cold start. It slows down a casual abuser. It
  does not replace a spending limit: also set a credit limit on the OpenRouter key.
- **The passcode is a shared secret, not a login.** Anyone who has it can use the proxy. Change it
  (and redeploy) if it spreads.
- **Free models are not zero-retention.** A free model has no zero-retention endpoint, so with ZDR
  on its calls fail. Running one means `SILICUS_WORKER_ZDR=0`, and then the provider's normal
  retention terms apply: public or shareable material only, and the app must say so.
- **YouTube is local only.** Captions need yt-dlp, which does not run on Vercel, and YouTube blocks
  cloud addresses. Teachers paste the transcript instead.
- **The DNS check has a gap.** A hostile site could change its DNS answer between the check and
  the connection (DNS rebinding). The local app has the same gap.
- **Production is public.** On the Hobby plan, Vercel's login protects preview deployments only.
  The passcode is what protects the production functions.

## Checking it

```sh
node --test api/test/
```

After a deployment, `GET /api/worker/status` should show `"configured": true`, and
`/api/test/...` should be 404 (the tests are excluded by `.vercelignore`).
