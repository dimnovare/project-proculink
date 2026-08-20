// The guided wizard's SFTP "Private key" textarea is the same surface as the full
// editor's (DeliveryConfigEditor.privateKeyMasked.test.tsx) and had the same defect:
// a pasted private key stayed on screen as permanent plain text. Both sites get the
// identical treatment — live textarea while entering/editing, masked presentation
// with an explicit reveal once the operator leaves the field.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: "org_1", userId: "user_1" }),
}));

const getDeliveryConfig = vi.fn();
const upsertDeliveryConfig = vi.fn();

vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: (...a: unknown[]) => getDeliveryConfig(...a),
  upsertDeliveryConfig: (...a: unknown[]) => upsertDeliveryConfig(...a),
  testFireDelivery: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/hooks/useOnboardingStatus", () => ({ invalidateOnboardingStatus: vi.fn() }));

import { DeliveryGuidedSetup } from "./DeliveryGuidedSetup";

// RFC-2606-safe fake key material — never a real key in a public repository.
const KEY_MATERIAL = "-----BEGIN OPENSSH PRIVATE KEY-----\nfake-test-key-material-not-real\n-----END OPENSSH PRIVATE KEY-----";

/** True when any input or textarea anywhere still carries the raw key material. */
function keyMaterialExposed(): boolean {
  return Array.from(document.querySelectorAll("textarea, input")).some((el) =>
    (el as HTMLTextAreaElement).value.includes("fake-test-key-material-not-real"),
  );
}

function openWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DeliveryGuidedSetup supplierId="sup-1" nounLower="supplier" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /set up step by step/i }));
}

/** Step 1 → SFTP, then switch the destination step's sign-in method to a private key. */
async function openKeyTextarea() {
  openWizard();
  // /^SFTP/ — the FTPS tile's blurb also contains the word "SFTP", so anchor to the label.
  fireEvent.click(await screen.findByRole("button", { name: /^SFTP\b/ }));
  const signIn = await screen.findByLabelText(/Sign in with/i);
  fireEvent.change(signIn, { target: { value: "key" } });
  return screen.getByLabelText("Private key") as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  getDeliveryConfig.mockResolvedValue(null);
  upsertDeliveryConfig.mockResolvedValue({});
});

afterEach(cleanup);

describe("DeliveryGuidedSetup — SFTP private key does not stay on screen as plain text", () => {
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
