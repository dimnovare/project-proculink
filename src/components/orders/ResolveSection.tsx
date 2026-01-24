import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";
import type { PurchaseOrder, PurchaseOrderLine } from "@/types/procurement";

interface ResolveSectionProps {
  order: PurchaseOrder;
  onOrderUpdated: (order: PurchaseOrder, messages: string[]) => void;
}

export function ResolveSection({ order, onOrderUpdated }: ResolveSectionProps) {
  const missingLines = order.lines.filter(
    (line) => !line.supplierItemCode || line.supplierItemCode.trim() === ""
  );

  const [resolutions, setResolutions] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    missingLines.forEach((line) => {
      initial[line.lineNumber] = "";
    });
    return initial;
  });
  const [saveMappings, setSaveMappings] = useState(true);
  const [isResolving, setIsResolving] = useState(false);

  const allFilled = missingLines.every(
    (line) => resolutions[line.lineNumber]?.trim()
  );

  const handleInputChange = (lineNumber: number, value: string) => {
    setResolutions((prev) => ({
      ...prev,
      [lineNumber]: value,
    }));
  };

  const handleResolve = async () => {
    if (!allFilled) return;

    setIsResolving(true);
    try {
      const result = await apiClient.resolvePurchaseOrder(order.id, {
        saveMappings,
        lineResolutions: missingLines.map((line) => ({
          lineNumber: line.lineNumber,
          supplierItemCode: resolutions[line.lineNumber].trim(),
        })),
      });

      toast({
        title: "Order Resolved",
        description:
          result.order.automationStatus === "Automatable"
            ? "All issues resolved. Order is now ready for automation."
            : "Some issues remain. Please review the validation messages.",
      });

      onOrderUpdated(result.order, result.validationMessages);
    } catch (error) {
      toast({
        title: "Resolution Failed",
        description:
          error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsResolving(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: order.currency,
    }).format(amount);
  };

  if (missingLines.length === 0) {
    return null;
  }

  return (
    <Card className="border-warning/30 bg-warning-muted/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-warning-foreground">
          <AlertCircle className="h-5 w-5" />
          Resolve Missing Supplier Item Codes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-warning-foreground/80">
          The following {missingLines.length} line
          {missingLines.length !== 1 ? "s" : ""} require supplier item codes
          before this order can be automated.
        </p>

        <div className="rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Line</TableHead>
                <TableHead>Buyer Item Code</TableHead>
                <TableHead className="hidden sm:table-cell">Description</TableHead>
                <TableHead className="text-right w-20">Qty</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Price</TableHead>
                <TableHead className="w-48">Supplier Item Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {missingLines.map((line) => (
                <TableRow key={line.lineNumber}>
                  <TableCell className="font-mono text-sm">
                    {line.lineNumber}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {line.buyerItemCode}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {line.description}
                  </TableCell>
                  <TableCell className="text-right">
                    {line.quantity.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right hidden sm:table-cell">
                    {formatCurrency(line.unitPrice)}
                  </TableCell>
                  <TableCell>
                    <Input
                      placeholder="Enter code..."
                      value={resolutions[line.lineNumber] || ""}
                      onChange={(e) =>
                        handleInputChange(line.lineNumber, e.target.value)
                      }
                      className="h-8 font-mono"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="save-mappings"
              checked={saveMappings}
              onCheckedChange={(checked) => setSaveMappings(checked === true)}
            />
            <Label
              htmlFor="save-mappings"
              className="text-sm text-muted-foreground cursor-pointer"
            >
              Save as mappings for future orders
            </Label>
          </div>

          <Button
            onClick={handleResolve}
            disabled={!allFilled || isResolving}
            className="shrink-0"
          >
            {isResolving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Resolving...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Resolve & Revalidate
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
