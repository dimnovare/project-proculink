# ProcuLink Final Release Decision

**Date:** 2026-08-25 · **Audit round:** 6 of 6 (final gate) · **Corpora:** FE `78e7a12` / BE `1c7fcb2c` at audit start; fixes merged during the audit are listed in §F.

---

## LIMITED GO — READY FOR FOUNDER-ASSISTED PILOTS

One step short of unconditional GO, and the step is named: nothing **pages** the founder when production breaks (alerts are real and now fire at pilot volume, but they land in a mailbox), and supplier onboarding for SFTP/FTPS/ERP channels is founder-assisted by design — which the product itself already discloses ("we verify it with you on a real folder before go-live"). Both are acceptable for pilots **because they are deliberate and documented** — the exact definition of LIMITED GO.

Would I put a real customer's purchase orders through this system tomorrow? **Yes** — with the founder watching the alert mailbox during business hours, which is precisely what a founder-assisted pilot is.

---

## A. Executive summary

This was the sixth audit round. Thirteen parallel auditors examined both repositories as one product across every dimension of the brief — pipeline, duplicates, security, billing, capability truth, status language, operations, database, tests, UX, performance, fake surfaces, and reconciliation of all five prior audits. They produced **39 raw findings**; every P0/P1 candidate was then **adversarially verified by independent agents instructed to refute it**.

The result: **zero P0. Four confirmed P1 — three of which were fixed, tested, and merged during this audit.** One P1 candidate was refuted outright by the verifier (the /subprocessors residency claims are true; the finder had stale facts). The remaining P1 is a founder-owned records item, not a product defect. 8 P2 (one fixed here; seven safe to address during the pilot) and 26 P3.

Against that, the full validation matrix ran for real:

| Suite | Result |
|---|---|
| Backend build (Release) + tests | **6,859 passed / 0 failed** (18 skips: all env-gated `Live_*` tests with their own live harness) |
| Frontend typecheck / lint / 5 conformance gates | clean |
| Frontend unit | **5,296 passed / 0 failed** (3 skips: backend-mirror suites, run in CI with the backend checkout) |
| Frontend e2e | green (9 machine-load flakes re-run in isolation: 15/15) |
| Frontend a11y (axe, WCAG A/AA) | **29 / 0** |
| Frontend production build | clean |
| Production edge | all public pages 200, zero broken links, zero mobile overflow at 375px, API `/health/ready` all five checks Healthy |

And — the strongest evidence in this report — the finders returned **165 verified-clean areas** with file:line citations: the status machine's per-edge rationale, atomic claims on every pipeline stage, DB-enforced delivery idempotency, four stuck-order sweeps, fail-closed admin allowlists, IL-verified billing gates, model-derived GDPR erasure coverage, two-directional test-vacuity guards. After five rounds of fixing, the sixth round's finding is that the floor is real.

