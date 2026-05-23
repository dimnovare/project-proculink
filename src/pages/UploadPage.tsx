import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ArrowRight } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { Supplier } from "@/types/procurement";
import { FileUploadZone } from "@/components/orders/FileUploadZone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [supplierId, setSupplierId] = useState<string>("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [uploading, setUploading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    apiClient.getSuppliers().then(setSuppliers).catch(() => {
      toast({
        title: "Could not load suppliers",
        description: "Please refresh and try again.",
        variant: "destructive",
      });
    });
  }, [toast]);

  const handleUpload = async () => {
    if (!file || !supplierId) return;

    setUploading(true);
    try {
      const result = await apiClient.uploadPurchaseOrder(file, supplierId);

      // Show a warning toast if the parser returned validation messages
      if (result.validationMessages.length > 0) {
        toast({
          title: "Order uploaded with warnings",
          description: result.validationMessages.join(" · "),
          variant: "default",
        });
      }

      // Navigate straight to the order detail page
      navigate(`/orders/${result.order.id}`);
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
      setUploading(false);
    }
  };

  return (
    <div className="page-container animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Upload Purchase Order</h1>
        <p className="text-muted-foreground">
          Upload a CSV or Excel file to parse and convert to supplier format
        </p>
      </div>

      <div className="max-w-xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>1. Select File</CardTitle>
            <CardDescription>
              Upload your purchase order in CSV or Excel (.xlsx) format
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileUploadZone
              selectedFile={file}
              onFileSelect={setFile}
              onClear={() => setFile(null)}
              disabled={uploading}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Select Supplier</CardTitle>
            <CardDescription>
              Choose the destination supplier for this order
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={supplierId} onValueChange={setSupplierId} disabled={uploading}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a supplier..." />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Button
          onClick={handleUpload}
          disabled={!file || !supplierId || uploading}
          className="w-full"
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing…
            </>
          ) : (
            <>
              Upload & Process
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
