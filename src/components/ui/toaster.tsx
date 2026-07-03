"use client";

import * as React from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

/**
 * Leading status icon for a toast — Claude Design v2. The icon carries the
 * semantic colour on the dark charcoal surface:
 *   - success (default)  → green check
 *   - destructive        → red cross
 *   - loading            → spinning loader (opt-in, for in-progress messages)
 *
 * Callers opt into a spinner with `toast({ loading: true, title: "Exporting…" })`.
 * Both `loading` and an explicit `icon` override are additive — the existing
 * `toast()` / `useToast()` API is unchanged.
 */
function ToastIcon({ variant, loading }: { variant?: string | null; loading?: boolean }) {
  if (loading) {
    return <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin text-[#8FB8F0]" aria-hidden />;
  }
  if (variant === "destructive") {
    return <XCircle className="h-[18px] w-[18px] shrink-0 text-[#F1A1A1]" aria-hidden />;
  }
  return <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-[#7FD08C]" aria-hidden />;
}

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        // `loading` and `icon` are additive, optional fields threaded through the
        // (spread) toast payload; strip them so they don't land on the DOM node.
        const { loading, icon, variant, ...toastProps } = props as typeof props & {
          loading?: boolean;
          icon?: React.ReactNode;
        };
        return (
          <Toast
            key={id}
            variant={variant}
            {...toastProps}
            // v2 timing: 3.4s for a plain status line, 5.2s when there's an
            // action to click ("Undo", "View"). An explicit caller duration
            // (e.g. Infinity for a persistent loading toast) always wins.
            duration={toastProps.duration ?? (action ? 5200 : 3400)}
          >
            {icon !== undefined ? icon : <ToastIcon variant={variant} loading={loading} />}
            <div className="grid min-w-0 flex-1 gap-0.5">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
