import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, Loader2, PackageCheck } from "lucide-react";
import type { ComponentType } from "react";

interface StatusBadgeProps {
  status: string;
  showIcon?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

type Variant = "success" | "warning" | "info" | "muted";

interface StatusConfig {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  variant: Variant;
  spin?: boolean;
}

const STATUS_MAP: Record<string, StatusConfig> = {
  // Stable / positive
  ready:            { label: "Ready",            Icon: CheckCircle2,  variant: "success" },
  delivered:        { label: "Delivered",        Icon: PackageCheck,   variant: "success" },
  ready_to_deliver: { label: "Ready to Deliver", Icon: PackageCheck,   variant: "info"    },
  // In-progress (spinner)
  parsing:          { label: "Parsing",          Icon: Loader2,        variant: "info",    spin: true },
  transforming:     { label: "Transforming",     Icon: Loader2,        variant: "info",    spin: true },
  // Needs attention
  pending_review:   { label: "Pending Review",   Icon: AlertTriangle,  variant: "warning" },
  // Failures
  failed:           { label: "Failed",           Icon: AlertTriangle,  variant: "warning" },
  transform_failed: { label: "Transform Failed", Icon: AlertTriangle,  variant: "warning" },
  delivery_failed:  { label: "Delivery Failed",  Icon: AlertTriangle,  variant: "warning" },
};

const VARIANT_CLASSES: Record<Variant, string> = {
  success: "bg-success-muted text-success border-success/20",
  warning: "bg-warning-muted text-warning border-warning/30",
  info:    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
  muted:   "bg-muted text-muted-foreground border-border",
};

const SIZE_CLASSES = {
  sm: "text-xs px-2 py-0.5",
  md: "text-sm px-2.5 py-1",
  lg: "text-sm px-3 py-1.5",
};

const ICON_SIZES = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
};

export function StatusBadge({ status, showIcon = true, size = "md", className }: StatusBadgeProps) {
  const config = STATUS_MAP[status] ?? {
    label: status,
    Icon: AlertTriangle,
    variant: "muted" as Variant,
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium border",
        SIZE_CLASSES[size],
        VARIANT_CLASSES[config.variant],
        className,
      )}
    >
      {showIcon && (
        <config.Icon
          className={cn(ICON_SIZES[size], config.spin && "animate-spin")}
        />
      )}
      {config.label}
    </span>
  );
}
