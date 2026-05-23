import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import type { AuditEvent } from "@/types/procurement";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  orderId: string;
}

/** Returns an icon + colour class appropriate to the audit action. */
function EventIcon({ action }: { action: string }) {
  const a = action.toLowerCase();
  if (a === "created")   return <Clock       className="h-3.5 w-3.5 text-blue-500" />;
  if (a === "parsed")    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (a === "resolved")  return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (a === "transformed" || a === "ready_to_deliver")
                         return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (a === "delivered") return <CheckCircle2 className="h-3.5 w-3.5 text-primary" />;
  if (a.includes("failed")) return <XCircle    className="h-3.5 w-3.5 text-destructive" />;
  return                        <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
}

/** Human-friendly label for each action key. */
function label(action: string) {
  const map: Record<string, string> = {
    Created:         "Order created",
    Parsed:          "File parsed",
    Resolved:        "Lines resolved",
    Transformed:     "Output generated",
    Delivered:       "Delivered to supplier",
    DeliveryAttempt: "Delivery attempted",
    Failed:          "Processing failed",
    ParseFailed:     "Parsing failed",
    TransformFailed: "Transform failed",
    DeliveryFailed:  "Delivery failed",
  };
  return map[action] ?? action;
}

/** Converts ISO string to a relative or absolute human time. */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s    = Math.floor(diff / 1_000);
  if (s < 60)   return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function AuditTimeline({ orderId }: Props) {
  const { data: events, isLoading } = useQuery<AuditEvent[]>({
    queryKey: ["order-audit", orderId],
    queryFn:  () => apiClient.getOrderAudit(orderId),
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : !events || events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="relative border-l border-border ml-1.5 space-y-4">
            {events.map((ev, i) => (
              <li key={i} className="pl-4">
                {/* dot on the line */}
                <span className="absolute -left-[7px] flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background ring-2 ring-border">
                  <EventIcon action={ev.action} />
                </span>
                <p className="text-sm font-medium leading-tight">{label(ev.action)}</p>
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={ev.createdAt}
                  title={new Date(ev.createdAt).toLocaleString()}
                >
                  {relativeTime(ev.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
