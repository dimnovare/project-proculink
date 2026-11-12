/** Where a row opens: the order review. (Invoices lost their own screen; /documents/:id now 308s to the archive.) */
export function documentHref(row: { id: string; documentType?: string | null }): string {
  return `/inbox/${row.id}`;
}
