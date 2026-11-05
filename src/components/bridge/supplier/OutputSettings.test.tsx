import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const getDeliveryConfig = vi.fn();
const upsertDeliveryConfig = vi.fn();
vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: (...a: unknown[]) => getDeliveryConfig(...a),
  upsertDeliveryConfig: (...a: unknown[]) => upsertDeliveryConfig(...a),
}));

import { OutputSettings } from "./OutputSettings";

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OutputSettings supplierId="sup-1" />
    </QueryClientProvider>,
  );
}

describe("OutputSettings", () => {
  it("saving an output with no delivery config creates a manual config", async () => {
    getDeliveryConfig.mockResolvedValue(null);
    upsertDeliveryConfig.mockResolvedValue({});
    renderIt();
    const select = await screen.findByLabelText("Output format");
    await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(select, { target: { value: "csv" } });
    fireEvent.click(screen.getByRole("button", { name: /Save output/i }));
    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    expect(upsertDeliveryConfig).toHaveBeenCalledWith(
      "sup-1",
      expect.objectContaining({ protocol: "manual", outputFormat: "csv", configJson: "{}", autoDeliver: false }),
    );
  });

  it("keeps the saved channel when changing the format of an existing config", async () => {
    getDeliveryConfig.mockResolvedValue({
      supplierId: "sup-1", protocol: "http", autoDeliver: true, configJson: '{"url":"https://x.example"}',
      outputFormat: "xml", hasCredentials: true,
    });
    upsertDeliveryConfig.mockClear();
    upsertDeliveryConfig.mockResolvedValue({});
    renderIt();
    const select = await screen.findByLabelText("Output format");
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("xml"));
    fireEvent.change(select, { target: { value: "json" } });
    fireEvent.click(screen.getByRole("button", { name: /Save output/i }));
    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    expect(upsertDeliveryConfig.mock.calls[0][1]).toEqual({
      protocol: "http", autoDeliver: true, configJson: '{"url":"https://x.example"}',
      credentialsJson: null, outputFormat: "json",
    });
  });
});
