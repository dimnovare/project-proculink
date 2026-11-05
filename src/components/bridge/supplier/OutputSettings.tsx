"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/bridge/layout/Card";
import { getDeliveryConfig, upsertDeliveryConfig } from "@/lib/api/delivery";
import { deliveryConfigQueryKey, invalidateDeliveryConfig } from "@/lib/deliveryConfigCache";
import { invalidateOnboardingStatus } from "@/hooks/useOnboardingStatus";
import type { UpsertDeliveryConfigRequest } from "@/lib/api/types";

/**
 * The supplier's output format, chosen apart from how it is delivered.
 *
 * Saves through `upsertDeliveryConfig`. With no config yet it creates a `manual` one (nothing is
 * sent for the supplier, so no credentials are needed); with one, it resends the loaded row with
 * only the format changed and no credentials, which keeps the stored ones.
 */
export function OutputSettings({ supplierId, footer }: { supplierId: string; footer?: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: saved, isLoading, isError } = useQuery({
    queryKey: deliveryConfigQueryKey(supplierId),
    queryFn: () => getDeliveryConfig(supplierId),
    staleTime: 30_000,
    retry: 1,
  });
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved?.outputFormat ?? "";

  const save = useMutation({
    mutationFn: () => {
      const outputFormat = value || null;
      const body: UpsertDeliveryConfigRequest = saved
        ? {
            protocol: saved.protocol,
            autoDeliver: saved.autoDeliver,
            configJson: saved.configJson,
            credentialsJson: null,
            outputFormat,
          }
        : { protocol: "manual", autoDeliver: false, configJson: "{}", credentialsJson: null, outputFormat };
      return upsertDeliveryConfig(supplierId, body);
    },
    onSuccess: () => {
      setDraft(null);
      // A first save creates the supplier's delivery config, which onboarding counts.
      void invalidateOnboardingStatus(queryClient);
      return invalidateDeliveryConfig(queryClient, supplierId);
    },
  });

  return (
    <Card>
      <h2 className="text-[13px] font-semibold text-ink">Output format</h2>
      <p className="mt-1 text-[12px] text-ink-muted">
        The file format this supplier requires. Each order is converted to this format when it&rsquo;s ready.
      </p>
      {isError ? (
        <p role="alert" className="mt-3 text-[12px] text-danger">
          Couldn&rsquo;t load this supplier&rsquo;s setup, so the format can&rsquo;t be changed right now.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="Output format"
            value={value}
            disabled={isLoading}
            onChange={(e) => {
              setDraft(e.target.value);
              save.reset();
            }}
            className="h-9 w-full max-w-[320px] rounded-[5px] border border-border-strong bg-surface px-2 text-[12px] text-ink"
          >
            <option value="">Not set — defaults to XML</option>
            <option value="csv">CSV</option>
            <option value="xml">XML (generic)</option>
            <option value="cxml">cXML</option>
            <option value="ubl">UBL 2.1 Order</option>
            <option value="x12">ANSI X12 850</option>
            <option value="json">JSON</option>
            <option value="pdf">PDF</option>
          </select>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={isLoading || save.isPending || draft === null}
            className="h-9 rounded-[6px] bg-ink px-3 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {save.isPending ? "Saving..." : "Save output"}
          </button>
        </div>
      )}
      {save.isError && (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {save.error instanceof Error ? save.error.message : "Could not save the output format."}
        </p>
      )}
      {save.isSuccess && (
        <p role="status" className="mt-2 text-[12px] text-brand-green-deep">
          Output format saved.
        </p>
      )}
      {footer}
    </Card>
  );
}
