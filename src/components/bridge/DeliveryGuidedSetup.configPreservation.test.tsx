// Finishing the guided wizard on an existing supplier destroyed settings it has no field for.
//
// `buildConfigObject()` in DeliveryGuidedSetup carried this comment:
//
//     // Build the config JSON the backend stores — SAME shapes the editor's
//     // buildConfigObject() produces, for the subset of channels handled here.
//
// The editor's is `{ ...carriedOverConfigKeys(), ...buildManagedConfigObject() }` — a spread of
// everything already stored, with the managed keys laid on top. The wizard's was a fixed literal.
// Those are not the same shape; they are opposites. And the backend assigns `ConfigJson` wholesale
// (DeliveryConfigService), so whatever the wizard built simply BECAME the supplier's config:
//
//   * `headers` — custom HTTP request headers injected into every outbound request
//     (HttpDeliveryDispatcher). Gone, and the supplier starts rejecting orders.
//   * `method` — a supplier configured for PUT was forced back to POST.
//   * `subjectTemplate` / `bodyTemplate` / `fromAddress` — the email templates and the VERIFIED
//     sender.
//   * `overwriteExisting` — the WP-20 SFTP setting; the wizard has no checkbox for it.
//
// The amber banner disclosed only that the DESTINATION is replaced, so nothing on screen said any
// of the above was at stake.
//
// This follows DeliveryConfigEditor.unknownKeys.test.tsx, which guards exactly this one component
// over.
//
// PAIRED ASSERTIONS. Every "the custom key survived" claim sits beside one that the wizard really
// wrote — an unreached save leaves no payload to inspect and would pass a survival check for the
// wrong reason.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeliveryConfig, DeliveryProtocol } from "@/lib/api/types";

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

function saved(protocol: DeliveryProtocol, config: Record<string, unknown>): DeliveryConfig {
  return {
    supplierId: "sup-1",
    protocol,
    autoDeliver: false,
    configJson: JSON.stringify(config),
    outputFormat: "csv",
    hasCredentials: false,
    credentialsDisplay: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

/** An HTTP supplier with a custom account header, a non-default method and a raised timeout. */
const SAVED_HTTP = saved("http", {
  url: "https://supplier.example/orders",
  method: "PUT",
  timeoutSeconds: 120,
  headers: { "X-Supplier-Account": "ACME-4417" },
});

/** An SFTP supplier that has explicitly turned OFF overwrite — the wizard has no checkbox for it. */
const SAVED_SFTP = saved("sftp", {
  host: "sftp.supplier.example",
  port: 22,
  remotePath: "/in",
  makeDirectories: true,
  overwriteExisting: false,
  timeoutSeconds: 60,
});

/** An email supplier with templates and a verified sender the wizard cannot show. */
const SAVED_EMAIL = saved("email", {
  toAddresses: "orders@supplier.example",
  subjectTemplate: "PO {{poNumber}} from Heinrich",
  bodyTemplate: "Please find the attached order.",
  fromAddress: "po@buyer-verified.example",
});

function openWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DeliveryGuidedSetup supplierId="sup-1" nounLower="supplier" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /set up step by step/i }));
}

async function writtenConfig(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
  const [, body] = upsertDeliveryConfig.mock.calls[0] as [string, { configJson: string }];
  return JSON.parse(body.configJson) as Record<string, unknown>;
}

const continueButton = () => screen.getByRole("button", { name: /Continue/i });
const saveAndContinue = async () =>
  fireEvent.click(await screen.findByRole("button", { name: /Save & continue/i }));

/**
 * Anti-vacuity floor: the wizard really opened against a supplier it can see has a config, and it
 * says so. Every "key survived" assertion below is about a save that has to have happened against
 * a config that has to have been read — this fails first if either did not.
 */
async function floorWizardSawTheExistingConfig() {
  const banner = await screen.findByTestId("guided-existing-config");
  expect(banner.textContent).toMatch(/already has delivery set up/i);
}

beforeEach(() => {
  vi.clearAllMocks();
  getDeliveryConfig.mockResolvedValue(null);
  upsertDeliveryConfig.mockResolvedValue({});
});

afterEach(cleanup);

