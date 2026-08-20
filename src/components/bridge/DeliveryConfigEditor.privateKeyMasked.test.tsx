// The SFTP "Private key" textarea rendered a pasted private key as permanent plain
// text — the one credential field on this screen that stayed readable after entry,
// while every password input beside it was masked. `type="password"` does not exist
// for a textarea, so the honest treatment is a reveal pattern: the textarea is live
// while the operator is entering or editing the key, and once they leave the field a
// masked presentation replaces it until they explicitly choose to show it again.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeliveryConfig } from "@/lib/api/types";

const getDeliveryConfig = vi.fn();
const upsertDeliveryConfig = vi.fn();
const deleteDeliveryConfig = vi.fn();
const testFireDelivery = vi.fn();

vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: (...a: unknown[]) => getDeliveryConfig(...a),
  upsertDeliveryConfig: (...a: unknown[]) => upsertDeliveryConfig(...a),
  deleteDeliveryConfig: (...a: unknown[]) => deleteDeliveryConfig(...a),
  testFireDelivery: (...a: unknown[]) => testFireDelivery(...a),
}));

vi.mock("@/components/bridge/ConnectorRequirementsPanel", () => ({
  ConnectorRequirementsPanel: () => <div data-testid="mock-connector-panel" />,
}));

vi.mock("@/hooks/useOnboardingStatus", () => ({
  invalidateOnboardingStatus: vi.fn(),
}));

import { DeliveryConfigEditor } from "./DeliveryConfigEditor";

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeliveryConfigEditor supplierId="sup-1" />
    </QueryClientProvider>,
  );
}

/** True when any input or textarea anywhere still carries the raw key material. */
function keyMaterialExposed(): boolean {
  return Array.from(document.querySelectorAll("textarea, input")).some((el) =>
    (el as HTMLTextAreaElement).value.includes("fake-test-key-material-not-real"),
  );
}

const SAVED_SFTP: DeliveryConfig = {
  supplierId: "sup-1",
  protocol: "sftp",
  autoDeliver: false,
  configJson: JSON.stringify({ host: "sftp.supplier.example", port: 22, remotePath: "/in", makeDirectories: true, timeoutSeconds: 30 }),
  outputFormat: "xml",
  hasCredentials: true,
  credentialsDisplay: "********",
  createdAt: "2026-06-21T00:00:00Z",
  updatedAt: "2026-06-21T00:00:00Z",
  cxmlCredentials: null,
};

// RFC-2606-safe fake key material — never a real key in a public repository.
const KEY_MATERIAL = "-----BEGIN OPENSSH PRIVATE KEY-----\nfake-test-key-material-not-real\n-----END OPENSSH PRIVATE KEY-----";

beforeEach(() => {
  getDeliveryConfig.mockReset().mockResolvedValue(SAVED_SFTP);
  upsertDeliveryConfig.mockReset();
  deleteDeliveryConfig.mockReset();
  testFireDelivery.mockReset();
});

afterEach(cleanup);

async function openKeyTextarea() {
  renderEditor();
  const authSelect = await screen.findByLabelText(/Auth method/i);
  fireEvent.change(authSelect, { target: { value: "key" } });
  return screen.getByLabelText("Private key") as HTMLTextAreaElement;
}

describe("DeliveryConfigEditor — SFTP private key does not stay on screen as plain text", () => {
  it("masks the pasted key once the operator leaves the field", async () => {
    const textarea = await openKeyTextarea();

    // Control: entering the key works, and while editing the textarea is live.
    // (getByDisplayValue normalizes whitespace, so multiline values are checked directly.)
    fireEvent.change(textarea, { target: { value: KEY_MATERIAL } });
    expect(textarea.value).toBe(KEY_MATERIAL);

    // Leave the field: the key text must no longer be exposed anywhere.
    fireEvent.blur(textarea);
    expect(keyMaterialExposed()).toBe(false);
    expect(document.body.textContent).not.toContain("fake-test-key-material-not-real");
  });

  it("reveal brings the real textarea back for editing", async () => {
    const textarea = await openKeyTextarea();
    fireEvent.change(textarea, { target: { value: KEY_MATERIAL } });
    fireEvent.blur(textarea);

    // Positive first: the field now presents as a masked control with an explicit reveal.
    const reveal = screen.getByLabelText("Private key");
    expect(reveal.tagName).toBe("BUTTON");
    fireEvent.click(reveal);

    // The control test: the real value is back and still editable.
    const revealed = screen.getByLabelText("Private key") as HTMLTextAreaElement;
    expect(revealed.tagName).toBe("TEXTAREA");
    expect(revealed.value).toBe(KEY_MATERIAL);
    fireEvent.change(revealed, { target: { value: `${KEY_MATERIAL}\nedited` } });
    expect(revealed.value).toBe(`${KEY_MATERIAL}\nedited`);
  });

  it("keeps hygiene attributes on the key textarea", async () => {
    const textarea = await openKeyTextarea();
    expect(textarea).toHaveAttribute("autocomplete", "off");
    expect(textarea).toHaveAttribute("spellcheck", "false");
  });
});
