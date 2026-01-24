import { Send, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface OrderActionsProps {
  poNumber: string;
}

export function OrderActions({ poNumber }: OrderActionsProps) {
  const handleTransform = () => {
    // Placeholder for transform action
    console.log("Transform order:", poNumber);
  };

  const handleSend = () => {
    // Placeholder for send action
    console.log("Send order:", poNumber);
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          Ready for Automation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This order has passed all validation checks and can be processed.
        </p>
        <div className="flex gap-2">
          <Button onClick={handleTransform} variant="outline" className="flex-1">
            <Wand2 className="mr-2 h-4 w-4" />
            Transform
          </Button>
          <Button onClick={handleSend} className="flex-1">
            <Send className="mr-2 h-4 w-4" />
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
