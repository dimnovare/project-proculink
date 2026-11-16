import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { SUBPROCESSORS } from "@/lib/subprocessors";
import { Eye, History, KeyRound, ListChecks, Lock, MapPin } from "lucide-react";
import { Card } from "@/components/bridge/layout/Card";
import { TableScroller } from "@/components/marketing/TableScroller";
import { SITE } from "@/components/marketing/sitePictures";
import { GHOST_CTA, INK_CTA, SITE_PAGE } from "@/components/marketing/LegalPage";

export const metadata = pageMetadata({
  path: "/security",
  title: "Security & trust — ProcuLink",
  description:
    "How ProcuLink protects the documents you send it and the data it sends on — encryption, EU-region storage, a record of every delivery, and responsible AI.",
  ogDescription:
    "Encryption, EU-region storage, a record of every delivery, access control, and responsible AI — how ProcuLink protects the documents passing through it.",
});

// ─── Security posture (the six feature cards) ──────────────────────────────────

const POSTURE: Array<{ title: string; body: React.ReactNode; icon: React.ReactNode }> = [
  {
    title: "Encryption in transit and at rest",
    body: `Delivery credentials are encrypted at rest with AES-256-GCM authenticated encryption and are never written to application logs. Every outbound channel configured by URL — webhook and HTTP delivery, and S3 ingestion — must use https://, and a plain http:// address is refused when you save it. SFTP is encrypted by construction, and FTPS negotiates explicit TLS. Two connection settings can still weaken that if you switch them on: skipping FTPS certificate validation, and turning SSL off for IMAP or SMTP.`,
    icon: <Lock />,
  },
  {
    // Two facts, kept apart on purpose. WHERE DATA IS STORED is one question;
    // WHICH NETWORK PATH our traffic takes to reach your supplier is a
    // different one, and we can only answer the first. Collapsing the two into
    // a single "EU data residency" string is what made the previous version of
    // this card untrue. See docs/qa/2026-07-30-residency-ground-truth.md in the
    // backend repo for the sourced position behind every sentence here.
    title: "Where your data lives",
    body: (
      <>
        Your files, the database behind them, and the API all run in EU-region
        infrastructure — Cloudflare R2, Neon, and Railway. Some processing runs on named US
        subprocessors under standard contractual clauses: sign-in, AI document extraction and
        mapping suggestions, payments, and email in both directions — the documents sent to your
        flow's address, and the data we email out. If you deliver by
        email, the output itself passes through a US provider. Each one is listed with its
        location and contract on{" "}
        <Link href="/subprocessors">
          /subprocessors
        </Link>
        . Where your data is stored and the route it travels are two different questions: the
        network path out to your supplier is chosen by our hosting provider and is not pinned to
        a region by us, so we cannot tell you today which country an outbound delivery leaves
        from.
      </>
    ),
    icon: <MapPin />,
  },
  {
    title: "What we record for every delivery",
    // The second sentence used to read "Export the full delivery log for any order at any time."
    // It described a per-order export that did not exist. What every plan really gets is one
    // document's history, GET /api/documents/{id}/history (DocumentsController.History), rendered
    // by DocumentScreen.tsx, and the workspace-wide log, GET /api/audit, which plan 14 opened to
    // every plan. Neither is gated.
    //
    // "Append-only" was here before that and had to go: delivery records are updated in place, and
    // erasure (DataErasureService) and retention delete them. Nothing here says records are never
    // deleted; that sentence would be the same falsifiable-by-grep mistake.
    //
    // 2026-11-14, plan 13b: the order pipeline and its per-attempt DeliveryAttempt record were
    // deleted, and with them the timestamp/endpoint/attempt-number/SHA-256/response-body clauses
    // this body used to carry. The document engine keeps one FlowDelivery row per delivery, updated
    // in place (Protocol, Attempts, ResponseCode, LastError, DeliveredAt), and DeliverDocumentJob
    // writes a document.delivered / document.delivery_failed history row carrying the channel,
    // response code and error. The body says only that.
    body: "Every read, edit and delivery is recorded. Each delivery keeps its channel, how many attempts it took, the last response code and, when it fails, the error. You can open any single document and read its complete history.",
    icon: <History />,
  },
  {
    title: "Validation before delivery",
    body: `Built-in checks run on every plan and cannot be switched off: we flag a value that is missing, in the wrong shape or hard to read, and we hold a document we have already seen instead of sending it twice.`,
    icon: <ListChecks />,
  },
  {
    title: "Access control",
    // The second sentence used to read "Role-based access and SAML/OIDC SSO are available on
    // Enterprise — we set them up with you during onboarding." Both halves were unbacked. SSO has
    // no Settings surface and no entitlement consumer anywhere in this app (see the note in
    // plans.ts on the Enterprise card), and role-based access is on no plan's feature list either,
    // so /security was the only surface asserting it. Neither comes back without a screen behind it.
    body: "Org-scoped data isolation on every query, scoped API keys you can revoke instantly, and short-lived sessions by default.",
    icon: <KeyRound />,
  },
  // The no-AI mode is REAL and the old sentence oversold it in three separate ways.
  //
  // What the code actually does — Organisation.SelfHostedOcr, verified 2026-07-31:
  // it suppresses OpenAI at six independent chokepoints (PDF extraction, XLSX
  // extraction, SKU mapping, field auto-map, schema inference, inbound-email NLP),
  // each pinned by a strict-mock `Times.Never` test. A failed READ of the flag is
  // treated as no-egress (OpenAiMappingService.cs, OpenAiSchemaInferencer.cs both
  // `return true` on exception), so the common failure mode is safe. One narrow
  // path is not: both gates open `if (orgId == Guid.Empty) return false`, and the
  // schema inferencer resolves its org id inside a try/catch that yields
  // Guid.Empty — so an unidentifiable tenant fails OPEN on catalog schema
  // inference. Narrow and exception-only, but it is not "fails safe everywhere",
  // and the card's wording should not depend on it being so.
  //
  // What it does NOT do:
  //   • "runs entirely in your environment" — FALSE. The local OCR engine
  //     (RapidOcrNet) runs in-process inside OUR Railway API and Worker
  //     containers. There is no customer-deployable artifact anywhere: no helm
  //     chart, no installer, no tenant-supplied endpoint, zero hits for
  //     Tesseract/OcrProvider/EndpointOverride in the backend repo. The flag
  //     removes one subprocessor; it does not move processing one metre.
  //   • "documents never leave your region" — FALSE, and it follows from the
  //     above: the files still travel to Railway compute, Neon and R2 exactly as
  //     for every other org.
  //   • "Enterprise customers can opt into" — FALSE as stated. There are ZERO
  //     write sites for the flag in production code, no endpoint, no settings
  //     screen, and no BillingFeature/PlanConstants entry binding it to
  //     Enterprise. It is a manual database toggle we set, which is a thing we
  //     do for you, not a thing you can opt into.
  //
  // Also deliberately dropped: the scanned-PDF OCR promise. The engine is only
  // registered when `NoEgressOcr:Enabled` is set, that key appears in NO committed
  // config, and whether it is set on production Railway is not establishable from
  // the repo. So the card claims the guarantee that holds either way — no egress —
  // and not the capability whose production status we cannot check.
  {
    title: "Responsible AI",
    body: "Suggestions never apply themselves: you accept each one, and every value shows how sure we are. Your data is never used to train third-party models. We can also turn AI off for a workspace entirely, so nothing about its documents reaches OpenAI. Documents there cannot be read, because reading uses AI: they are stopped and marked as not read, never sent out. We set that for you on request; it is not a self-serve setting, and it does not change where your files are stored.",
    icon: <Eye />,
  },
];

