# ProcuLink — Fable 5 Redesign Brief

The product-structure and screen-level companion to `DESIGN_SYSTEM.md`. This is the
"what to build" doc for Claude Code.

> **User's one sentence:** *"I need to get this messy PO safely to the right supplier in
> the exact format they accept — and prove it happened."*

---

## 1. FRAME — five mental objects

Everything in the product is one of these. Navigation, URLs, and language should reflect them.

1. **Work Queue** — what needs attention now (Dashboard + Inbox).
2. **Order Workshop** — fix and send one order (the locked 3-column page).
3. **Supplier Flow** — the reusable rules for one supplier (identity, samples, mapping,
   validation, output template, delivery channel, test, recent orders).
4. **Output Designer** — make the supplier's output look exactly right.
5. **Operations Proof** — delivery log, audit trail, errors, retries, evidence.

## 2. AUDIT — honest critique of the current product

- **Flat depth.** One shadow everywhere read "template". (Fixed: elevation ramp.)
- **Chrome was generic.** Flat navy, static org block, no pinned primary action, soft
  active states. (Fixed: gradient chrome, org switcher, pinned Upload, crisp active state,
  user chip.)
- **Latent consistency bugs.** Shared-scope name collisions (`SUPS`, `Topbar`) silently
  blanked the Dashboard/Upload headers and corrupted the Suppliers table. (Fixed.) In the
  real Next.js app this class of bug disappears with proper module imports — **keep it that
  way; never rely on global script scope.**
- **Data "swims".** List rows without a fixed column grid misaligned values between rows.
  (Fixed on Inbox/Suppliers; apply everywhere — fixed grid, `tabular-nums`.)
- **Empty states didn't teach.** Several were blank or apologetic. Replace with the teach
  pattern (§7 of DESIGN_SYSTEM).
- **Some surfaces felt too technical too early** (raw XML/JSON as the default output view).
  Push raw to an **Advanced** toggle; lead with the visual/preview.
- **Truthfulness gaps.** UI implied always-on automation for things that still need review.
  See §6 — mark honestly.
- **Mobile was a squeezed desktop.** Re-scope to triage (§9 of DESIGN_SYSTEM).

## 3. BLUEPRINT — information architecture

**Primary nav** (grouped, not a flat 20-item list):

- **Today** — Dashboard / Work Queue
- **Workbench** — Upload · Inbox / Orders · Drafts · Inbound
- **Library** — Suppliers (→ Supplier detail) · Mappings · Output Templates (→ Output
  Designer) · Rules · Connections
- **Operations** — Delivery log · Exceptions / Health · Webhooks · Invoices · ASNs
- **Footer** — Admin · Help · Settings · (org switcher, user chip)

Consolidation: **Suppliers/Buyers/Connections → "Partners" hub**;
**Mappings/Output Templates/Rules → "Rules & formats" hub**;
**Delivery/Exceptions/Webhooks/Invoices/ASNs → "Operations" hub** (sub-tabs inside each).
Keep deep routes valid so links don't break.

## 4. Primary flows — each with all states

**A · First order:** Upload PO → detected source fields → confirm supplier → review issues
→ fix mappings → preview output → deliver → **delivery proof**.
**B · Supplier setup:** Create supplier → accepted formats → output template → delivery
channel → **test delivery** → activate route.
**C · Mapping:** Import source sample → detect columns → match to canonical fields →
resolve item codes → save reusable mapping → test against sample.
**D · Output design:** Choose format → visual structure builder → map fields into output →
preview JSON/XML/CSV/cXML/UBL → validate → save template.
**E · Operations:** See failed/blocked → understand cause → retry / fix / escalate → view
audit proof.

For each flow ship: first-time **empty**, **normal**, **error**, **loading**,
**success/proof**, and **mobile**. Patterns in DESIGN_SYSTEM §7 & §9.

## 5. Screen-by-screen direction

