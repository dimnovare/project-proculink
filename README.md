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

```bash
bun install
bun run dev
```

The local frontend usually runs on:

```text
http://localhost:8082
```

The backend API usually runs on:

```text
http://localhost:5223
```

## Environment

Committed `.env` values should only contain client-safe public variables:

```text
NEXT_PUBLIC_API_BASE_URL=http://localhost:5223
NEXT_PUBLIC_USE_MOCK=false
NEXT_PUBLIC_SENTRY_DSN=
```

Local secrets belong in `.env.local` and must not be committed:

```text
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Do not use `VITE_*` variables.

## Design Direction

The visual source of truth is in the backend repository:

```text
C:\Users\Dmitri.MARKIT\source\repos\ProcuLink\docs\design-system
```

Read `00-agent-quick-brief.md` first for any UI work.

Locked direction:

- Direction 4, The Bridge Layer
- Direction 3, System Identity
- No Lovable-generated UI or Vite patterns

## Commands

```bash
bun run build
```

## Current Product Focus

Groups C-H are implemented. The next recommended workstream is production UI/UX
polish and mobile responsiveness before broader engine expansion.
