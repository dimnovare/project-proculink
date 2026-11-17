import { describe, it, expect, vi } from "vitest";
import { render, within, fireEvent } from "@testing-library/react";
import type { AdminOrganisation } from "@/lib/api-client";

// Deleting documents is irreversible: the button must stay disarmed until there is a
// filter AND the exact slug is typed back, and a field left empty must not reach the body.

const eraseDocuments = vi.fn();
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  eraseDocuments: (...a: unknown[]) => eraseDocuments(...a),
}));

import { EraseDocumentsPanel } from "./EraseDocumentsPanel";

const ORG = { id: "org-test-1", name: "Example Trading", slug: "example-trading-7f3a" } as AdminOrganisation;
const RECEIPT = {
  documentsErased: 2,
  rowsDeleted: { flow_documents: 2, audit_events: 7 },
  blobsDeleted: 3,
  failedBlobKeys: [],
  skippedInFlight: [],
  more: false,
};

function setup() {
  eraseDocuments.mockReset().mockResolvedValue(RECEIPT);
  const panel = within(render(<EraseDocumentsPanel org={ORG} onClose={() => {}} />).container);
  return {
    panel,
    button: panel.getByRole("button", { name: "Delete documents" }),
    type: (label: string | RegExp, value: string) => fireEvent.change(panel.getByLabelText(label), { target: { value } }),
  };
}

describe("EraseDocumentsPanel", () => {
  it("arms only with a filter and the exact slug, and sends exactly what was typed", { timeout: 20_000 }, async () => {
    const { panel, button, type } = setup();
    expect(button).toBeDisabled();
    type(/to confirm/, ORG.slug);
    expect(button).toBeDisabled();
    type("Document ids (one per line)", "doc-1\ndoc-2");
    expect(button).toBeEnabled();

    fireEvent.click(button);
    expect(await panel.findByText("Deleted 2 documents: 9 rows, 3 stored files.")).toBeInTheDocument();
    expect(eraseDocuments).toHaveBeenCalledWith(ORG.id, { confirmSlug: ORG.slug, ids: ["doc-1", "doc-2"] });
  });

  it("sends a date as the start of that day in UTC, without ids", { timeout: 20_000 }, async () => {
    const { panel, button, type } = setup();
    type("Or everything received before", "2026-01-01");
    type(/to confirm/, ORG.slug);

    fireEvent.click(button);
    expect(await panel.findByText("Deleted 2 documents: 9 rows, 3 stored files.")).toBeInTheDocument();
    expect(eraseDocuments).toHaveBeenCalledWith(ORG.id, { confirmSlug: ORG.slug, receivedBefore: "2026-01-01T00:00:00Z" });
  });
});
