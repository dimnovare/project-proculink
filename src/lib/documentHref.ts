/** Where a document opens: invoices have their own screen, everything else is the order review. */
export function documentHref(row: { id: string; documentType?: string | null }): string {
  return row.documentType === "invoice" ? `/documents/${row.id}` : `/inbox/${row.id}`;
}
