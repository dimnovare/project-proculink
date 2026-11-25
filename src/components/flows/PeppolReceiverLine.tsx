"use client";

import { useQuery } from "@tanstack/react-query";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { getPeppolReceiver, type PeppolReceiver } from "@/lib/api/documents";

const MUTED = "text-ink-muted";
const UNKNOWN: [string, string] = ["We couldn't check Peppol right now.", MUTED];

/** Words and tone by allow-list: a status this build does not know, or a found without a yes/no, is "couldn't check", never a negative. */
function describe(r: PeppolReceiver, creditNote: boolean): [string, string] {
  const noun = creditNote ? "credit notes" : "invoices";
  const one = creditNote ? "credit note" : "invoice";
  const id = r.participant ?? "";
  const takes = creditNote ? r.creditNote : r.invoice;
  switch (r.status) {
    case "found":
      if (takes === true) return [r.derived
        ? `This buyer can receive Peppol ${noun} as ${id}, found from their VAT number. Add it as the Receiver Peppol ID so the ${one} is addressed to them.`
        : `This buyer can receive Peppol ${noun} (${id}).`, "text-brand-green-deep"];
      return takes === false ? [`This buyer is on Peppol (${id}) but doesn't receive Peppol ${noun}.`, "text-amber-text"] : UNKNOWN;
    case "not_found":
      return [r.derived
        ? `No Receiver Peppol ID was read, and the buyer wasn't found on Peppol from their VAT number (${id}).`
        : `This buyer wasn't found on Peppol (${id}). Check the Receiver Peppol ID, or send another way.`, "text-amber-text"];
    case "no_id":
      return ["No Receiver Peppol ID was read, so we can't check whether this buyer is on Peppol.", MUTED];
    case "invalid_id":
      return [`"${id}" isn't a Peppol ID. It looks like 0208:0123456789: a four-digit scheme, a colon, then the number.`, MUTED];
    default:
      return UNKNOWN;
  }
}

/** On a Peppol BIS output: can this document's buyer receive it on Peppol. Display only; it never blocks a send. */
export function PeppolReceiverLine({ documentId, creditNote }: { documentId: string; creditNote: boolean }) {
  const enabled = useTenantQueriesEnabled();
  const q = useQuery({
    queryKey: ["peppol-receiver", documentId], queryFn: () => getPeppolReceiver(documentId),
    retry: false, refetchOnWindowFocus: false, staleTime: 10 * 60_000, enabled,
  });
  if (!enabled && !q.data) return null; // never "Checking Peppol…" for a check that will not run
  const [words, tone] = q.data ? describe(q.data, creditNote) : q.isError ? UNKNOWN : ["Checking Peppol…", MUTED];
  return <span className={`text-[12.5px] ${tone}`}>{words}</span>;
}
