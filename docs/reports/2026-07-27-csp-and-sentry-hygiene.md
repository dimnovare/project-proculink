# CSP rollout + Sentry hygiene — 2026-07-27

Two long-deferred items, done together because the CSP reports land in Sentry.

---

## 1. Full app Content-Security-Policy

### What shipped

`src/lib/security/csp.ts` builds every security header from the same env vars the
browser code reads, and `next.config.ts` `headers()` applies them to `/:path*`.
Deriving the allowlist from env (rather than hardcoding hosts) means the policy
cannot drift from the origins the app actually talks to:

| Origin in the policy | Derived from | Used by |
|---|---|---|
| Clerk Frontend API (`https://clerk.proculink.eu` in prod) | base64 payload of `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `clerk.browser.js`, session calls, sign-in form posts |
| `https://challenges.cloudflare.com` | constant | Clerk bot protection (Turnstile) — script + frame |
| `https://clerk-telemetry.com` | constant | Clerk SDK telemetry |
| API origin | `NEXT_PUBLIC_API_BASE_URL` | every `apiClient` fetch |
| PostHog ingest + assets host | `NEXT_PUBLIC_POSTHOG_HOST` | `posthog-js` init / remote config |
| Sentry ingest origin | `NEXT_PUBLIC_SENTRY_DSN` | error + trace envelopes |
| `https://assets.proculink.eu` | `NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL` / `_POSTER` | R2-hosted walkthrough video + poster |
| `https://img.clerk.com` | constant | user avatars |
| `https://www.loom.com` | constant | `/watch` Loom embed (when configured) |
| `https://vercel.live`, `https://assets.vercel.com`, pusher | `VERCEL_ENV === "preview"` | Vercel preview comment toolbar — **preview only** |

**Stripe needs no directive.** Checkout and the Customer Portal are reached with
`window.location.href = url` (a top-level navigation, which CSP does not govern) —
`stripe.js` is never loaded and no Stripe iframe is embedded. Adding
`js.stripe.com` would have been allowlist we don't use.

### Mode: report-only (default), one env var away from enforce

`CSP_MODE` is read at build time. Unset (the default) ships **two** headers:

- `Content-Security-Policy: frame-ancestors 'self'; base-uri 'self'; object-src 'none'; report-uri …`
  — enforced. Keeps (and extends) the clickjacking protection that was already live.
- `Content-Security-Policy-Report-Only: <full policy>` — measured, with violations
  POSTed to the Sentry security endpoint derived from the DSN.

`CSP_MODE=enforce` collapses that to a single enforced full policy.

Report-only is the honest default: the policy has been exercised locally in
enforce mode against a production build (below), but the authenticated app shell
against the **production** Clerk instance, and a real Stripe Checkout hand-off,
could not be driven — Vercel preview deployments sit behind Vercel SSO, so a
browser could not reach one. Measure real traffic first, then flip.

### Why `'unsafe-inline'` is in `script-src`

Next's App Router streams hydration data as inline `<script>self.__next_f.push(…)`
blocks whose contents differ per page, so hashes are unusable, and a per-request
nonce forces every page into dynamic rendering (Next only injects a nonce during
a request-time render) — that would deopt the statically prerendered marketing
and help pages. There is also one inline JSON-LD block in `src/app/layout.tsx`.

So this policy does not claim to stop inline XSS. What it does close:

- no script may load from a host we did not name,
- no data may be exfiltrated to a host we did not name (`connect-src`),
- no `<object>`/`<embed>`, no `<base>` hijack, no third-party framing,
- no `eval` in production (`'unsafe-eval'` is dev-only, for HMR).

`style-src` keeps `'unsafe-inline'` unconditionally — the codebase styles almost
everything with React inline `style={{…}}` props.

### Verification

- `src/lib/security/csp.test.ts` — 22 unit tests over the builder (host derivation
  from the Clerk key and Sentry DSN, dev vs prod differences, preview-only Vercel
  hosts, report-only vs enforce header sets, no invented origins when env is unset).
- `tests/e2e/csp.spec.ts` — 14 Playwright tests: headers present on marketing and
  app routes, and **zero** `securitypolicyviolation` events across `/`, `/pricing`,
  `/how-it-works`, `/watch`, `/support`, `/privacy`, `/bridge`, `/inbox`, `/upload`,
  `/settings`, `/library/suppliers`, plus the cookie-consent interaction. 14/14 green.
- Local **production build with `CSP_MODE=enforce`** and a real Clerk key, PostHog
  key, Sentry DSN and the R2 media hosts — results in §3 below.

---

## 2. Sentry hygiene

### Ingestion — all three DSNs are live

The org has exactly **one** project, `dotnet-aspnetcore` (id `4511461475680336`);
frontend, API and Worker all report into it. Latest event per source:

| Source | Latest event | Evidence |
|---|---|---|
| Frontend (Vercel) | 2026-07-27 08:48 | `platform=javascript`, `environment=vercel-production`, release = the deployed git sha |
| API | 2026-07-26 10:21 | `platform=csharp`, `release=ProcuLink.Api@1.0.0`, `.NET 8.0.29` |
| Worker | 2026-07-10 06:49 | `platform=csharp`, `release=ProcuLink.Worker@1.0.0`, `.NET 8.0.28` |