describe("DeliveryGuidedSetup — finishing does not delete the settings it has no fields for", () => {
  it("HTTP: a custom request header, the saved method and the saved timeout all survive", async () => {
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP);
    openWizard();
    await floorWizardSawTheExistingConfig();

    fireEvent.click(await screen.findByRole("button", { name: /HTTP webhook \/ API/i }));
    fireEvent.change(await screen.findByPlaceholderText(/supplier\.example\/orders/i), {
      target: { value: "https://supplier.example/v2/orders" },
    });
    fireEvent.click(continueButton());
    await saveAndContinue();

    const config = await writtenConfig();
    // The endpoint IS the wizard's to replace — that is the whole point of the screen.
    expect(config.url).toBe("https://supplier.example/v2/orders");
    // These are not.
    expect(config.headers).toEqual({ "X-Supplier-Account": "ACME-4417" });
    expect(config.method).toBe("PUT");
    expect(config.timeoutSeconds).toBe(120);
  });

  it("EMAIL: the subject and body templates and the verified sender all survive", async () => {
    getDeliveryConfig.mockResolvedValue(SAVED_EMAIL);
    openWizard();
    await floorWizardSawTheExistingConfig();

    fireEvent.click(await screen.findByRole("button", { name: /^Email/i }));
    const recipients = await screen.findByPlaceholderText(/po@supplier\.example/i);
    fireEvent.change(recipients, { target: { value: "new-orders@supplier.example" } });
    fireEvent.click(continueButton());
    await saveAndContinue();

    const config = await writtenConfig();
    expect(config.toAddresses).toBe("new-orders@supplier.example");
    expect(config.subjectTemplate).toBe("PO {{poNumber}} from Heinrich");
    expect(config.bodyTemplate).toBe("Please find the attached order.");
    expect(config.fromAddress).toBe("po@buyer-verified.example");
  });

  it("SFTP: an explicit overwriteExisting:false survives — the wizard has no checkbox for it", async () => {
    getDeliveryConfig.mockResolvedValue(SAVED_SFTP);
    openWizard();
    await floorWizardSawTheExistingConfig();

    fireEvent.click(await screen.findByRole("button", { name: /^SFTP/i }));
    fireEvent.change(await screen.findByPlaceholderText(/sftp\./i), {
      target: { value: "sftp2.supplier.example" },
    });
    fireEvent.click(continueButton());
    await saveAndContinue();

    const config = await writtenConfig();
    expect(config.host).toBe("sftp2.supplier.example");
    // `false` is the value a wholesale rebuild silently flipped back on, and the one an
    // `overwriteExisting ?? true` reader cannot distinguish from absent.
    expect(config.overwriteExisting).toBe(false);
    expect(config.timeoutSeconds).toBe(60);
  });

  it("carries through a key no version of this wizard has ever heard of", async () => {
    getDeliveryConfig.mockResolvedValue(
      saved("http", {
        url: "https://supplier.example/orders",
        someSettingShippedAfterThisBuild: { nested: ["value"] },
      }),
    );
    openWizard();
    await floorWizardSawTheExistingConfig();

    fireEvent.click(await screen.findByRole("button", { name: /HTTP webhook \/ API/i }));
    fireEvent.change(await screen.findByPlaceholderText(/supplier\.example\/orders/i), {
      target: { value: "https://supplier.example/orders" },
    });
    fireEvent.click(continueButton());
    await saveAndContinue();

    expect((await writtenConfig()).someSettingShippedAfterThisBuild).toEqual({ nested: ["value"] });
  });
});

describe("DeliveryGuidedSetup — the defaults it applies are defaults, not decisions", () => {
  it("still writes its own method and timeout for a supplier with nothing stored", async () => {
    // The control for the three tests above: preserving a stored value must not become "never
    // write one". A brand-new supplier has nothing to preserve and still needs a complete config.
    getDeliveryConfig.mockResolvedValue(null);
    openWizard();
    expect(screen.queryByTestId("guided-existing-config")).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /HTTP webhook \/ API/i }));
    fireEvent.change(await screen.findByPlaceholderText(/supplier\.example\/orders/i), {
      target: { value: "https://new.example/orders" },
    });
    fireEvent.click(continueButton());
    await saveAndContinue();

    const config = await writtenConfig();
    expect(config.url).toBe("https://new.example/orders");
    expect(config.method).toBe("POST");
    expect(config.timeoutSeconds).toBe(30);
  });

  it("drops the old channel's keys when the wizard switches channel, and says it will", async () => {
    // Carrying keys through is scoped to the SAME transport. An HTTP `headers` map means nothing
    // to an SFTP connector, and the banner has to promise the right one of the two.
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP);
    openWizard();
    await floorWizardSawTheExistingConfig();

    fireEvent.click(await screen.findByRole("button", { name: /^SFTP/i }));
    fireEvent.change(await screen.findByPlaceholderText(/sftp\./i), {
      target: { value: "sftp.supplier.example" },
    });

    expect(screen.getByTestId("guided-existing-config").textContent).toMatch(/different channel/i);

    fireEvent.click(continueButton());
    await saveAndContinue();

    const config = await writtenConfig();
    expect(config.host).toBe("sftp.supplier.example");
    expect(config.headers).toBeUndefined();
    expect(config.url).toBeUndefined();
  });
});

describe("DeliveryGuidedSetup — the banner says what finishing actually does", () => {
  it("names the settings it keeps, not only the destination it replaces", async () => {
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP);
    openWizard();

    const banner = await screen.findByTestId("guided-existing-config");
    expect(banner.textContent).toMatch(/replaces the destination and format/i);
    // The half that was missing: the reader is told what is NOT at stake, so "replaces it" stops
    // reading as "replaces everything".
    expect(banner.textContent).toMatch(/are kept as they are/i);
  });
});
