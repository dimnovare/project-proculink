import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocumentDetail, Flow } from "@/lib/api/documents";
import { useDocumentEdits } from "@/hooks/useDocumentEdits";
import { reviewMarks } from "@/lib/reviewMarks";
import { ReadValuesPanel } from "./ReadValuesPanel";

const field = (key: string, value: string) =>
  ({ key, label: "Supplier", value, type: "text", meaning: null, confidence: 0.9, location: null, notOnPage: false, listed: true, edited: false });
const detail = {
  summary: { id: "d1" }, checks: [],
  read: { tables: [], truncated: false, kindLabel: null, fields: [field("seller", "Firma A"), field("buyer", "Firma B")] },
} as unknown as DocumentDetail;

function Panel({ d = detail, editable = true, flow }: { d?: DocumentDetail; editable?: boolean; flow?: Flow }) {
  const edits = useDocumentEdits("d1");
  return <ReadValuesPanel detail={d} editable={editable} edits={edits} marks={reviewMarks(d, editable)} flow={flow} />;
}

it("numbers a repeated label so two values never share a name", () => {
  render(<QueryClientProvider client={new QueryClient()}><Panel /></QueryClientProvider>);
  expect(screen.getByLabelText("Supplier")).toHaveValue("Firma A");
  expect(screen.getByLabelText("Supplier 2")).toHaveValue("Firma B");
});

it("a sent document shows its values as fixed: says why, with no row to add or remove", () => {
  const sent = {
    ...detail, summary: { id: "d1", status: "sent", statusReason: null },
    read: { ...detail.read, tables: [{ key: "lines", label: "Lines", listed: true, columns: [{ key: "qty", label: "Qty", type: "number", meaning: null }],
      rows: [{ cells: { qty: { value: "2", confidence: 0.9, location: null, notOnPage: false, edited: false } } }] }] },
  } as unknown as DocumentDetail;
  render(<QueryClientProvider client={new QueryClient()}><Panel d={sent} editable={false} /></QueryClientProvider>);
  expect(screen.getByText("Sent. Values can't be changed now.")).toBeInTheDocument();
  expect(screen.getByLabelText("Supplier")).toBeDisabled();
  expect(screen.queryByRole("button", { name: /^Remove row/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add row" })).toBeNull();
});

it("a finished download-only document says its file is ready and never speaks of sending (N-03, N-04)", () => {
  const made = { ...detail, summary: { id: "d1", status: "sent", statusReason: null },
    checks: [{ code: "new_sender", passed: false, fieldKey: null, message: "First document from this email address." }] } as unknown as DocumentDetail;
  const flow = { id: "f", downloadOnly: true, fieldsConfirmed: false, fields: { fields: [], tables: [] } } as unknown as Flow;
  render(<QueryClientProvider client={new QueryClient()}><Panel d={made} editable={false} flow={flow} /></QueryClientProvider>);
  expect(screen.getByText("File ready. Values can't be changed now.")).toBeInTheDocument();
  expect(screen.getByText("Checks are a heads-up; they never stop you making the file.")).toBeInTheDocument();
});
