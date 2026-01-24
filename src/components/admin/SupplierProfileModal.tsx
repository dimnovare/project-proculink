import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api-client";
import type { SupplierProfile } from "@/types/procurement";

interface SupplierProfileModalProps {
  open: boolean;
  onClose: () => void;
  profile: SupplierProfile | null;
}

const FORMAT_OPTIONS = ["XML", "CSV", "JSON", "EDI"];

export function SupplierProfileModal({ open, onClose, profile }: SupplierProfileModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!profile;

  const [supplierName, setSupplierName] = useState("");
  const [requiresSupplierItemCode, setRequiresSupplierItemCode] = useState(false);
  const [requiredFieldsInput, setRequiredFieldsInput] = useState("");
  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  const [supportsPartialAutomation, setSupportsPartialAutomation] = useState(false);
  const [acceptedFormats, setAcceptedFormats] = useState<string[]>([]);

  useEffect(() => {
    if (profile) {
      setSupplierName(profile.supplierName);
      setRequiresSupplierItemCode(profile.requiresSupplierItemCode);
      setRequiredFields(profile.requiredFields);
      setSupportsPartialAutomation(profile.supportsPartialAutomation);
      setAcceptedFormats(profile.acceptedFormats);
    } else {
      setSupplierName("");
      setRequiresSupplierItemCode(false);
      setRequiredFields([]);
      setSupportsPartialAutomation(false);
      setAcceptedFormats([]);
    }
    setRequiredFieldsInput("");
  }, [profile, open]);

  const createMutation = useMutation({
    mutationFn: apiClient.createSupplierProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-profiles"] });
      toast({ title: "Profile created", description: "Supplier profile has been added." });
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Create failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ supplierName, data }: { supplierName: string; data: Omit<SupplierProfile, "supplierName"> }) =>
      apiClient.updateSupplierProfile(supplierName, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-profiles"] });
      toast({ title: "Profile updated", description: "Supplier profile has been saved." });
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  const handleAddField = () => {
    const trimmed = requiredFieldsInput.trim();
    if (trimmed && !requiredFields.includes(trimmed)) {
      setRequiredFields([...requiredFields, trimmed]);
      setRequiredFieldsInput("");
    }
  };

  const handleRemoveField = (field: string) => {
    setRequiredFields(requiredFields.filter((f) => f !== field));
  };

  const handleFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAddField();
    }
  };

  const toggleFormat = (format: string) => {
    setAcceptedFormats((prev) =>
      prev.includes(format) ? prev.filter((f) => f !== format) : [...prev, format]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!supplierName.trim()) {
      toast({ title: "Validation error", description: "Supplier name is required", variant: "destructive" });
      return;
    }

    if (acceptedFormats.length === 0) {
      toast({ title: "Validation error", description: "Select at least one accepted format", variant: "destructive" });
      return;
    }

    const data = {
      requiresSupplierItemCode,
      requiredFields,
      supportsPartialAutomation,
      acceptedFormats,
    };

    if (isEdit) {
      updateMutation.mutate({ supplierName: profile.supplierName, data });
    } else {
      createMutation.mutate({ supplierName: supplierName.trim(), ...data });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Supplier Profile" : "Create Supplier Profile"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="supplierName">Supplier Name</Label>
            <Input
              id="supplierName"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              disabled={isEdit}
              placeholder="Enter supplier name"
              required
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="requiresItemCode">Requires Supplier Item Code</Label>
            <Switch
              id="requiresItemCode"
              checked={requiresSupplierItemCode}
              onCheckedChange={setRequiresSupplierItemCode}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="partialAutomation">Supports Partial Automation</Label>
            <Switch
              id="partialAutomation"
              checked={supportsPartialAutomation}
              onCheckedChange={setSupportsPartialAutomation}
            />
          </div>

          <div className="space-y-2">
            <Label>Required Fields</Label>
            <div className="flex gap-2">
              <Input
                value={requiredFieldsInput}
                onChange={(e) => setRequiredFieldsInput(e.target.value)}
                onKeyDown={handleFieldKeyDown}
                onBlur={handleAddField}
                placeholder="Add field and press Enter"
              />
              <Button type="button" variant="outline" onClick={handleAddField}>
                Add
              </Button>
            </div>
            {requiredFields.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {requiredFields.map((field) => (
                  <Badge key={field} variant="secondary" className="gap-1">
                    {field}
                    <button
                      type="button"
                      onClick={() => handleRemoveField(field)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Accepted Formats</Label>
            <div className="flex flex-wrap gap-3">
              {FORMAT_OPTIONS.map((format) => (
                <label key={format} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={acceptedFormats.includes(format)}
                    onCheckedChange={() => toggleFormat(format)}
                  />
                  <span className="text-sm">{format}</span>
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : isEdit ? (
                "Save Changes"
              ) : (
                "Create Profile"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
