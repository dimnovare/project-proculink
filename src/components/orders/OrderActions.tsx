import { useState } from "react";
import { Wand2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface OrderActionsProps {
  /** Called with the chosen format when the user confirms transform. */
  onTransform?: (format: "xml" | "csv") => void;
  isTransforming?: boolean;
}

export function OrderActions({ onTransform, isTransforming = false }: OrderActionsProps) {
  const [format, setFormat] = useState<"xml" | "csv">("xml");

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          Ready for Transformation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          All lines are resolved. Choose an output format and generate the supplier file.
        </p>

        <div className="space-y-2">
          <Label htmlFor="transform-format" className="text-sm">Output format</Label>
          <Select
            value={format}
            onValueChange={(v) => setFormat(v as "xml" | "csv")}
            disabled={isTransforming}
          >
            <SelectTrigger id="transform-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="xml">XML</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={() => onTransform?.(format)}
          disabled={!onTransform || isTransforming}
          className="w-full"
        >
          {isTransforming ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Transforming…
            </>
          ) : (
            <>
              <Wand2 className="mr-2 h-4 w-4" />
              Transform to {format.toUpperCase()}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