// The GDPR row said "Compliant · DPA available" and was struck 2026-08-14.
//
// "Compliant" is a legal CONCLUSION about ProcuLink, and nothing anywhere backs it: there
// is no audit, no attestation, no supervisory-authority finding, and no assessment in
// either repo. It was a self-assertion of a verdict, sitting in the same three-row card as
// "Readiness on our roadmap" and "On our roadmap" — two rows that are careful in exactly
// the way it was not — on a page whose other cards already carry four struck claims (see
// the notes at the AI and access-control cards above). Self-certification under GDPR is
// not a thing that exists; the regulation has no certification this product holds.
//
// So the row states ARTIFACTS instead, and only ones a reader can reach:
//   • The DPA is not "available", it is PUBLISHED IN FULL at /dpa (linked in the footer of
//     this page) — Art. 28 processor terms, Annex I–III, Effective July 2026 · Version 1.2.
//     "Published" is both truer and stronger than "available".
//   • SCCs (Commission Implementing Decision 2021/914) cover every extra-EEA transfer —
//     DPA §4. The transfers themselves are named on this page and on /privacy rather than
//     hidden, which is what makes the clause worth citing.
//
// DELIBERATELY NOT WRITTEN HERE: "EU processing". It is false on the normal path — OpenAI
// takes order content for extraction and Postmark carries orders in and out, both US — and
// the three EU-region STORAGE locations this page does name (Railway, Neon, Cloudflare R2)
// are themselves marked UNSOURCED in src/lib/subprocessors.ts:52-66. Residency belongs to
// the "Where your data lives" card, which already states the storage/route split honestly;
// repeating a stronger version of it in a compliance table is how the original defect
// happened. src/app/(marketing)/legalCommitments.test.tsx already fails an EU-processing
// claim; this row must not go looking for the edge of that guard.
const COMPLIANCE_ROWS: Array<[string, string]> = [
  ["GDPR", "DPA published · SCCs for transfers outside the EEA"],
  ["SOC 2", "Readiness on our roadmap"],
  ["ISO 27001", "On our roadmap"],
];

