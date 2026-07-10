# Findings — marketing perf + mapper fixed-value picker (2026-07-10)

Recon during the post-remount backlog sweep. Two items that were flagged in an
earlier session but not yet resolved. Neither is shipped here: perf touches
error-tracking infrastructure (founder call) and the picker item is a P2
harness/consistency cleanup. This is the writeup so the decision + fix are scoped.

---

## 1. Marketing performance — the "52/100" is partially stale, but the biggest cost is untouched

**Fixed since the score was taken:** the PostHog-in-initial-HTML regression is
genuinely gone. `src/lib/analytics.ts` now `dynamic import()`s the PostHog SDK
post-hydration and only when `NEXT_PUBLIC_POSTHOG_KEY` is set; a fetch of the live
`proculink.eu` / `/pricing` HTML finds zero `posthog` markers. Both pages are fully
prerendered (real marketing copy in the initial HTML, ~13 KB gzipped, warm TTFB
~120 ms). The perf commit measured first-load JS 379 → 319 KB gz (−16%).

**Still real — the dominant cost the refactor did not touch:** the Sentry client SDK
is statically bundled into the marketing first-load JS. `withSentryConfig`
+ a module-scope `import * as Sentry` in `sentry.client.config.ts` force shared
chunk `4011` (~122 KB gz) onto **every** route, including `/` and `/pricing`
(confirmed: chunk `4011` appears in both prerendered HTMLs; ~159 `sentry` markers in
it, zero clerk/react-dom/recharts). That is ~45% of the ~271 KB gz first-load JS and
the top Time-to-Blocking contributor on marketing. The `NODE_ENV`/DSN guard only
skips `Sentry.init()` — the SDK code still ships. `bundleSizeOptimizations` trimmed
only ~0.8 KB.

Secondary: `src/app/page.tsx` is a 1021-line `'use client'` component (still
SSG-prerendered, but the whole tree hydrates → inflated TBT); fonts load via a
render-blocking `fonts.googleapis.com/css2` external stylesheet on the LCP path;
`next.config.ts` has no `experimental.optimizePackageImports` for the `lucide-react`
barrel imported across ~40 files.

**Recommended (highest leverage first), all founder-reviewable because Sentry is
error-tracking infra:**
1. Keep Sentry off the marketing first-load. Lazy-init the client SDK
   (`import('@sentry/nextjs')` after hydration / on first error signal), or scope
   `withSentryConfig` instrumentation to the `(app)` subtree so marketing routes
   don't carry it. Target: −~120 KB gz first-load on `/` and `/pricing`.
2. `experimental.optimizePackageImports: ['lucide-react']` in `next.config.ts` —
   turns the icon barrel into per-icon imports. Zero-risk, no behavior change.
3. Self-host the two fonts via `next/font` (removes the render-blocking external CSS
   + cross-origin round-trips; keeps `display: swap`).

**Do NOT assume the score is now green** — a Lighthouse/PSI perf score is TBT/LCP
dominated, and 122 KB of Sentry + a client-rendered homepage will still depress it.
Re-measure with a fresh PSI run after item 1 before claiming the number moved.

---

## 2. Mapper fixed-value picker "timeout" — test-harness/consistency issue, not a product bug

A human CAN set a fixed value. In picker mode: click the `SourcePickerChip`
trigger (opens a `createPortal` popover) → click the `= Fixed value…` footer
(`startFixedEdit`) → inline input renders → Enter commits via `onSetFixedValue`
→ `withFixedValue` → `buildOverrideDraft` → `upsertMappingOverride`, and reads back
through the `fixedValues` projection. It round-trips, and the Order Workshop wires
`onSetFixedValue` (`MapperWorkbench.tsx`). No committed test exercises this flow
("recon5" was an ad-hoc reconnaissance order, not a fixture).

Automation times out for two structural reasons, both worth fixing as P2 cleanup:
- The affordance is two synthetic clicks deep inside a portal popover that is
  `visibility:hidden` at `-9999` until a placement effect runs — a locator that
  asserts the input without first clicking trigger→footer never resolves.
- The three fixed-value implementations have **inconsistent a11y contracts**:
  - mapper chip trigger: no `aria-label` (name = state-dependent visible text)
    vs `OutputSourcePicker` trigger: `aria-label="Source for {path}"`
  - footer label `"= Fixed value…"` (leading `"= "`, trailing U+2026)
  - mapper input `aria-label="Fixed value for {path}"` vs plain `"Fixed value"`
    in `OutputMappingEditor` / `OutputStructureDesigner`.
  A cross-surface script never matches a single stable locator.

**Proposed P2 fix (low risk, no behavior change):** add `data-testid="pick-fixed-value"`
to the footer button and a stable `aria-label` to the mapper chip trigger; normalize
the fixed-value input `aria-label` across the three hosts; add one component/e2e test
that clicks trigger → footer → fills → asserts `onSetFixedValue` fired.

**Latent robustness gap (not live):** in picker mode the footer calls
`onSetFixedValue?.()` with optional chaining. A host that enables `mappingMode="picker"`
without passing `onSetFixedValue` would show a working editor whose commit silently
no-ops. The non-picker `= value` chip is correctly gated on the prop's presence; the
picker path should match.
