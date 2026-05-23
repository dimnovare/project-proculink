import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Database, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { Supplier, SupplierMapping } from "@/types/procurement";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

export default function MappingsPage() {
  const [selectedId, setSelectedId] = useState<string>("");
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  // ── Suppliers ──────────────────────────────────────────────────────────────
  const {
    data: suppliers = [] as Supplier[],
    isLoading: loadingSuppliers,
  } = useQuery({
    queryKey: ["suppliers"],
    queryFn:  apiClient.getSuppliers,
    staleTime: 5 * 60 * 1000,
  });

  // ── Mappings for selected supplier ────────────────────────────────────────
  const {
    data: mappings = [] as SupplierMapping[],
    isLoading: loadingMappings,
  } = useQuery({
    queryKey: ["mappings", selectedId],
    queryFn:  () => apiClient.getSupplierMappings(selectedId),
    enabled:  !!selectedId,
  });

  // ── Delete mutation ────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (mappingId: string) =>
      apiClient.deleteSupplierMapping(selectedId, mappingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mappings", selectedId] });
      toast({ title: "Mapping deleted" });
    },
    onError: (err) => {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const selectedSupplier = suppliers.find(s => s.id === selectedId);

  return (
    <div className="page-container animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Item Code Mappings</h1>
        <p className="text-muted-foreground">
          Review and manage buyer-to-supplier item code mappings saved from resolved orders.
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Supplier selector */}
        <Card>
          <CardHeader>
            <CardTitle>Select Supplier</CardTitle>
            <CardDescription>
              Choose a supplier to view its saved item code mappings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingSuppliers ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading suppliers…
              </div>
            ) : (
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue placeholder="Select a supplier…" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {/* Mappings table */}
        {selectedId && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                {selectedSupplier?.name ?? "Supplier"} Mappings
              </CardTitle>
              <CardDescription>
                {loadingMappings
                  ? "Loading…"
                  : `${mappings.length} saved mapping${mappings.length !== 1 ? "s" : ""}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingMappings ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading mappings…
                </div>
              ) : mappings.length === 0 ? (
                <div className="text-center py-12">
                  <Database className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    No mappings yet. They appear here after you resolve an order with
                    "Save as mappings" checked.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Buyer Item Code</TableHead>
                        <TableHead>Supplier Item Code</TableHead>
                        <TableHead className="w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappings.map(m => (
                        <TableRow key={m.id}>
                          <TableCell className="font-mono text-sm">{m.buyerItemCode}</TableCell>
                          <TableCell className="font-mono text-sm">{m.supplierItemCode}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              disabled={deleteMutation.isPending && deleteMutation.variables === m.id}
                              onClick={() => deleteMutation.mutate(m.id)}
                            >
                              {deleteMutation.isPending && deleteMutation.variables === m.id
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Trash2 className="h-4 w-4" />}
                              <span className="sr-only">Delete mapping</span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
