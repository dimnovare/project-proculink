import { useState } from "react";
import Link from "next/link";
import { Building2, Upload, CheckCircle2, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OnboardingStatus } from "@/types/procurement";

interface Props {
  status: OnboardingStatus;
  onDismiss: () => void;
}

interface Step {
  key: keyof OnboardingStatus;
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  href: string;
}

const STEPS: Step[] = [
  {
    key:         "hasSupplier",
    icon:        <Building2 className="h-6 w-6 text-primary" />,
    title:       "Add your first supplier",
    description: "Suppliers represent the companies you send purchase orders to. Add one to get started.",
    cta:         "Add supplier",
    href:        "/suppliers",
  },
  {
    key:         "hasUpload",
    icon:        <Upload className="h-6 w-6 text-primary" />,
    title:       "Upload a purchase order",
    description: "Upload a CSV or XLSX file. ProcuLink will parse the lines and match item codes automatically.",
    cta:         "Upload order",
    href:        "/upload",
  },
  {
    key:         "hasDelivery",
    icon:        <CheckCircle2 className="h-6 w-6 text-primary" />,
    title:       "Deliver to your supplier",
    description: "Once an order is parsed and resolved, transform it to XML or CSV and deliver it.",
    cta:         "View orders",
    href:        "/orders",
  },
];

export function OnboardingWizard({ status, onDismiss }: Props) {
  // Find the first incomplete step
  const activeIndex = STEPS.findIndex(s => !status[s.key]);
  const allDone     = activeIndex === -1;

  const [open, setOpen] = useState(true);

  const handleClose = () => {
    setOpen(false);
    onDismiss();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {allDone ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                You're all set!
              </>
            ) : (
              "Get started with ProcuLink"
            )}
          </DialogTitle>
          <DialogDescription>
            {allDone
              ? "You've completed all setup steps. Keep uploading orders to build your history."
              : "Complete these three steps to start automating your purchase orders."}
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3 my-2">
          {STEPS.map((step, i) => {
            const done    = status[step.key];
            const active  = i === activeIndex;

            return (
              <li
                key={step.key}
                className={`flex items-start gap-4 rounded-lg border p-4 transition-colors ${
                  done
                    ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20"
                    : active
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-muted/30 opacity-60"
                }`}
              >
                {/* Step number / done indicator */}
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  done  ? "bg-green-500 text-white"
                       : active ? "bg-primary text-primary-foreground"
                       : "bg-muted text-muted-foreground"
                }`}>
                  {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{step.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>

                  {active && (
                    <Link href={step.href} onClick={handleClose}>
                      <Button size="sm" className="mt-3 gap-1.5">
                        {step.cta}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" size="sm" onClick={handleClose} className="gap-1.5 text-muted-foreground">
            <X className="h-3.5 w-3.5" />
            {allDone ? "Close" : "Skip for now"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
