import type {
  DeliveryConfig,
  DeliveryTestResult,
  UpsertDeliveryConfigRequest,
} from "./types";
import { API_BASE_URL, authHeader } from "./core";
import { serverReason } from "@/lib/serverText";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...auth, ...init?.headers },
  });
  if (res.status === 204) return null as T;
  if (!res.ok) {
    // The body can be an HTML error page from a gateway, and this message is rendered by
    // DeliveryConfigEditor. `serverReason` returns the readable text inside it, or the status
    // line when there is none. See src/lib/serverText.ts.
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ` + serverReason(text, res.statusText || `HTTP ${res.status}`));
  }
  return res.json() as Promise<T>;
}

export async function getDeliveryConfig(supplierId: string): Promise<DeliveryConfig | null> {
  return apiFetch<DeliveryConfig | null>(`/suppliers/${supplierId}/delivery-config`);
}

export async function upsertDeliveryConfig(
  supplierId: string,
  config: UpsertDeliveryConfigRequest
): Promise<DeliveryConfig> {
  return apiFetch<DeliveryConfig>(`/suppliers/${supplierId}/delivery-config`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export async function deleteDeliveryConfig(supplierId: string): Promise<void> {
  return apiFetch<void>(`/suppliers/${supplierId}/delivery-config`, { method: "DELETE" });
}

export async function testFireDelivery(supplierId: string): Promise<DeliveryTestResult> {
  return apiFetch<DeliveryTestResult>(`/suppliers/${supplierId}/delivery-config/test-fire`, {
    method: "POST",
  });
}
