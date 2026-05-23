import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, Building2, Check, X } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { Supplier } from "@/types/procurement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();

  const [creating, setCreating]           = useState(false);
  const [newName, setNewName]             = useState("");
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [editName, setEditName]           = useState("");
  const [deleteTarget, setDeleteTarget]   = useState<Supplier | null>(null);

  // ── Suppliers query ────────────────────────────────────────────────────────
  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn:  apiClient.getSuppliers,
    staleTime: 30_000,
  });

  // ── Create mutation ────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: () => apiClient.createSupplier({ name: newName.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast({ title: "Supplier created" });
      setCreating(false);
      setNewName("");
    },
    onError: (err) =>
      toast({
        title: "Create failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  // ── Rename mutation ────────────────────────────────────────────────────────
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiClient.renameSupplier(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast({ title: "Supplier renamed" });
      setEditingId(null);
    },
    onError: (err) =>
      toast({
        title: "Rename failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  // ── Delete mutation ────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteSupplier(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast({ title: "Supplier deleted" });
      setDeleteTarget(null);
    },
    onError: (err) =>
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  const startEdit = (s: Supplier) => {
    setEditingId(s.id);
    setEditName(s.name);
  };

  const cancelEdit = () => setEditingId(null);

  const commitEdit = () => {
    if (!editingId || !editName.trim()) return;
    renameMutation.mutate({ id: editingId, name: editName.trim() });
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") createMutation.mutate();
    if (e.key === "Escape") { setCreating(false); setNewName(""); }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") cancelEdit();
  };

  return (
    <div className="page-container animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Suppliers</h1>
          <p className="text-muted-foreground">
            Manage the suppliers your organisation sends orders to.
          </p>
        </div>
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Supplier
          </Button>
        )}
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            All Suppliers
          </CardTitle>
          {!isLoading && (
            <CardDescription>
              {suppliers.length} supplier{suppliers.length !== 1 ? "s" : ""}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* New-supplier inline row */}
                {creating && (
                  <TableRow>
                    <TableCell>
                      <Input
                        autoFocus
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={handleCreateKeyDown}
                        placeholder="Supplier name…"
                        className="h-8"
                        disabled={createMutation.isPending}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-success hover:text-success"
                          disabled={!newName.trim() || createMutation.isPending}
                          onClick={() => createMutation.mutate()}
                        >
                          {createMutation.isPending
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Check className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => { setCreating(false); setNewName(""); }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {suppliers.length === 0 && !creating ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center py-12 text-muted-foreground">
                      No suppliers yet. Click "Add Supplier" to create one.
                    </TableCell>
                  </TableRow>
                ) : (
                  suppliers.map(s => (
                    <TableRow key={s.id}>
                      <TableCell>
                        {editingId === s.id ? (
                          <Input
                            autoFocus
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={handleEditKeyDown}
                            className="h-8"
                            disabled={renameMutation.isPending}
                          />
                        ) : (
                          <span className="font-medium">{s.name}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingId === s.id ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-success hover:text-success"
                              disabled={!editName.trim() || renameMutation.isPending}
                              onClick={commitEdit}
                            >
                              {renameMutation.isPending
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Check className="h-4 w-4" />}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={cancelEdit}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => startEdit(s)}
                              title="Rename"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(s)}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
              Existing orders and mappings for this supplier will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
