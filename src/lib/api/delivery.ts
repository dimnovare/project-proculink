import type {
  DeliveryConfig,
  DeliveryTestResult,
  UpsertDeliveryConfigRequest,
} from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5223";

async function authHeader(): Promise<Record<string, string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = await (window as any).Clerk?.session?.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...auth, ...init?.headers },
  });
  if (res.status === 204) return null as T;
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
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
