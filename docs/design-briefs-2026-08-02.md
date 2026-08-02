# Claude Design prompts — 2026-08-02

Four design decisions surfaced by this week's work. Each is self-contained: paste one into Claude
Design as-is.

**Shared context to keep in every prompt** — the Bridge Layer direction is LOCKED (frontend
`CLAUDE.md` §2). Navy chrome `#0B1A2F`, warm light work area `#F6F7FA`, 3px cross-section card edges,
Inter for UI at 13/14px, Bricolage Grotesque for KPIs. No decorative gradients, no glassmorphism, no
sparkles, no modals where a drawer or inline editor will do. Canonical design files live in
`ProcuLink/docs/design-system/`; start with `00-agent-quick-brief.md`.

---

## 1 · Desktop tap targets — the deferred half of WP-31 (HIGHEST VALUE)

**Paste this:**

> ProcuLink is a B2B procurement workbench — a dense operator tool, navy chrome over a light work
> area, Inter at 13–14px, table rows at 12–12.5px. Power users work it all day on desktop.
>
> An accessibility audit measured the desktop breakpoints and found roughly fifty interactive
> controls below the 44×44px comfortable floor, including several below WCAG SC 2.5.8's hard 24px
> minimum:
>
> - `/settings` — 17 controls under 44px, plus a 13px-tall input
> - `/operations/webhooks` — 21 controls under 44px, including a 32px button with 12.5px text
> - `/pricing` — a 20.3px link, which is under the 24px hard floor
>
> The existing touch floors were deliberately scoped to coarse-pointer and viewports under 640px, so
> desktop was never covered. A previous packet declined to fix this mechanically, on the grounds that
> bumping ~50 controls across six surfaces is a visual change that would ship a density regression
> unreviewed.
>
> **Design the resolution.** I need a considered position, not a global padding increase:
>
> 1. Where is 44px genuinely right on desktop, and where would it destroy the density these operators
>    depend on? Give me the rule you would apply, not just the outcome.
> 2. For the controls that stay small, what makes them still hittable — spacing between targets, a
>    larger hit area than the visible control, hover/focus affordance?
> 3. The 24px hard minimum is non-negotiable. Show me the smallest control size that satisfies it and
>    still looks correct at 13px type.
> 4. Show `/settings` and `/operations/webhooks` before and after at 1280×900, so I can judge the
>    density cost directly.
>
> Constraint: no new component library, no per-screen theming — one token system across the product.

---

## 2 · SFTP host-key trust — a screen that does not exist yet

**Paste this:**

> ProcuLink delivers purchase orders to suppliers over SFTP. Until this week it never checked the
> server's identity: a supplier's server could be swapped for another and the order — and the
> password — would go to the new one silently.
>
> The backend now records the server's fingerprint on first connection and refuses if it ever changes
> (trust-on-first-use), with an optional fingerprint an operator can pin in advance. **There is no UI
> for any of it.**
>
> Design the operator surface, inside a supplier's Delivery settings tab. It has to carry four states:
>
> 1. **Not yet connected** — nothing recorded. Optionally let the operator paste a fingerprint their
>    supplier gave them, so even the first connection is verified.
> 2. **Trusted** — show the recorded fingerprint in OpenSSH form (`SHA256:` + base64), because the
>    operator will compare it against what `ssh-keygen -lf` prints or what their own SSH client shows.
> 3. **Refused** — the key changed. This is either a legitimate server rebuild or an attack, and the
>    screen must not assume either. Show both fingerprints, say plainly what we refused to do, and
>    give a deliberate re-trust action that cannot be hit by accident.
> 4. **Pinned** — an expected fingerprint was set by hand, so first-connect is verified too.
>
> The audience is a procurement operator, not a sysadmin. They will not know what a host key is.
> Explain it in the screen without a tutorial, and without pretending the refusal is routine.
>
> Copy rules: plain procurement language, no jargon, no bridge metaphors. A refusal must always offer
> a next step — a dead end is its own defect here.

---

## 3 · Pricing and security pages after two claims were removed

**Paste this:**

> Two capabilities were being sold that the product does not deliver, and both bullets were removed
> this week: SSO (no settings surface exists) and Peppol BIS 3 conformance (never validated). They
> came off `/pricing` and `/security`.
>
> Review both pages now that the bullets are gone. Specifically:
>
> 1. Do the plan cards still balance? Removing a bullet from one tier can leave it looking thinner
>    than the tier below, which reads as worse value rather than as honesty.
> 2. `/security` had a trust claim removed. Does the page still make its case, or does it now have a
>    hole where a reassurance used to be?
> 3. Is there something true we are NOT saying that would carry the same weight? Prefer a real
>    capability stated plainly over a gap.
>
> Six tiers: Pilot (free 14 days), Growth €149, Operations €399, Integration €999, Distributor €1,499,
> Enterprise custom. The differentiator is a visual output designer that emits supplier-specific
> formats — that is the thing worth selling.
>
> Do not invent capabilities. Every bullet must correspond to something the backend actually enforces.

---

## 4 · What the practice order does at the end

**Paste this:**

> New ProcuLink users are offered a practice order: a sample purchase order they can run through the
> whole flow — parse, review, fix a mapping, generate the supplier's file — without using their own
> data. It exists so onboarding completes in one sitting.
>
> A live production run found the last step is broken. The practice order reaches "send", and the
> delivery target it was seeded with is dead, so every new user who follows the flow to its end gets
> a 404.
>
> Design the ending. Two honest options, and I want a recommendation with reasoning:
>
> **(a) Deliver it for real** to an endpoint we control that echoes it back — the user sees a genuine
> delivery, a real receipt, a real audit entry. Highest confidence, but we are simulating a supplier
> and must not imply a real one received it.
>
> **(b) Stop before delivery** — the practice order goes as far as a generated, downloadable
> supplier-ready file and says plainly that sending needs a real supplier configured. Honest and
> simpler, but the user never sees the payoff moment the product is built around.
>
> Whichever you recommend, design the final screen: what the user sees, what they are told, and what
> the single next action is. The purpose of the practice order is to make someone believe the product
> works — an ending that feels like a trick would be worse than no practice order at all.
