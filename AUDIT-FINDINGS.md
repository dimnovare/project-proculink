# Frontend Truth Audit — Findings

Branch: `feat/frontend-truth-audit`
Scope: trust-breaking issues before paid launch — leftover demo data rendered to
real users, misleading "it worked" states with no persistence, and dead CTAs in
the authenticated `(app)` routes. PO mapping editor excluded per scope boundary.

## Summary

| Classification | Count |
|---|---|
| Legit (mock/marketing — left as-is) | 11 |
| Fixed | 5 |
| Flagged for follow-up | 2 |

`bun run build`: **passes 45/45 static pages when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
is present** (production / Vercel condition). See "Build note" below — the only
failure mode is a pre-existing, environment-only one unrelated to this audit.

---

## Issues

| # | File | Issue | Classification | Action |
|---|------|-------|----------------|--------|
| 1 | `src/app/(app)/settings/page.tsx` `OrgSection` | "Members — **6 people have access**" was a hardcoded literal shown to every real user. | **Fixed** | Wired to Clerk `organization.membersCount` (real count; "Loading members…" until hydrated). |
| 2 | `src/app/(app)/settings/page.tsx` `OrgSection` | "Save changes" button had **no `onClick`** — workspace name + currency inputs never persisted (silent dead CTA). | **Fixed** | Save now persists the workspace name via Clerk `organization.update({ name })` with real pending/success/error feedback. |
| 3 | `src/app/(app)/settings/page.tsx` `OrgSection` | "Manage" (members) button was a **dead CTA** (no handler, no route). | **Fixed** | Removed the non-functional button; Members row is now an honest read-only count. (No `<OrganizationProfile>` route exists to wire it to.) |
| 4 | `src/app/(app)/settings/page.tsx` `OrgSection` | "Default currency" was a **fake-editable** input (`defaultValue="EUR — Euro"`) with no save path. | **Fixed** | Converted to a read-only display row (matches the Workspace region row), since there is no org-currency endpoint. |
| 5 | `src/app/(app)/library/templates/page.tsx` | Template **"Export"** button showed a success toast (`Exported {name}.`) but performed **no download** — pure `setNotice`. | **Fixed** | Added `exportTemplate()` that downloads the previewed envelope as a real file (`.xml/.edi/.x12/.json/.csv`), then shows the notice. |
| 6 | `src/app/(app)/operations/webhooks/page.tsx` `LiveWebhooksPage` | Editing an existing webhook in **live mode** showed "Webhook URL saved" but made **no API call** (no backend update endpoint). | **Fixed** | Message now tells the truth: editing isn't supported yet — delete and re-add to change a URL/event. (No fabricated backend call.) |
| 7 | `src/app/(app)/operations/connectors/page.tsx` `ConnectorPanel` | Editing a connector shows "Connector configuration saved." but the **edit path doesn't persist** anything (real delivery config lives in the supplier's Delivery tab). The "new" path is honest. | **Flagged** | Left as-is. Connectors here are a read-derived view of suppliers; real config is `DeliveryConfigEditor`. Recommend either removing the edit "Save" affordance or routing it to the supplier Delivery tab. Did not fabricate a backend call. |
| 8 | `src/app/(app)/layout.tsx` + `src/app/layout.tsx` (build) | **Pre-existing build break:** a key-less clean build fails because `(app)` prerenders run Clerk hooks (`useOrganization`/`useAuth`) outside `<ClerkProvider>` (the provider only mounts when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set). | **Flagged** | NOT caused by this audit — fails identically on the clean branch base. Verified the build passes 45/45 once the key is present. Recommend either always mounting `ClerkProvider` or gating the `(app)` Clerk-hook components to client-mount only, so key-less CI builds don't fail. Left out of this PR to keep the diff scoped to the truth audit. |

## Legit (mock/marketing — correctly gated, left as-is)

All of the following render demo identities **only** under `isApiMockMode`
(`NEXT_PUBLIC_USE_MOCK === "true"`) or are marketing copy; real signed-in users
see live API data or honest empty states:

| Location | Why legit |
|---|---|
| `src/app/page.tsx` (testimonial "Head of Procurement Ops · Nordic Distribution") | Marketing landing page copy. |
| `src/mocks/handlers.ts`, `src/mocks/data.ts` | MSW mock layer. |
| `src/lib/api-client.ts` (`MOCK_SUPPLIERS`, `mockOrders`, "Acme Manufacturing", "Nordic Electronics", audit demo rows) | All under `MOCK_*` stores gated by `isApiMockMode`. |
| `src/app/(app)/drafts/page.tsx` (`DEMO_DRAFTS`) | `DRAFTS = isApiMockMode ? DEMO_DRAFTS : []` — real users get the empty state. |
| `src/components/bridge/BridgeDashboard.tsx` (`IN_TRANSIT_MOCK_FALLBACK`) | Gated by `isApiMockMode && liveRows.length === 0`; KPIs/topology derive from live orders. |
| `src/components/bridge/SupplierDockProfile.tsx` (`DEMO_MOCK`) | Every `DEMO_MOCK` read is `isApiMockMode ? … : <live/empty>`. |
| `src/components/bridge/InboxView.tsx` (`SUPPLIERS`/`BUYERS`/`SEED`) | Feed `generateOrders`, used only via `MOCK_ORDERS = isApiMockMode ? … : []`. |
| `src/components/bridge/MappingEditor.tsx` (`MOCK_ROWS`) | `isApiMockMode ? MOCK_ROWS : liveRows` (TanStack Query). |
| `src/components/bridge/ValidationRules.tsx` (`RULES`) | `isApiMockMode ? mockRules : liveData`. |
| `src/components/bridge/CrossingsLog.tsx` (`MOCK_LOG`) | `isApiMockMode ? MOCK_LOG : getAuditLog()`. |
| `src/app/(app)/operations/webhooks/page.tsx` (`MOCK_WEBHOOKS`/`MOCK_DELIVERIES`), `library/{templates,buyers}`, `operations/connectors` | Split Mock/Live pages or `isApiMockMode ?` ternaries; live mode uses real API + empty states. `library/standards` is a static reference catalog (not user data). |

---

## Build note

The branch's clean build (no `.env.local`) fails during static prerender of
`/library/standards` (the only fully-static client page in `(app)`) with
`useOrganization can only be used within the <ClerkProvider /> component`. This
is a **pre-existing, environment-only** failure:

- It reproduces identically on the unmodified branch base (verified by stashing
  all audit changes).
- The root cause is `src/app/layout.tsx` mounting `<ClerkProvider>` only when
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set; the committed `.env` has no key, so
  prerender runs the `(app)` layout's Clerk hooks without a provider.
- With the key present (the production / Vercel condition), the build completes
  cleanly: **✓ Generating static pages (45/45)**, including `/library/standards`.

All audit code changes in this PR compile and type-check; none introduce or
worsen this failure. The fix is tracked as flagged item #8.
