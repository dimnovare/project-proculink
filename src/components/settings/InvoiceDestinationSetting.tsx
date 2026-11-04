"use client";

// Settings ▸ Organisation ▸ "Where invoices go". One org-level destination: an ordinary
// supplier row. Saves on change (the direction control's pattern) and sends ONLY this
// field; "Not set" is an explicit null, because the PUT is partial and omission means
// "leave unchanged".

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, getOrgSettings, updateOrgSettings } from "@/lib/api-client";
import { getDeliveryConfig } from "@/lib/api/delivery";
import { deliveryConfigQueryKey } from "@/lib/deliveryConfigCache";
import { Card } from "@/components/bridge/layout/Card";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { deliveryChannelLabel } from "@/components/bridge/review/orderDisplay";

const INVOICE_FORMATS = ["csv", "json", "pdf"];

export function InvoiceDestinationSetting() {
  const queryClient = useQueryClient();
  const org = useQuery({ queryKey: ["org-settings"], queryFn: getOrgSettings, staleTime: 300_000 });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => apiClient.getSuppliers(), staleTime: 60_000 });
  const destinationId = org.data?.invoiceDestinationSupplierId ?? null;
  const delivery = useQuery({
    queryKey: deliveryConfigQueryKey(destinationId ?? "unassigned"),
    queryFn: () => getDeliveryConfig(destinationId as string),
    enabled: destinationId !== null,
    staleTime: 60_000,
    retry: 1,
  });
  const [feedback, setFeedback] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string | null) => updateOrgSettings({ invoiceDestinationSupplierId: id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org-settings"] });
      setFeedback({ text: "Saved.", kind: "ok" });
    },
    onError: (err: Error) => setFeedback({ text: err.message || "Could not save changes.", kind: "err" }),
  });

  const ready = org.data !== undefined && suppliers.data !== undefined;
  const format = delivery.data?.outputFormat ?? null;
  const channel = delivery.data ? deliveryChannelLabel(delivery.data.protocol) : null;

  return (
    <Card edge="green" className="mb-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink">Where invoices go</div>
        <span className="rounded-full border border-border-strong px-2 text-[11px] font-semibold leading-[20px] text-ink-muted">Early access</span>
      </div>
      <p className="mt-0.5 text-[12px] leading-[1.45] text-ink-muted">
        Every invoice, from any sender, goes here — never back to the seller. Set its channel and format on its Delivery tab.
      </p>
      {org.isError || suppliers.isError ? (
        <div className="mt-3">
          <StatusNotice tone="error">We couldn&rsquo;t load this setting just now. Your saved choice is unchanged.</StatusNotice>
        </div>
      ) : (
        <div className="mt-3">
          <select
            aria-label="Where invoices go"
            value={destinationId ?? ""}
            disabled={!ready || mutation.isPending}
            onChange={(e) => {
              setFeedback(null);
              mutation.mutate(e.target.value || null);
            }}
            className="h-9 w-full max-w-[420px] rounded-[6px] border border-border-strong bg-surface px-2 text-[13px] text-ink"
          >
            <option value="">Not set — invoices wait in Documents</option>
            {(suppliers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {feedback && (
            <span className={`ml-3 text-[12.5px] font-medium ${feedback.kind === "ok" ? "text-brand-green-deep" : "text-danger"}`}>{feedback.text}</span>
          )}
          {destinationId && (channel || format) && (
            <p className="mt-2 text-[12.5px] text-ink-muted">
              {[channel, format?.toUpperCase()].filter(Boolean).join(" · ")}
              {" · "}
              <Link href={`/library/suppliers/${destinationId}?tab=delivery`} className="underline">Change channel or format</Link>
            </p>
          )}
          {destinationId && format && !INVOICE_FORMATS.includes(format) && (
            <div className="mt-2">
              <StatusNotice tone="warning">Invoices go out as CSV, JSON or PDF. Change this destination&rsquo;s format on its Delivery tab.</StatusNotice>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
