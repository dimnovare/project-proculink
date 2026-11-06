"use client";

import Link from "next/link";
import { StatusJourney } from "@/components/bridge/StatusJourney";
import { MobileListRow } from "@/components/bridge/layout/MobileListRow";
import { relativeTime } from "@/components/bridge/catalogSourceHelpers";
import { documentStatus } from "@/lib/documentStatusManifest";
import type { DocumentSummary } from "@/lib/api/documents";

const href = (d: DocumentSummary) => `/flows/${d.flowId}/documents/${d.id}`;

export function DocumentList({ documents, showFlow }: { documents: DocumentSummary[]; showFlow: boolean }) {
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-left" style={{ fontSize: 12.5 }}>
          <thead style={{ color: "var(--ink-muted)" }}>
            <tr>
              <th className="px-3 py-2 font-medium">File</th>
              {showFlow && <th className="px-3 py-2 font-medium">Flow</th>}
              <th className="px-3 py-2 font-medium">Progress</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Received</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => {
              const s = documentStatus(d.status, d.statusReason);
              return (
                <tr key={d.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-3 py-2">
                    <Link href={href(d)} className="font-medium underline-offset-2 hover:underline">{d.fileName}</Link>
                  </td>
                  {showFlow && <td className="px-3 py-2">{d.flowName}</td>}
                  <td className="px-3 py-2"><StatusJourney stage={s.stage} compact /></td>
                  <td className="px-3 py-2">{s.label}</td>
                  <td className="px-3 py-2" style={{ color: "var(--ink-muted)" }}>{relativeTime(d.createdAt) ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 p-2 lg:hidden">
        {documents.map((d) => {
          const s = documentStatus(d.status, d.statusReason);
          return (
            <Link key={d.id} href={href(d)} className="block">
              <MobileListRow>
                <span className="font-medium" style={{ fontSize: 13 }}>{d.fileName}</span>
                {showFlow && <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>{d.flowName}</span>}
                <StatusJourney stage={s.stage} compact />
                <span style={{ fontSize: 12 }}>
                  {s.label} · {relativeTime(d.createdAt) ?? "—"}
                </span>
              </MobileListRow>
            </Link>
          );
        })}
      </div>
    </>
  );
}
