import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The first touch (landing path, campaign tags, referring domain) is held in memory and only
// registered once the visitor allows analytics. Each case loads a fresh module: the first touch
// and the SDK promise are module state.
const sdk = { init: vi.fn(), opt_out_capturing: vi.fn(), opt_in_capturing: vi.fn(), set_config: vi.fn(), register_once: vi.fn(), capture: vi.fn() };
vi.mock("posthog-js", () => ({ default: sdk }));

async function landOn(url: string, consent: string | null) {
  vi.resetModules();
  Object.values(sdk).forEach((f) => f.mockClear());
  window.history.replaceState(null, "", url);
  if (consent) window.localStorage.setItem("proculink_cookie_consent_v1", consent);
  const analytics = await import("./analytics");
  analytics.rememberLanding();
  window.history.replaceState(null, "", "/pricing"); // a later page: the first touch must not move
  analytics.capture("marketing_cta_clicked", { cta: "start_trial" });
  await vi.waitFor(() => expect(sdk.capture).toHaveBeenCalled());
  return analytics;
}

describe("first-touch attribution", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it("registers the landing page and campaign tags once analytics is allowed, and nothing before", async () => {
    const analytics = await landOn("/invoice-data-extraction?utm_source=linkedin&utm_medium=organic&utm_campaign=company_launch&email=a@b.c", null);
    expect(sdk.register_once, "nothing is stored before consent").not.toHaveBeenCalled();
    // The SDK sends the full address with every event: tokens in it must be masked.
    expect(sdk.init.mock.calls[0][1]).toMatchObject({ mask_personal_data_properties: true });
    expect(sdk.init.mock.calls[0][1].custom_personal_data_properties).toEqual(expect.arrayContaining(["__clerk_ticket", "code", "email"]));

    window.localStorage.setItem("proculink_cookie_consent_v1", "analytics-allowed");
    analytics.onConsentChanged("analytics-allowed");
    await vi.waitFor(() => expect(sdk.register_once).toHaveBeenCalledTimes(1));
    expect(sdk.register_once).toHaveBeenCalledWith({
      first_landing_page: "/invoice-data-extraction",
      first_utm_source: "linkedin",
      first_utm_medium: "organic",
      first_utm_campaign: "company_launch",
    });

    await landOn("/?utm_source=google", "analytics-allowed");
    expect(sdk.register_once).toHaveBeenCalledWith({ first_landing_page: "/", first_utm_source: "google" });
  });
});