// Where each section of this page starts, for "On this page".
const SECTIONS: Array<[id: string, label: string]> = [
  ["posture", "How your documents are protected"],
  ["compliance", "Compliance"],
  ["subprocessors", "Subprocessors"],
];

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function SecurityPage() {
  return (
    <div className={SITE_PAGE}>
      <section className="pb-20 pt-[72px]">
        <div className={`${SITE.wrap} flex flex-col gap-[26px]`}>
          <h1 className={`${SITE.h1} max-w-[980px]`}>Built for documents you can&apos;t afford to get wrong</h1>
          <p className={`${SITE.lead} max-w-[700px]`}>
            ProcuLink handles the documents your business runs on. We treat that responsibility, and
            your data, with the seriousness it deserves.
          </p>
          <nav aria-label="On this page" className="flex flex-wrap items-center gap-x-7">
            <span className={`${SITE.soft} inline-flex min-h-[44px] items-center text-[15px]`}>On this page</span>
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className={SITE.more}>
                {label}
              </a>
            ))}
          </nav>
        </div>
      </section>

      <section id="posture" aria-labelledby="posture-title" className={`${SITE.band} scroll-mt-24 bg-surface`}>
        <div className={`${SITE.wrap} flex flex-col gap-8`}>
          <h2 id="posture-title" className={SITE.h2}>
            How your documents are protected
          </h2>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(460px,100%),1fr))] gap-x-[72px] border-b border-border p-0">
            {POSTURE.map((p) => (
              <li key={p.title} className="border-t border-border">
                <article className="grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-4 gap-y-2 py-8">
                  <span aria-hidden="true" className="mt-px text-ink">
                    {p.icon}
                  </span>
                  <h3 className={SITE.h3}>{p.title}</h3>
                  <p className="col-span-2 text-[16px] leading-[1.6] text-ink-muted sm:col-span-1 sm:col-start-2 [&_a]:text-brand-blue-deep [&_a]:underline">
                    {p.body}
                  </p>
                </article>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className={SITE.band}>
        <div className={`${SITE.wrap} flex flex-wrap items-start gap-x-[72px] gap-y-14`}>
          <section id="compliance" className="flex min-w-0 flex-[1_1_320px] scroll-mt-24 flex-col items-start gap-[22px]">
            <h2 className={SITE.h2}>Compliance</h2>
            <Card className="w-full">
              <dl className="m-0">
                {COMPLIANCE_ROWS.map(([label, note]) => (
                  <div key={label} className="flex flex-wrap gap-x-6 gap-y-0.5 border-t border-border-faint py-4 first:border-t-0 first:pt-0 last:pb-0">
                    <dt className="w-[110px] shrink-0 font-semibold">{label}</dt>
                    <dd className="m-0 min-w-0 flex-[1_1_200px] text-ink-muted">{note}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Link href="/dpa" className={SITE.more}>
              Read the data processing addendum
            </Link>
          </section>

          <section id="subprocessors" className="flex min-w-0 flex-[1.7_1_520px] scroll-mt-24 flex-col items-start gap-[22px]">
            <h2 className={SITE.h2}>Subprocessors</h2>
            {/* The full purpose and location of each row, as on /subprocessors: a legal list
                never gets a second, shorter wording. The table scrolls inside its box on a
                phone; the page itself never does. */}
            <Card flush className="w-full">
              <TableScroller label="Subprocessors">
                <table className="w-full min-w-[560px] border-collapse text-[15.5px] leading-[1.4]">
                  <thead>
                    <tr>
                      {["Company", "What it does for us", "Where"].map((h) => (
                        <th key={h} scope="col" className="border-b border-border px-[18px] py-[13px] text-left text-[14px] font-semibold text-ink-muted">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="[&>tr+tr>td]:border-t [&>tr+tr>td]:border-border-faint">
                    {SUBPROCESSORS.map((s) => (
                      <tr key={s.name}>
                        <td className="whitespace-nowrap px-[18px] py-[13px] align-top font-semibold">{s.name}</td>
                        <td className="px-[18px] py-[13px] align-top">{s.purpose}</td>
                        <td className="px-[18px] py-[13px] align-top text-ink-muted">{s.location}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroller>
            </Card>
            <Link href="/subprocessors" className={SITE.more}>
              Full list with locations, contracts, and change notifications
            </Link>
          </section>
        </div>
      </div>

      <section className={`${SITE.band} border-t border-border`}>
        <div className={`${SITE.wrap} flex flex-wrap items-center gap-x-16 gap-y-8`}>
          <div className="flex flex-[1_1_460px] flex-col gap-4">
            <h2 className={SITE.h2}>Need our security package?</h2>
            <p className={SITE.lead}>
              We&apos;ll share our DPA, security overview, and architecture documentation under NDA.
            </p>
            <p className="m-0 text-[15px] text-ink-muted">
              Found a security problem? Write to{" "}
              <a href="mailto:security@proculink.eu" className="text-brand-blue underline">security@proculink.eu</a>.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 [&>*]:flex-auto">
            <a href="mailto:security@proculink.eu?subject=Security%20package%20request" className={INK_CTA}>
              Request security docs
            </a>
            <Link href="/sign-up" className={GHOST_CTA}>
              Start free
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}