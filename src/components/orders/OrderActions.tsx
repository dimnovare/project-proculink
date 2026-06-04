import { useState } from "react";
import { Wand2 } from "lucide-react";
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

type Fmt = "xml" | "csv" | "cxml" | "json" | "ubl" | "x12";

interface OrderActionsProps {
  /** Called with the chosen format when the user clicks Transform. */
  onTransform?: (format: Fmt) => void;
  /** @deprecated – transform is now async; spinner comes from polling. Kept for compat. */
  isTransforming?: boolean;
}

export function OrderActions({ onTransform }: OrderActionsProps) {
  const [format, setFormat] = useState<Fmt>("xml");

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
            onValueChange={(v) => setFormat(v as Fmt)}
          >
            <SelectTrigger id="transform-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="xml">XML (generic)</SelectItem>
              <SelectItem value="cxml">cXML</SelectItem>
              <SelectItem value="ubl">UBL 2.1 / Peppol</SelectItem>
              <SelectItem value="x12">ANSI X12 850</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={() => onTransform?.(format)}
          disabled={!onTransform}
          className="w-full"
        >
          <Wand2 className="mr-2 h-4 w-4" />
          Transform to {format.toUpperCase()}
        </Button>
      </CardContent>
    </Card>
  );
}
