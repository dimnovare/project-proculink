import { pageMetadata } from "@/lib/seo";
import {
  SUBPROCESSORS,
  SUBPROCESSORS_UPDATED,
  SUBPROCESSOR_PLANNED_CHANGES,
} from "@/lib/subprocessors";
import { TableScroller } from "@/components/marketing/TableScroller";
import { Card } from "@/components/bridge/layout/Card";
import { LegalH2, LegalPage } from "@/components/marketing/LegalPage";

export const metadata = pageMetadata({
  path: "/subprocessors",
  title: "Subprocessors — ProcuLink",
  description:
    "The current list of ProcuLink subprocessors and what each one processes, any planned change and its effective date, and how to object to a new subprocessor.",
});

// The subprocessor list itself lives in src/lib/subprocessors.ts — the single
// source shared with /security and /privacy so the lists can never diverge.

export default function SubprocessorsPage() {
  return (
    <LegalPage
      title="Subprocessors"
      updated={<>Subprocessor list last changed: {SUBPROCESSORS_UPDATED} · Page version 1.2 (24 July 2026)</>}
      path="/subprocessors"
    >
      <p>
        ProcuLink uses the following subprocessors to deliver the Service. Each subprocessor
        is bound by a written data-processing agreement aligned with the requirements of
        GDPR Article 28.
      </p>

      <LegalH2>Current subprocessors</LegalH2>
      {/* Four columns of Art. 28 disclosure need 465px of min-content; a 375px
          viewport gives this page a 311px content box, so the table used to push
          the document out to 497px and hide the Contract column off-screen. */}
      <TableScroller label="Current subprocessors">
        <table className="min-w-[640px]">
          <thead>
            <tr>
              <th>Subprocessor</th>
              <th>Purpose</th>
              <th>Location</th>
              <th>Contract</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td>{s.purpose}</td>
                <td>{s.location}</td>
                <td>{s.contract}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>

      <LegalH2>Planned changes</LegalH2>
      {SUBPROCESSOR_PLANNED_CHANGES.length === 0 ? (
        <p>
          No subprocessor additions or replacements are currently planned. Anything pending
          appears here, with its effective date, before it starts processing customer data.
        </p>
      ) : (
        // FIVE columns — wider than the current-subprocessors table above, and it
        // renders the moment a planned change is published. Wrapped now, not later:
        // it is only invisible today because SUBPROCESSOR_PLANNED_CHANGES is empty.
        <TableScroller label="Planned subprocessor changes">
          <table className="min-w-[640px]">
            <thead>
              <tr>
                <th>Subprocessor</th>
                <th>Purpose</th>
                <th>Change</th>
                <th>Notice published</th>
                <th>Effective</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSOR_PLANNED_CHANGES.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td>{c.purpose}</td>
                  <td>{c.change}</td>
                  <td>{c.noticePublished}</td>
                  <td>{c.effective}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}

      <Card className="mb-6">
        <strong>30 days&apos; advance notice, published here.</strong> Before a new or
        replacement subprocessor starts processing customer data, it is published under
        Planned changes above — with the date it takes effect — at least 30 days beforehand.
        This page is the source of truth for that commitment: the list carries the date it
        last changed, and a pending change carries the date its notice went up, so you can
        check the 30 days rather than take our word for it.
      </Card>

      <LegalH2>How to object</LegalH2>
      <p>
        Customers who object to a planned subprocessor have 14 days from the notice date shown
        above to raise the objection in writing, to{" "}
        <a href="mailto:legal@proculink.eu">legal@proculink.eu</a>.
        Where the objection cannot be resolved, the customer may terminate the subscription
        without further fees for the unused remainder of the term.
      </p>
      <p>
        We do not operate a notification mailing list — the notice is the dated publication on
        this page, which means it does not depend on anyone remembering to send it. Customers
        who need the notice delivered to a named contact can have that written into their
        agreement; email the address above.
      </p>
    </LegalPage>
  );
}