### Triage — 3 of 5 issues resolved

| Issue | Verdict |
|---|---|
| `DOTNET-ASPNETCORE-1E` — `UnrecognizedActionError: Server Action … was not found` on `/sign-in` | **Resolved.** 1 event, on a superseded release. This is the standard stale-tab-after-deploy artifact, not a bug. |
| `DOTNET-ASPNETCORE-D` — `Failed executing DbCommand` (Worker) | **Resolved.** Last seen 2026-07-10. |
| `DOTNET-ASPNETCORE-1D` — `Failed executing DbCommand` (Worker) | **Resolved.** Last seen 2026-07-03. |
| `DOTNET-ASPNETCORE-1B` — N+1 API Call on `/library/suppliers` (frontend) | **Left open — real and current** (last event 2026-07-27). |
| `DOTNET-ASPNETCORE-1C` — N+1 Query on `GET /api/connections` (API) | **Left open — real** (last event 2026-07-26). |

Still noisy, for the backend to decide on: both resolved Worker issues are
`Microsoft.EntityFrameworkCore.Database.Command` **log records**, not exceptions —
the .NET SDK turns every `Error`-level EF log into an event, with no stack and no
exception attached, so their diagnostic value is near zero. Raising the SDK's
`MinimumEventLevel` for that category (or filtering it) would stop them coming back.

### Source maps — working, with one gap and one blind spot

Artifact bundles exist for essentially every production release (3 per deploy —
client, server, edge), so the plugin **is** uploading with the current token. A
local production build with the token confirmed it end-to-end: `Bundled 219 files
for upload → Uploaded files to Sentry`, artifact bundle created.

Two findings:

1. **The currently-deployed release has no bundle.** Every recent release has
   bundles except `bb97186…` (production deploy 2026-07-27 08:37, the live one).
   So that build's upload did not happen, and nothing in the Vercel log said so.
2. **The plugin ran with `silent: true`**, which is exactly why (1) went
   unnoticed, and it also hid a real capture gap: *"Could not find `onRequestError`
   hook in instrumentation file"* — errors thrown inside nested React Server
   Components were never reaching Sentry.

Both are addressed in this PR: `silent` is now `!process.env.SENTRY_AUTH_TOKEN`
(quiet when there is nothing to upload, loud when there is), and
`instrumentation.ts` exports `onRequestError`.

**Cleanup for the founder:** the verification run created a throwaway Sentry
release `csp-sourcemap-verify-01` with 3 artifact bundles. Safe to delete; nothing
references it. It was left in place rather than deleted from an automated session.

**Not changed, worth doing later:** the SDK warns that `sentry.client.config.ts`
should become `instrumentation-client.ts` (required under Turbopack). The current
file carries a deliberate lazy-boot that keeps the SDK out of first-load JS, so
the rename deserves its own change rather than a drive-by.

---

## 3. Production-build QA under an enforced policy

`next build` + `next start` with `CSP_MODE=enforce` and a real environment — a
working Clerk instance (so `clerk.browser.js` is genuinely fetched from the
Frontend API host the key encodes), the real PostHog key, the real Sentry DSN,
`https://api.proculink.eu`, and the R2 walkthrough media URLs. Then Chromium
walked 13 routes recording every `securitypolicyviolation`, console error and
failed request.

Result: **0 of 13 routes produced a CSP violation.**

```
/ · /pricing · /how-it-works · /watch · /support · /privacy · /help
/security · /changelog · /sign-in · /sign-up · /bridge · /upload
ROUTES_WITH_VIOLATIONS=0/13
```

Non-CSP noise seen and explained (none of it is a policy block — a blocked
request raises a violation event, and there were none):

- `…/sign-in?_rsc=… :: ERR_ABORTED` — Next route prefetches cancelled when the
  page closes.
- `assets.proculink.eu/…/walkthrough.mp4 :: ERR_ABORTED` — `preload="metadata"`
  on `/watch` aborted at teardown. `media-src` allows the host.
- `https://127.0.0.1:8099/sign-in… :: ERR_SSL_PROTOCOL_ERROR` — `upgrade-insecure-requests`
  upgrading a loopback navigation. Chrome exempts the literal host `localhost`
  but not `127.0.0.1`. A local-production-server artifact only: `next dev` omits
  the directive entirely, and every deployed origin is already https.

### What this run could NOT exercise

- **The authenticated app shell against the production Clerk instance.**
  `/bridge` and `/upload` correctly bounced to `/sign-in`. The app shell's own
  assets are covered by the dev-mode Playwright suite (`/bridge`, `/inbox`,
  `/upload`, `/settings`, `/library/suppliers`, zero violations), but not with a
  live production session.
- **The Stripe Checkout / Customer Portal hand-off**, which needs a signed-in org
  with billing.
- **A Vercel preview deployment**, which is gated by Vercel SSO — a browser
  cannot reach one without changing the project's deployment-protection settings.

That residual gap is the reason the shipped mode is report-only. The policy is
already collecting real violations from real sessions; flip `CSP_MODE=enforce`
in the Vercel project once those reports stay empty over a normal traffic window.
