import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import type { Order } from "@/types/procurement";

interface ResolveSectionProps {
  order: Order;
  onOrderUpdated: (order: Order, messages: string[]) => void;
}

export function ResolveSection({ order, onOrderUpdated }: ResolveSectionProps) {
  const unresolvedLines = order.lines.filter((line) => line.needsReview);

  const [resolutions, setResolutions] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    unresolvedLines.forEach((line) => {
      initial[line.lineNumber] = line.aiSuggestion?.supplierItemCode ?? "";
    });
    return initial;
  });
  const [saveMappings, setSaveMappings] = useState(true);
  const [isResolving, setIsResolving] = useState(false);

  const allFilled = unresolvedLines.every(
    (line) => resolutions[line.lineNumber]?.trim(),
  );

  const handleInputChange = (lineNumber: number, value: string) => {
    setResolutions((prev) => ({ ...prev, [lineNumber]: value }));
  };

  const handleResolve = async () => {
    if (!allFilled) return;
    setIsResolving(true);
    try {
      const result = await apiClient.resolvePurchaseOrder(order.id, {
        saveMappings,
        lineResolutions: unresolvedLines.map((line) => ({
          lineNumber: line.lineNumber,
          supplierItemCode: resolutions[line.lineNumber].trim(),
        })),
      });

      toast({
        title: result.order.status === "ready"
          ? "All lines resolved"
          : "Partially resolved",
        description: result.order.status === "ready"
          ? "Order is ready for transformation."
          : "Some lines still need supplier item codes.",
      });

      onOrderUpdated(result.order, result.validationMessages);
    } catch (error) {
      toast({
        title: "Resolution failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsResolving(false);
    }
  };

  const fmt = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: order.currency }).format(amount);

  const fmtConfidence = (confidence: number) =>
    `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;

  if (unresolvedLines.length === 0) return null;

  return (
    <Card className="border-warning/30 bg-warning-muted/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-warning-foreground">
          <AlertCircle className="h-5 w-5" />
          Resolve Missing Supplier Item Codes ({unresolvedLines.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-warning-foreground/80">
          Enter the supplier item code for each unresolved line before transforming. AI suggestions are prefilled
          where available, but still need review before saving.
        </p>

        <div className="overflow-x-auto rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Line</TableHead>
                <TableHead>Buyer Item Code</TableHead>
                <TableHead className="hidden sm:table-cell">Description</TableHead>
                <TableHead className="text-right w-20">Qty</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Price</TableHead>
                <TableHead className="w-72">Supplier Item Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unresolvedLines.map((line) => {
                const suggestion = line.aiSuggestion;

                return (
                  <TableRow key={line.id}>
                    <TableCell className="font-mono text-sm">{line.lineNumber}</TableCell>
                    <TableCell className="font-mono text-sm">{line.buyerItemCode}</TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">
                      {line.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{line.quantity.toLocaleString()}</TableCell>
                    <TableCell className="text-right hidden sm:table-cell">{fmt(line.unitPrice)}</TableCell>
                    <TableCell>
                      <Input
                        placeholder="Enter code..."
                        value={resolutions[line.lineNumber] || ""}
                        onChange={(e) => handleInputChange(line.lineNumber, e.target.value)}
                        className="h-8 font-mono"
                      />
                      {suggestion && (
                        <div
                          className="mt-2 rounded-md border px-2.5 py-2"
                          style={{ backgroundColor: "var(--ai-soft)", borderColor: "rgb(111 79 206 / 0.25)" }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className="bg-background/70"
                              style={{ borderColor: "var(--ai)", color: "var(--ai)" }}
                            >
                              AI suggested
                            </Badge>
                            <span className="font-mono text-xs" style={{ color: "var(--ai)" }}>
                              {fmtConfidence(suggestion.confidence)}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs text-foreground/80">{suggestion.reason}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Source: {suggestion.provenance}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleInputChange(line.lineNumber, suggestion.supplierItemCode)}
                            >
                              Use suggestion
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleInputChange(line.lineNumber, "")}
                            >
                              Clear
                            </Button>
                          </div>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
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
                Resolving…
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Resolve & Continue
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
