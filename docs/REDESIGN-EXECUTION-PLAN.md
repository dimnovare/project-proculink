# ProcuLink — "Bridge Layer" Redesign: Execution Plan & Gap Analysis

**Date:** 2026-05-30 (autonomous session) · **Handoff:** `ProcuLink/docs/design_handoff_proculink_redesign/`
**Branch for staged work:** `feat/bridge-layer-redesign`

## TL;DR — the key finding
The handoff **is** the "Bridge Layer" design system the app already runs on (identical tokens: navy `#0B1A2F` / buyer-blue `#1E66C9` / supplier-green `#2E8E3A`, Bricolage + Inter + JetBrains Mono, the link-spine gradient, StatusJourney, confidence tiers 90/75, edge rails). Several screens were already redesigned to it **this session** (Dashboard, Help, PO-mapping magic auto-map, Inbox fixes). So this is **targeted refinement + a few real functional gaps — not a from-scratch overhaul.**

The biggest genuinely-new value is in **(a) the app shell** (collapsible sidebar, notifications popover, mobile bottom-tab/drawer) and **(b) the marketing site** (pre-redesign). Per-screen visual polish is best finished with a human eye (see Constraints).

---

## Per-screen status vs the handoff

| Screen | Component(s) | Status | Key gaps vs reference | Priority | Blind-risk |
|---|---|---|---|---|---|
| Bridge dashboard | `BridgeDashboard.tsx` | ✅ redesigned this session (live topology, wired filters, honest KPIs) | minor polish only | Low | Low |
| Inbox | `InboxView.tsx` | ✅ aligned; freeze fixed | filter chips/bulk-select largely present; verify mobile cards | Low | Med |
| **Review / Canonical Spine** | `SpineReview.tsx` | ✅ **strong** — live 3-col source→spine→output, AI accept/reject, edge rails, standards popovers, confirm dialog, mobile accordion | +keyboard `A`/`C` (✅ added tonight); optional confidence **gutter** on the source doc; green "Cross the bridge" header CTA styling | Low | **High** (core flow — change carefully) |
| Supplier detail | `SupplierDockProfile.tsx`, `PoMappingEditor.tsx` | ✅ PO-mapping redesigned; Overview/Delivery basic | Overview KPI cards + recent crossings; Delivery auto-process **off-by-default** toggle + warning | Med | Med |
| Help center | `app/(marketing)/help/*`, `mdx-components.tsx` | ✅ redesigned this session | — | Done | — |
| **Shell** | `BridgeSidebar.tsx`, `BridgeTopbar.tsx`, `CommandPalette.tsx`, `app/(app)/layout.tsx` | ⚠️ **gaps** | **sidebar collapse → 66px icon rail** (persist `pl-side`, tooltips) — needs a nav icon set added; **notifications popover** (recent exceptions/deliveries, deep-links — I removed the dead bell earlier, re-add a real one); **mobile bottom-tab bar** (Bridge·Inbox·⊕Upload·Search·More) + off-canvas drawer (drawer ✅ exists) | **HIGH** | Med |
| Crossings log | `CrossingsLog.tsx` | ✅ exists (export wired, single-arrow fixed) | click-to-expand detail card (channel/HTTP/duration/retry); event-type filter chips | Med | Low |
| Settings | `app/(app)/settings/page.tsx` | ✅ exists | left sub-nav (Org/Billing/Email/API keys/Connectors) + progressive disclosure | Med | Low |
| Rules / Templates / Standards | `app/(app)/library/{rules,templates,standards}` | ⚠️ basic | Rules: definition panel (WHEN/THEN, severity segment); Templates: live envelope preview w/ `{tokens}`; Standards: cross-format reference table (canonical → cXML/UBL/EDIFACT/X12/Peppol) | Med | Low |
| Buyers / Mappings | `app/(app)/library/{buyers,mappings}` | ⚠️ basic | Buyer detail = connected supplier lanes + recent orders; Mappings = source chips (AI/Manual/Inherited) + usage counts | Med | Low |
| Connectors / Webhooks | `app/(app)/operations/{connectors,webhooks}` | ✅ exist (webhook event-types fixed) | Connectors card grid (Ariba/Coupa/Dynamics/SFTP/IMAP/Erply) | Low | Low |
| Upload | `app/(app)/upload`, `UploadWorkbench.tsx` | ✅ exists | edge-railed dropzone + parse-preview polish | Low | Low |
| **Marketing** (Home, Pricing, How-it-works, Security, Sign-in/up) | `app/(marketing)/*` | ⚠️ **pre-redesign** | full redesign per handoff HTML (hero topology/spine toggle, ROI calculator, 5-tier pricing, posture cards, split-screen auth) | **HIGH** (public face) | Low risk to break (static) but **needs a visual check** |

---

## Recommended execution order (morning, with visual review)
1. **Shell** — sidebar collapse + nav icons, notifications popover, mobile bottom-tab. Affects every screen; do first.
2. **Marketing site** — Home → Pricing → How-it-works → Security → Sign-in/up. Self-contained + safe; biggest visible delta. Reference HTML is detailed and high-fidelity.
3. **Per-screen polish** — Supplier Overview/Delivery, Rules/Templates/Standards, Buyers detail, Crossings expand-detail, Settings sub-nav, Upload.
4. **Review/topology refinements** — confidence gutter, header CTA styling (optional; Review is already strong).

## What I executed tonight (on `feat/bridge-layer-redesign`, build-verified)
- This plan (committed for a fast, directed morning).
- Review keyboard shortcuts: `A` accepts the next AI line suggestion, `C` opens the cross-the-bridge confirm when ready (additive, no visual change). *(See SpineReview.tsx.)*
- _(Further safe, additive wins appended here as completed.)_

## Constraints (why I staged instead of blind-deploying)
- **No local visual verification:** headless Chromium hangs on this machine (confirmed repeatedly), so I can build-verify but not *see* the result. High-fidelity visual work should be eyeballed before it deploys.
- **No autonomous parallelism for the frontend:** chips need a human click (you were asleep) and subagents are sandboxed out of the frontend repo — so frontend work is single-threaded in the main session.
- **Therefore:** I kept staged redesign work on the branch (not merged to `main` → not auto-deployed to your live Vercel/Railway), so nothing unverified ships to users. Review the branch in the morning and merge what looks right.

## Fastest path to finish the heavy visual redesign
Start a **fresh session in the morning** (full context budget) focused on shell → marketing → per-screen, with you available to glance at the preview between screens. That combination — fresh context + your eyes + this plan — will move much faster and safer than blind overnight churn on an already-working app.
