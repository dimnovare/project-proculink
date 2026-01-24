import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";
import type { SupplierProfile } from "@/types/procurement";
import { SupplierProfileModal } from "@/components/admin/SupplierProfileModal";

export default function SupplierProfilesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SupplierProfile | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["supplier-profiles"],
    queryFn: apiClient.getSupplierProfiles,
  });

  const deleteMutation = useMutation({
    mutationFn: apiClient.deleteSupplierProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-profiles"] });
      toast({ title: "Profile deleted", description: "Supplier profile has been removed." });
      setDeleteConfirm(null);
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  const handleCreate = () => {
    setEditingProfile(null);
    setModalOpen(true);
  };

  const handleEdit = (profile: SupplierProfile) => {
    setEditingProfile(profile);
    setModalOpen(true);
  };

  const handleDelete = (supplierName: string) => {
    setDeleteConfirm(supplierName);
  };

  const confirmDelete = () => {
    if (deleteConfirm) {
      deleteMutation.mutate(deleteConfirm);
    }
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setEditingProfile(null);
  };

  return (
    <div className="page-container animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Supplier Profiles</h1>
          <p className="text-muted-foreground">Manage supplier configuration and requirements</p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Add Profile
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Profiles</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : profiles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No supplier profiles configured. Click "Add Profile" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier Name</TableHead>
                  <TableHead>Requires Item Code</TableHead>
                  <TableHead>Required Fields</TableHead>
                  <TableHead>Partial Automation</TableHead>
                  <TableHead>Accepted Formats</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((profile) => (
                  <TableRow key={profile.supplierName}>
                    <TableCell className="font-medium">{profile.supplierName}</TableCell>
                    <TableCell>
                      <Badge variant={profile.requiresSupplierItemCode ? "default" : "secondary"}>
                        {profile.requiresSupplierItemCode ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {profile.requiredFields.length > 0 ? (
                          profile.requiredFields.map((field) => (
                            <Badge key={field} variant="outline" className="text-xs">
                              {field}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground text-sm">None</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={profile.supportsPartialAutomation ? "default" : "secondary"}>
                        {profile.supportsPartialAutomation ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {profile.acceptedFormats.map((format) => (
                          <Badge key={format} variant="outline" className="text-xs">
                            {format}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(profile)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(profile.supplierName)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SupplierProfileModal
        open={modalOpen}
        onClose={handleModalClose}
        profile={editingProfile}
      />

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier Profile</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the profile for "{deleteConfirm}"? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
