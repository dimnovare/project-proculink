import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocumentDetail } from "@/lib/api/documents";
import { useDocumentEdits } from "@/hooks/useDocumentEdits";
import { reviewMarks } from "@/lib/reviewMarks";
import { ReadValuesPanel } from "./ReadValuesPanel";

const field = (key: string, value: string) =>
  ({ key, label: "Supplier", value, type: "text", meaning: null, confidence: 0.9, location: null, notOnPage: false, listed: true, edited: false });
const detail = {
  summary: { id: "d1" }, checks: [],
  read: { tables: [], truncated: false, kindLabel: null, fields: [field("seller", "Firma A"), field("buyer", "Firma B")] },
} as unknown as DocumentDetail;

function Panel() {
  const edits = useDocumentEdits("d1");
  return <ReadValuesPanel detail={detail} editable edits={edits} marks={reviewMarks(detail, true)} />;
}

it("numbers a repeated label so two values never share a name", () => {
  render(<QueryClientProvider client={new QueryClient()}><Panel /></QueryClientProvider>);
  expect(screen.getByLabelText("Supplier")).toHaveValue("Firma A");
  expect(screen.getByLabelText("Supplier 2")).toHaveValue("Firma B");
});
