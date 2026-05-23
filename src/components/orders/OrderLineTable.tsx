import type { OrderLine } from "@/types/procurement";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface OrderLineTableProps {
  lines: OrderLine[];
  currency: string;
}

export function OrderLineTable({ lines, currency }: OrderLineTableProps) {
  const fmt = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="data-table">
        <thead>
          <tr>
            <th className="w-16">Line #</th>
            <th>Buyer Item Code</th>
            <th>Supplier Item Code</th>
            <th>Description</th>
            <th className="text-right">Qty</th>
            <th>Unit</th>
            <th className="text-right">Unit Price</th>
            <th className="text-right">Line Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={line.id}
              className={cn(
                "hover:bg-transparent",
                line.needsReview && "bg-warning-muted/30",
              )}
            >
              <td className="font-mono text-muted-foreground">{line.lineNumber}</td>
              <td className="font-medium">{line.buyerItemCode}</td>
              <td>
                {line.supplierItemCode ? (
                  <span className="font-mono text-sm">{line.supplierItemCode}</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-warning">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span className="text-sm">Missing</span>
                  </span>
                )}
              </td>
              <td className="max-w-xs truncate text-muted-foreground">
                {line.description ?? "—"}
              </td>
              <td className="text-right font-mono">{line.quantity.toLocaleString()}</td>
              <td className="text-muted-foreground text-sm">{line.unit ?? "—"}</td>
              <td className="text-right font-mono">{fmt(line.unitPrice)}</td>
              <td className="text-right font-mono font-medium">
                {fmt(line.quantity * line.unitPrice)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/30">
            <td colSpan={7} className="text-right font-medium">Total</td>
            <td className="text-right font-mono font-semibold">
              {fmt(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