**Marketing home** — bridge hero told as a sequence: *messy order → validated data →
exact supplier output → delivery proof*, in the product's own navy/blue/green + type.
No card soup, no decorative gradients. One promise, one primary CTA, real product frames.
**Pricing** — plain tiers by volume/channels; name what's live vs assisted; one comparison.
**How it works** — the five objects as five steps, each with a real screen.
**Dashboard / Bridge** — action-first: "Needs you" hero table · "Ready to send" w/ one CTA ·
an honest pipeline (one proportion bar + counts that each open the Inbox) · a health rail
(throughput · delivery · connections). No vanity KPIs.
**Upload** — one big dropzone, auto-detected format→supplier, staged file list with
per-file readiness, single forward CTA. Advanced intake (email/API/SFTP-S3) in a quiet
"More ways to bring orders in" rail — present, never in the first-timer's way.
**Order Workshop — LOCKED.** Polish only (spacing, labels, empty/error/loading, mobile
fallback). Do not restructure. See §7.
**Supplier list** — operations table: readiness (dot+word), format, channel, #orders, last
tested. Bulk-select. Empty state teaches "Add your first supplier".
**Supplier detail** — one reusable object with a **readiness header** always answering: is
it ready? what's missing? when last tested? what happens to future orders? Tabs: Identity ·
Samples · Mapping · Rules · Output · Delivery · Recent. Persistent Ready/Needs-setup chip.
**PO field mapping** — source (blue) on the left, canonical/output (green) on the right,
connections between; detect → match → resolve item codes → save reusable → test. AI
suggestions in violet with confidence + Accept/Edit/Dismiss.
**Output Templates / Output Designer** — sample-first: paste/drop the file the supplier
wants → detect structure → map each field (from source / fixed value / leave empty) with
date/number/currency/unit formatting → **live preview** (CSV/JSON/XML/cXML) with a
Valid/N-unset badge → save reusable template. Raw template behind an **Advanced** toggle.
**Rules** — validation rules as readable rows (field · condition · action · severity), test
against a sample, clear pass/fail.
**Connections** — buyer→supplier routes; each shows template + channel + health.
**Delivery log** — append-only; success/failed/rejected states; **Retry** on failure;
**Proof** (timestamp, channel, response payload) on success.
**Exceptions / Health** — failed/blocked orders led by *reason* + next step; system health
(throughput, delivery rate, connection status).
**Webhooks** — endpoint list, event types, last delivery + retry; secret masked (mono).
**Invoices / ASNs** — documents with status; mark EDIFACT INVOIC/DESADV honestly (§6).
**Settings** — goal-grouped, plain language: Organization · Billing · Intake channels ·
API access · Delivery connections · Team & security. Each: title, one-line explanation,
labels + helper text, explicit save state, success/error feedback.
**Help** — searchable, task-oriented ("Set up a supplier", "Fix a failed delivery").
**Mobile shell** — top bar + hamburger drawer + bottom action bar; triage flows only.

## 6. Truthfulness flags (do not imply these are fully live)

Mark as **"Assisted setup"** or **"Coming soon"** in the UI until hardened:

- **EDIFACT INVOIC / DESADV** — mark output/format support explicitly if not production-ready.
- **ERP live sandbox flows** — label as guided/assisted, not one-click live.
- **Scanned / image PDF extraction** — if it still requires human review, say **"Assisted —
  review required"**, never "automatic".
- **Self-service SFTP / S3** where setup isn't hardened — **"Assisted setup"** with a human
  step, not a pure self-serve toggle.

Rule: a control that looks live implies a guarantee. If we can't guarantee it, we label it.

## 7. The locked Order Workshop — polish-only checklist

**Keep exactly:** 3-column spatial model (received/source → mapping/wires → output preview),
the issue-fixing model, the canonical-order concept, wire/connection interaction, and
send-readiness gating. **Allowed polish:** spacing/rhythm, label clarity, the tinted column
headers, empty/loading/error states, the Details drawer, a mobile **summary + "open on
desktop"** fallback, and inherited token/shadow/focus updates. **Forbidden:** replacing the
3-column layout, moving the fix-and-send model elsewhere, or re-theming away from the
blue→green spatial law. If a proposal touches these, reject and revise it.

## 8. Component & copy specifics

Component taxonomy → `DESIGN_SYSTEM.md` §5. Status set → §6. Copy voice → §12. Key strings:
primary create **"Upload order"**; send **"Send to supplier"** / toast **"Sent to {supplier}
— acknowledged."**; blocked **"Resolve blockers to send"**; AI **Accept / Edit / Dismiss**;
supplier **"Ready"** / **"Needs setup — {missing}"**; delivery **"Delivered"** /
**"Failed — {reason}"** / **"Retry delivery"**; destructive **"Delete {thing}? This can't be
undone."**

## 9. Claude Code implementation brief

**Build (in order of leverage):**
1. Wire tokens + preset + fonts (README steps 1–3); confirm shadcn re-skins.
2. Add Button `send`/`ai` variants + the Status badge set to your shadcn components.
3. App shell: grouped nav, pinned Upload, org switcher, user chip, three responsive modes
   (full 240 / rail 64 / mobile drawer).
4. Dashboard (action-first), Inbox (fixed grid + bulk + states), Supplier detail
   (readiness header + tabs), Output Designer (sample-first + live preview), Delivery log
   (retry + proof). Each with all four states.
5. Settings (goal-grouped), Help, mobile triage patterns, marketing alignment.

**Keep:** the current Order Workshop structure; deep routes; the semantic color law; your
Next/Tailwind/shadcn/TanStack/Clerk stack (do **not** introduce Vite, React Router, Lovable,
or admin templates).

**Do NOT touch:** the 3-column Order Workshop layout/interaction/model (§7); the meaning of
blue/green/amber/red/violet/navy; truthfulness of unfinished capabilities (§6).

**Definition of done per screen:** answers the five FRAME questions; uses only ramp shadows;
all figures `tabular-nums`, IDs/paths mono; empty/loading/error/success present; status =
dot + word; keyboard-reachable with visible focus; ⌘K + Esc work; mobile is triage-usable or
hands off to desktop cleanly.

## 10. EVALUATE (target ≥ 9 each; below 9 = revise before shipping the screen)

First-time clarity · procurement-operator usability · integration-specialist power ·
trust & auditability · visual distinctiveness · mobile usability · speed to first PO ·
output-design flexibility · reduction of jargon · Bridge-Layer consistency.

Shipped-in-prototype surfaces (shell, dashboard, inbox, supplier readiness, delivery
proof, output designer) currently hold the 9 bar. Marketing, Rules, Webhooks/Invoices/ASNs,
and full mobile per-screen are **specified here** and are the next build targets — score
them as you implement, not before.
