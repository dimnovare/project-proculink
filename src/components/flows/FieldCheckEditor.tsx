"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { listLookups } from "@/lib/api/documents";
import type { FieldCheck, FlowField } from "@/lib/api/documents";
import { FIELD_CHECK_OPS } from "@/lib/flowFieldModel";
import { Field, INPUT, INPUT_BASE } from "./DestinationForm";

const HINT = "m-0 text-[12.5px] text-ink-muted";

/** "Also check" in a value's More: one customer-written check, off ("Nothing else") by default. */
export function FieldCheckEditor({ field, disabled, onChange }: { field: FlowField; disabled?: boolean; onChange(check: FieldCheck | null): void }) {
  const check = field.check ?? null;
  const enabled = useTenantQueriesEnabled();
  const lookups = useQuery({ queryKey: ["lookups"], queryFn: listLookups, enabled: enabled && check?.op === "in_lookup" });
  const set = (patch: Partial<FieldCheck>) => onChange({ ...check!, ...patch });
  return (
    <div className="grid gap-3 min-[720px]:col-span-2">
      <Field label="Also check">
        <select className={INPUT} value={check?.op ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value ? { op: e.target.value } : null)}>
          <option value="">Nothing else</option>
          {check && !(check.op in FIELD_CHECK_OPS) && <option value={check.op}>{check.op}</option>}
          {Object.entries(FIELD_CHECK_OPS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </Field>
      {check?.op === "one_of" && (
        <div className="grid gap-1">
          <Field label="Allowed values">
            <textarea className={`${INPUT_BASE} py-2`} rows={3} disabled={disabled} value={(check.values ?? []).join("\n")}
              onChange={(e) => set({ values: e.target.value.split("\n") })} />
          </Field>
          <p className={HINT}>One per line.</p>
        </div>
      )}
      {check?.op === "between" && (
        <div className="grid gap-1">
          <div className="grid gap-3 min-[720px]:grid-cols-2">
            <Field label="Lowest"><input className={INPUT} inputMode="decimal" disabled={disabled} value={check.min ?? ""} onChange={(e) => set({ min: e.target.value })} /></Field>
            <Field label="Highest"><input className={INPUT} inputMode="decimal" disabled={disabled} value={check.max ?? ""} onChange={(e) => set({ max: e.target.value })} /></Field>
          </div>
          <p className={HINT}>Leave one empty for no limit on that side.</p>
        </div>
      )}
      {check?.op === "in_lookup" && (
        lookups.isError ? <p className={HINT}>We couldn&apos;t load your lookups. Try again later.</p>
        : !lookups.data ? <p className={HINT}>Loading lookups…</p>
        : lookups.data.length === 0 ? (
          <p className={HINT}>You have no lookups yet. <Link href="/lookups" className="font-semibold text-brand-blue">Add a lookup</Link></p>
        ) : (
          <Field label="Lookup">
            <select className={INPUT} value={check.lookupId ?? ""} disabled={disabled} onChange={(e) => set({ lookupId: e.target.value || null })}>
              <option value="">Choose a lookup</option>
              {lookups.data.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        )
      )}
      {check && <p className={HINT}>When a value fails this check, we mark it, the same way we mark a value that is hard to read.</p>}
    </div>
  );
}
