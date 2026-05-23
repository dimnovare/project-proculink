"use client";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/bridge/EmptyState";

const DRAFTS = [
  { id: "d1", po: "PO-2026-008422", buyer: "Heinrich Industries", supplier: "Acme Components", savedAt: "3m", stage: "Validate", issues: 2 },
  { id: "d2", po: "AR-2026-1110",   buyer: "Atlas Reseller AG",   supplier: "Nordix Distribution", savedAt: "2h",  stage: "Normalize", issues: 0 },
];

export default function DraftsPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="flex items-end gap-4 px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Drafts</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>{DRAFTS.length} saved drafts</p>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        {DRAFTS.length === 0 ? (
          <EmptyState title="No drafts yet" sub="Save a crossing in progress to pick it up later." action={{ label: "Go to Inbox", onClick: () => router.push("/inbox") }} icon="⊘" />
        ) : (
          <div className="flex flex-col gap-3">
            {DRAFTS.map((d) => (
              <div key={d.id} onClick={() => router.push(`/inbox/${d.id}`)} className="flex items-center gap-4 rounded-[8px] px-4 py-3.5 cursor-pointer" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.04)", borderLeft: "3px solid #C97A14" }}>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[12px] font-semibold" style={{ color: "#0F4FA8" }}>{d.po}</p>
                  <p className="text-[12px] mt-0.5" style={{ color: "#56627A" }}>{d.buyer} → {d.supplier}</p>
                </div>
                <span className="text-[11px] rounded px-2 py-0.5 font-semibold" style={{ background: "#FAEFD6", color: "#C97A14" }}>{d.stage}</span>
                {d.issues > 0 && <span className="font-semibold text-[12px]" style={{ color: "#C53A3A" }}>⚠ {d.issues}</span>}
                <span style={{ fontSize: 11, color: "#8A93A5" }}>{d.savedAt} ago</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