**Why not full GO:** the paging gap. Detection is comprehensive and (after this audit's fix) fires at pilot volume, transport is proven — but the last hop is a mailbox. A 03:00 failure waits for the founder's morning coffee. For a founder-assisted pilot at tens of orders/day this is an accepted, documented posture; for unattended operation it is not.

## B. Persona readiness scores (0–10)

| Persona | Score | One-line justification |
|---|---|---|
| Buyer / procurement client | **8** | Clear flow upload→review→send; honest failure copy with retry everywhere; duplicate warning now at the send decision; onboarding is 2 steps + optional practice order |
| Supplier | **7** | Delivery config, payload preview, test actions all real; SFTP/FTPS/ERP setup founder-assisted (disclosed); no supplier-facing portal (by design at this stage) |
| Admin / founder | **7** | 11 admin endpoints, 6 with screens; ops-health, stuck-order requeue, order-find by PO, audit trails; some rare actions deliberately curl-only (documented runbooks) |
| Support | **8** | PO number → org lookup endpoint; per-order passport/timeline; delivery attempt history with responses; §6 ticket simulation diagnosable in minutes from the UI |
| Integration specialist | **8** | Field mapping, output trees, validation rules, per-supplier delivery config, cmd-K power commands as progressive disclosure; raw diagnostics via ops surfaces |

## C. Product scores (0–10)

| Dimension | Score | Note |
|---|---|---|
| Core order pipeline | **9** | Explicit status machine, atomic stage claims, no silent disappearance path found |
| Reliability | **9** | Idempotent jobs, DB-enforced delivery uniqueness, crash-recovery sweeps for every transient status |
| Recovery | **9** | Retry/requeue guarded by named status sets; billing holds instead of drops; honest history |
| UI/UX | **8** | All UX findings were Class A (small); zero Class B/C redesigns warranted after five polish rounds |
| Ease of use | **8** | Next action obvious on every major screen; empty/error/loading states complete with retry |
| Navigation | **8** | 4-hub nav, tooltips derived from visible tabs, no dead ends, retired routes 308 |
| Mapping | **8** | Persistence proven live; AI suggestions with visible accept step; versioning minimal but real |
| Delivery | **8** | HTTP production-ready; email/SFTP/FTPS pilot-ready as disclosed; ERP founder-assisted as disclosed |
| Security | **9** | Fail-closed everywhere sampled; SSRF policy at save+dispatch; secrets never echoed |
| Tenant isolation | **9** | Global query filters both auth schemes; 4 justified cross-org reads; IDOR sampled clean |
| Billing | **9** | FE/BE ladder parity exact; gates IL-verified; refusal codes matched whole; paused states honest |
| Observability | **7** | Detection comprehensive; alert cooldowns durable; **paging gap** is the deduction |
| Testing | **9** | ~12,200 real tests; vacuity guards with floors; mutation-checked guards; env-gated skips declared |
| Performance | **8** | Server pagination, hot-path indexes, parallel FE queries; one unbounded endpoint (P2) |
| Accessibility | **8** | axe clean incl. open overlays; tap-target floors enforced; contrast tokens tested |
| Marketing truth | **9** | Every claim traced to code; "unusual honesty" (auditor's words) on ERP/Peppol/scanned-PDF limits |
| **Overall release readiness** | **8** | LIMITED GO |

## D. Previous audits — reconciliation

All five prior audit documents were reconciled item-by-item against current code:

- **FE AUDIT-FINDINGS.md** (8 items): 5 fixed+verified, 3 no longer relevant.
- **docs/audit/2026-07-11 UI/UX+a11y** (12 items): 11 fixed+verified, 1 partial (fixed-value picker aria-labels — P3).
- **docs/reports 2026-07-10 + 2026-07-27**: all perf recommendations fixed; CSP builder shipped; CSP remains report-only by deliberate "measure then flip" plan (P3 to schedule).
- **BE STATUS.md open items**: both resolve-recompute holes fixed with endpoint guards.
- **Capability-truth ledger**: refuted-findings list respected (none re-opened); open unknowns #1, #3-part, #5, #6, #11 now resolved; #9 (rotation record) and #10 (filename-change notice) remain — both founder actions, both in §E.
- **AUDIT-2026-08-13-V3 P0 sweep**: all 12 spot-verified as still fixed. No regressions found anywhere.

## E. Final findings

### P0 — blocks release
**None.**

### P1 — fix before first pilot
| # | Finding | Status |
|---|---|---|
| 1 | Flagged duplicate never reached the send screen — `getOrderExceptions` had zero consumers; a clean second copy of a PO showed no warning where Send happens | **FIXED** — FE [#247](https://github.com/dimnovare/project-proculink/pull/247) merged `979d74b5` |
| 2 | Settings promised automatic inbound-email import to every plan while the backend silently drops Pilot orgs' hosted mail at the Growth gate (sender gets no bounce) | **FIXED** — FE [#246](https://github.com/dimnovare/project-proculink/pull/246) merged `2743a710` (billing-aware, fail-closed, derived tiers) |
| 3 | Delivery alert arithmetically could not fire at pilot volume — dead-letter threshold 25 vs Pilot cap of 20 orders total | **FIXED** — BE [#248](https://github.com/dimnovare/ProcuLink/pull/248) merged `e910c47a`; threshold now 1, default mutation-tested |
| 4 | Capability ledger unknown #9 still records three 2026-07-27 leaked keys (OpenAI, PostHog, Neon password) as unrotated, with no closure entry anywhere | **FOUNDER** — if rotation is done (as stated), write the closure record in the ledger; if that particular set was missed, rotate it. Five minutes either way |

One further P1 candidate — "/subprocessors residency labels contradict recorded facts" — was **REFUTED** by adversarial verification: the R2 bucket was migrated to EU jurisdiction 2026-08-16 (46/46 objects, ETag-verified), Neon is eu-central-1, Railway is EU. The public page is true. Residual P3: the file's own header comment still marks the claims "unsourced".

### P2 — safe to address during pilot (7 open)
1. **SFTP/FTPS filename-change notice (.dat→.xml) drafted but never sent** — a supplier automation matching `*.dat` receives nothing while delivery reads success. Send the notice; close ledger #10. *(Founder, minutes.)*
2. **Auto-send dry-run evidence has no UI reader** — the founder's own stage-2 gate ("dry-run one full week") can't be evaluated from the product. Small read-only card on ops-health.
3. **Parse-failure writer unguarded** — a duplicate parse job could stamp terminal `failed` over a concurrent success. Mirror the transform leg's atomic claim.
4. **`pipeline_failure_backlog` threshold-1 has no drain** — one abandoned unparseable upload = alert every 30 min forever. Window the count or add a high-watermark.
5. **Wedged job dispatcher invisible to monitors** — the gap is documented in code; expose recurring-job liveness on the readiness JSON.
6. **AI provider outage degrades silently to regex parsing** — log the fallback at Error or add a provider-error-rate alert signal.
7. **`GET /api/exceptions` unbounded** — paginate like the audit log (clamped Skip/Take).

### P3 — polish / future (26)
Highlights: stale header comment in subprocessors.ts; middleware matcher skips dotted paths (renders shell, APIs still refuse — defense-in-depth only); two unknown-status fallbacks render decided states; `workerHealthy` fails open when the check entry is absent; nine ledger tables lack FKs to organisations; org-wide audit missing `(org_id, created_at)` index; QA-bypass production guard untested; wizard "setup guide" link targets a collapsed element; "Supplier changes" nav label vs "connections" page vocabulary; dashboard stats as 4 sequential counts. Full list with evidence in the audit findings JSON (session scratchpad `audit6-findings.json`).

## F. Changes made in this audit

| Repo/PR | Problem | Change | Test |
|---|---|---|---|
| BE [#248](https://github.com/dimnovare/ProcuLink/pull/248) `e910c47a` | Dead-letter alert threshold 25 unreachable at pilot volume | Default → 1 (matching `PipelineFailureThreshold`'s pilot-scale precedent); runbook updated both places | Default now pinned by test; **mutation-checked** (fails on 25, passes on 1); 48/48 + 4/4 |
| FE [#247](https://github.com/dimnovare/project-proculink/pull/247) `979d74b5` | Duplicate flag invisible at the send decision | New `OrderExceptionsNotice` on the review screen: open order-level exceptions as amber "Possible duplicate" StatusNotice, backend message verbatim, **non-blocking**; failed check says so (never silent all-clear); StatusNotice gains `warning` tone | 4 new tests + tone-walk floor; 603 + 164 guard tests green |
| FE [#246](https://github.com/dimnovare/project-proculink/pull/246) | False "imported automatically" promise to gated plans | `InboundAddressSection` billing-aware, fail-closed (promise renders only when plan confirmed); refusal copy + upgrade route with tiers **derived** from PLANS; `/formats` hosted row gains its siblings' tier label; claims-guard extended to pin it | 8 new tests incl. full ladder walk; claims guard 111/111 |

All three merged through the standard gate: ancestry check + CI created after head + verified SUCCESS.

## G. UX improvements

The duplicate warning (§F) is the one interaction change: the operator now sees the risk at the moment of decision instead of on a page they had no reason to visit — one fewer navigation, one fewer class of silent mistake. No click-count changes elsewhere: all UX findings were Class A and none showed measurable friction worth touching this close to pilot.

## H. Claude Design prompts generated

**None — deliberately.** Every design finding in this round was Class A (small fixes). After five rounds that reshaped the review workbench, dashboard, upload, suppliers, and settings, the sixth round found no workflow whose redesign would materially improve efficiency or clarity. Generating design prompts anyway would be manufacturing work.

## I. Founder-assisted functionality (documented, acceptable for pilots)

1. **Alerting last-hop**: alerts are real, fire at pilot volume (post-#248), and are delivered by Postmark (proven 12/12) — to a mailbox. The founder is the pager. *Open ledger item: one push-capable channel (mail-to-SMS is the cheapest path).*
2. **SFTP/FTPS delivery go-live**: verified with the customer on a real folder — disclosed in-product.
3. **Erply/Directo ERP delivery**: adapters real, validated with unit/mock tests; first production use founder-attended — disclosed in `/help` with (the auditor's words) "unusual honesty".
4. **Supplier mapping setup**: AI suggestions + manual editor are self-service; the founder should sit in on the first supplier of each new format family.
5. **Peppol/AS2/AS4**: "on request through a partner" — a sales conversation, not a feature.

## J. Features not ready for clients (hidden or labelled — verify they stay that way)

- **ASN / inbound DESADV**: page renders no upload control; backend answers 501. Honest.
- **Peppol BIS outbound**: catalog says `planned`; emitted documents declare no Peppol profile. Honest.
- **Auto-send**: dry-run stage 1 only, pinned from compiled IL; cannot deliver anything unattended. Stage 2 blocked on the founder's one-week-evidence ruling (and P2 #2: the evidence needs a UI).
- **Peppol BIS invoice**: experimental/API-only, disclosed as unverified in the catalog conformance note.

## K. Known limitations (stated plainly)

- No pager. A 03:00 incident is discovered at 08:00.
- Scanned-PDF extraction depends on the AI provider; provider outage degrades to regex silently (P2 #6).
- Duplicate protection is detect-and-warn, not block — deliberate (PO revisions are legitimate), now visible at Send, but an operator can still click through it.
- Delivery beyond HTTP (SFTP/FTPS/email) is container-tested, not yet volume-proven with a real supplier at production cadence.
- Single production region posture (EU); no DR rehearsal has been run.
- One live 500 class remains known and rare: freshly-created org's first `/api/dashboard/topology` request during the org-attach window (seen once, 2026-08-23; awaiting the founder's API-contract ruling — 401 vs 409 vs machine code).

## L. First customer recommendation

**Ideal profile:** a buyer-side procurement team (5–50 people) in DACH/Nordics/Baltics sending POs to 3–10 suppliers, currently re-keying or reformatting manually.
- **Input**: CSV or XLSX exports from their ERP (the two live-proven formats), plus text-PDF as the stretch.
- **Suppliers**: start with 2–3; at least one on **HTTP webhook or email delivery** (production-ready paths), one on SFTP if they have it (founder-attended go-live).
- **Target format**: supplier's CSV/JSON template or cXML.
- **Volume**: 5–30 orders/week — inside every alert threshold and quota comfortably.
- **Pilot scope**: 4 weeks; week 1 founder-assisted setup + parallel-run (ProcuLink alongside the old process), weeks 2–4 ProcuLink primary with the old process as fallback.
- **Founder involvement**: mapping setup for each supplier (~1h each), daily mailbox check, weekly review call.

## M. Pilot success criteria (measurable)

1. ≥95% of uploaded orders parse without founder intervention (excluding genuinely malformed inputs).
2. Every exception the customer hits is understood and resolved by the customer from the UI copy alone — count of "what does this mean?" support pings ≤ 3 over the pilot.
3. Mapping corrections persist: the same correction never made twice for the same supplier field.
4. 100% of delivered orders verifiably received by the supplier (spot-check receipts weekly).
5. Zero duplicate deliveries; every duplicate flag reviewed at Send.
6. Every delivery failure recovered ≤ 1 business day, from the product (no SQL).
7. Zero tenant-boundary incidents.
8. Alert mailbox contains zero uninvestigated alerts at pilot end.
9. The customer agrees to be a reference, or states concretely why not.

## N. Exact release checklist — run immediately before onboarding customer #1

**Public surface (10 min)**
- [ ] `proculink.eu`, `/pricing`, `/formats`, `/security`, `/help` → 200, content renders
- [ ] `api.proculink.eu/health/ready` → all five checks Healthy
- [ ] Sign-up → new org → lands on dashboard greeting (proves Clerk + provisioning + cold-start fix)

**Pipeline rehearsal in a throwaway org (30 min)**
- [ ] Create supplier; configure HTTP delivery to a request bin
- [ ] Upload the pilot customer's REAL sample PO (get one before the pilot!)
- [ ] Parse succeeds → review screen shows source left, mapping middle, preview right
- [ ] Introduce one bad item code → exception appears → fix it → mapping persists (re-upload proves no re-fix)
- [ ] Send → transform → delivered to bin; payload correct; audit trail complete
- [ ] Upload the same PO again → "Possible duplicate" warning renders at Send
- [ ] Point delivery at an unreachable URL → send → clear failure state → fix URL → retry → delivered; history accurate
- [ ] Check `/operations/log` and the order passport tell the same story

**Truth + safety spot-checks (10 min)**
- [ ] Billing page shows the org's real plan, limits, and usage
- [ ] Sign in as org B (second throwaway); confirm org A's order id → 404, supplier id → 404
- [ ] API key created → works; revoked → refused
- [ ] Alert mailbox received the delivery-failure alert from the rehearsal (post-#248 this fires on ONE dead-letter — the rehearsal above won't dead-letter unless you let retries exhaust; optionally force it, or verify the alert path with the ops-health panel)

**Founder items (before, not during)**
- [ ] Ledger unknown #9: rotation closure record written (or rotation done)
- [ ] Ledger unknown #10: .dat→.xml supplier notice sent
- [ ] Both throwaway orgs deleted; Clerk users removed
- [ ] Phone-forwarding rule (or mail-to-SMS) on the alert mailbox for the pilot window — the cheapest possible pager

---

*Method note: 13 parallel read-only auditors over pinned worktrees (FE `78e7a12`, BE `1c7fcb2c`), 39 raw findings, every P0/P1 candidate adversarially verified by an independent agent instructed to refute it (1 of 5 was), 165 clean areas recorded with citations, full local validation matrix executed (never inferred from CI), production checked by fetch. Fixes merged through the ancestry+CI gate. This document supersedes nothing and manufactures nothing: it is the sixth and final internal gate.*
