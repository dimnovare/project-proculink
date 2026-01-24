import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Database, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { apiClient } from "@/lib/api-client";
import type { SupplierMapping } from "@/types/procurement";

interface SupplierMappingsProps {
  supplierName: string;
}

export function SupplierMappings({ supplierName }: SupplierMappingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mappings, setMappings] = useState<SupplierMapping[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (isOpen && !hasFetched) {
      setIsLoading(true);
      apiClient
        .getSupplierMappings(supplierName)
        .then((data) => {
          setMappings(data);
          setHasFetched(true);
        })
        .catch((err) => {
          console.error("Failed to fetch mappings:", err);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [isOpen, hasFetched, supplierName]);

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                Saved Mappings for {supplierName}
              </span>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading mappings...
              </div>
            ) : mappings.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No saved mappings for this supplier yet.
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Buyer Item Code</TableHead>
                      <TableHead>Supplier Item Code</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappings.map((mapping, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-sm">
                          {mapping.buyerItemCode}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {mapping.supplierItemCode}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
