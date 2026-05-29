# ProcuLink Frontend

Next.js frontend for ProcuLink, the B2B outbound procurement bridge.

## Stack

- Next.js 15 App Router
- TypeScript
- Tailwind CSS
- shadcn/ui, restyled through the ProcuLink Bridge Layer
- Clerk via `@clerk/nextjs`
- TanStack Query
- Sentry via `@sentry/nextjs`
- bun

This project is **not** Vite and does not use React Router.

## Local Setup

### 1. Install + start the frontend

```bash
bun install
bun run dev
```

Frontend listens on `http://localhost:8082` (configured in `package.json`).

### 2. Start the backend

The backend lives in the sibling [`ProcuLink`](https://github.com/dimnovare/ProcuLink) repository. Follow `ProcuLink/README.md` to:

- `dotnet dev-certs https --trust` (one-time)
- `docker compose up -d postgres`
- `dotnet ef database update --project ProcuLink.Infrastructure --startup-project ProcuLink.Api`
- `dotnet run --project ProcuLink.Api --launch-profile https`
- `dotnet run --project ProcuLink.Worker` (Hangfire)

### 3. Verify the wiring

1. `https://localhost:7230/health` returns `Healthy`.
2. `http://localhost:8082` loads the marketing landing page.
3. Sign up → onboarding wizard → add a supplier — should succeed without `Failed to fetch`.

## Environment

The frontend reads vars from three files, in priority order: `.env.local` > `.env.development` > `.env`.

### `.env` (committed, client-safe defaults)

```text
NEXT_PUBLIC_API_BASE_URL=http://localhost:5223
NEXT_PUBLIC_USE_MOCK=false
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://eu.posthog.com
NEXT_PUBLIC_STATUS_URL=
NEXT_PUBLIC_WALKTHROUGH_LOOM_URL=
NEXT_PUBLIC_BOOK_DEMO_URL=
```

### `.env.local` (gitignored — your secrets + overrides)

```text
NEXT_PUBLIC_API_BASE_URL=https://localhost:7230
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

### HTTP vs HTTPS in dev — pick one

The backend supports both. Match the frontend env to whichever profile you run:

| Backend profile | Backend URL | Frontend `NEXT_PUBLIC_API_BASE_URL` |
|---|---|---|
| `dotnet run --launch-profile https` | `https://localhost:7230` (preferred) | `https://localhost:7230` |
| `dotnet run --launch-profile http` | `http://localhost:5223` | `http://localhost:5223` |

If you mix them — frontend pointing at `https://` while the backend only opens `http://` — every API call fails with `Failed to fetch` because TLS connection is refused. The same error happens if you target HTTPS without first running `dotnet dev-certs https --trust`.

Do not use `VITE_*` variables.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Failed to fetch` on the onboarding wizard | Backend not reachable, dev cert not trusted, OR HTTP/HTTPS mismatch between `.env.local` and the launch profile | See "HTTP vs HTTPS in dev" above. The wizard itself now prints a more actionable message in `OnboardingWizard.tsx`. |
| `useOrganization can only be used within ClerkProvider` during build | Missing Clerk env vars during `bun run build` | Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` in `.env.local`, or pass them inline to the build command |
| Onboarding banner says "billing service unavailable" | Backend not running OR Pilot quota not yet wired | Confirm backend Terminal 1 is up and `/api/billing/status` returns 200 |
| `posthog` events never fire | `NEXT_PUBLIC_POSTHOG_KEY` empty + user has not accepted analytics cookies | Both required — see `docs/group-l-go-live-playbook.md` Action 1 |

## Design Direction

The visual source of truth lives in the sibling backend repository (checked out
alongside this one):

```text
../ProcuLink/docs/design-system
```

Read `00-agent-quick-brief.md` first for any UI work.

Locked direction:

- Direction 4, The Bridge Layer
- Direction 3, System Identity
- No Lovable-generated UI or Vite patterns

## Commands

```bash
bun run build          # production build
bun run lint           # next lint
bun run test           # vitest unit tests
bun run test:e2e       # Playwright (mock mode)
bun run test:e2e:live  # Playwright against a running backend (PLAYWRIGHT_LIVE=1)
```

Current Playwright baseline: **43 tests across 8 spec files**, 0 failures.

## UX Direction

ProcuLink ships **one great experience** — smart defaults, progressive
disclosure, and a Command Palette (Cmd+K) for power features. The earlier
"default vs expert mode" toggle (`useViewMode` / `ViewModeToggle`) was removed
before adoption. Power-user affordances — standards mappings, raw views,
hotkeys, density — surface via the Command Palette, info popovers, and
per-table column selectors, never behind a user-mode flag.

Standards visibility is a product invariant: any transform/mapping field can
surface its UBL / EDIFACT / X12 / cXML reference on demand via
`StandardsFieldPopover` or the `/library/standards` comparison screen.

## Current Product Focus

The backend exposes the full outbound bridge — multi-format input/output
(CSV/XLSX, PDF, cXML, UBL, EDIFACT, X12), multi-channel delivery (HTTP, SFTP,
FTPS, SMTP, ERP), billing, AI mapping, and magic mapping preview. The frontend
is in production-polish and live-QA mode.

Forward plan (Phase 6 — International Standard) lives in the sibling backend repo:

```text
../ProcuLink/docs/superpowers/plans/2026-05-28-phase-6-international-standard-roadmap.md
```

Read `STATUS.md` in the backend repo before starting new work — it is the
shared handoff source of truth across both repositories.
