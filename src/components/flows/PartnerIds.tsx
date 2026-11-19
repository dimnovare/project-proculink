"use client";

import { useId } from "react";
import { Field, INPUT } from "@/components/flows/DestinationForm";
import type { EnvelopeConfig } from "@/lib/api/types";

/** Per standard: its envelope key, the sender ID / type and receiver ID / type keys, the ID and type lengths, and the usual type. */
const STANDARDS: Record<string, { key: keyof EnvelopeConfig; boxes: [string, string, string, string]; id: number; type: number; usual?: string }> = {
  "x12-850": { key: "x12", boxes: ["isaSenderId", "isaSenderQualifier", "isaReceiverId", "isaReceiverQualifier"], id: 15, type: 2, usual: "ZZ" },
  "edifact-orders": { key: "edifact", boxes: ["senderId", "senderQualifier", "recipientId", "recipientQualifier"], id: 35, type: 4 },
  "cxml-1-2": { key: "cxml", boxes: ["fromIdentity", "fromDomain", "toIdentity", "toDomain"], id: 200, type: 100, usual: "NetworkId" },
};
const LABELS = ["Sender's ID", "Sender's ID type", "Receiver's ID", "Receiver's ID type"];

/** The sender and receiver IDs a standard file carries. A cleared box drops its key; nothing left is null. */
export function PartnerIds({ standard, envelope, onChange }: { standard: string; envelope: EnvelopeConfig | null; onChange(e: EnvelopeConfig | null): void }) {
  const uid = useId();
  const s = STANDARDS[standard];
  if (!s) return null;
  const part = (envelope?.[s.key] ?? {}) as Record<string, string | null | undefined>;
  const set = (box: string, value: string) => {
    const { [box]: _, ...rest } = part;
    const next = value ? { ...rest, [box]: value } : rest;
    const { [s.key]: __, ...others } = envelope ?? {};
    const all = Object.keys(next).length ? { ...others, [s.key]: next } : others;
    onChange(Object.keys(all).length ? all : null);
  };
  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-[14px] font-semibold text-ink">Sender and receiver IDs</h3>
      <p className="m-0 text-[13px] text-ink-muted">
        The system that receives this file may ask for set IDs for who sends it and who receives it. Ask whoever runs that system. Leave a box empty and we fill one in for you, which a strict system may refuse.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {s.boxes.map((box, i) => {
          const type = i % 2 === 1;
          return (
            <div key={box}>
              <Field label={LABELS[i]}>
                <input className={INPUT} value={part[box] ?? ""} maxLength={type ? s.type : s.id} placeholder={type ? s.usual : undefined}
                  aria-describedby={type ? `${uid}-${i}` : undefined} onChange={(e) => set(box, e.target.value)} />
              </Field>
              {type && <p id={`${uid}-${i}`} className="m-0 mt-1.5 text-[12.5px] text-ink-muted">Sometimes called the qualifier or domain. Leave it empty for the usual one.</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
