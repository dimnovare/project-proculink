"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Imperative confirm dialog — one focus-trapped, token-styled modal that replaces
 * native `window.confirm()` everywhere. Native confirm can't be styled, isn't
 * keyboard/focus-consistent with the app, and reads as a browser chrome popup
 * rather than part of ProcuLink.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: "Delete buyer",
 *     description: `Delete "${name}"? This cannot be undone.`,
 *     confirmLabel: "Delete",
 *     danger: true,
 *   });
 *   if (!ok) return;
 *
 * The provider is mounted once in the app shell layout, so a single dialog
 * instance serves the whole app.
 */
export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions (delete / revoke / clear) get a red confirm button. */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({ title: "" });
  // Holds the pending promise's resolver. Nulled the instant we settle so a
  // button click (which settles) and the subsequent Radix onOpenChange(false)
  // don't double-resolve.
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    setOpts(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    setOpen(false);
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={open} onOpenChange={(next) => { if (!next) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  opts.danger ? "bg-danger-soft text-danger" : "bg-brand-blue-soft text-brand-blue",
                )}
                aria-hidden
              >
                {opts.danger ? <AlertTriangle className="h-[18px] w-[18px]" /> : <HelpCircle className="h-[18px] w-[18px]" />}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5 pr-4">
                <AlertDialogTitle>{opts.title}</AlertDialogTitle>
                {opts.description != null && (
                  <AlertDialogDescription>{opts.description}</AlertDialogDescription>
                )}
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {opts.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            {/* v2 semantic law: green is reserved for supplier/outgoing actions
                (send/publish); a generic confirm gets the blue primary, danger
                gets the red destructive. */}
            <AlertDialogAction
              onClick={() => settle(true)}
              className={opts.danger ? buttonVariants({ variant: "destructive" }) : undefined}
            >
              {opts.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

/**
 * Returns an async `confirm(opts) => Promise<boolean>`. Resolves true when the
 * user confirms, false on cancel / Escape / backdrop dismissal.
 *
 * Falls back to `window.confirm` if used outside a ConfirmProvider (e.g. an
 * isolated unit-test render) so call sites never crash.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  const fallback = useCallback<ConfirmFn>(async (opts) => {
    if (typeof window === "undefined") return false;
    const lines = [opts.title, typeof opts.description === "string" ? opts.description : ""].filter(Boolean);
    return window.confirm(lines.join("\n\n"));
  }, []);
  return ctx ?? fallback;
}
