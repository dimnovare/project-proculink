import type {
  DeliveryConfig,
  DeliveryTestResult,
  UpsertDeliveryConfigRequest,
} from "./types";
import { API_BASE_URL, authHeader, isApiMockMode } from "./core";
import { serverReason } from "@/lib/serverText";
import { orgAdminRefusal } from "./refusal";

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
    // Writing or deleting a delivery config changes where every future order for that supplier
    // is sent, so it is organisation-admin-gated. That refusal is a finished sentence written
    // for the reader, so it is thrown ALONE — no `API error 403:` prefix, and no `serverReason`,
    // which lifts the body's `error` field ahead of its `message` and would have shown the
    // machine code `requires_org_admin` instead. Every other failure keeps the shape below,
    // including a plan gate, whose code `DeliveryConfigEditor` still detects in this string.
    const admin = orgAdminRefusal(res.status, text);
    if (admin) throw new Error(admin);
    throw new Error(`API error ${res.status}: ` + serverReason(text, res.statusText || `HTTP ${res.status}`));
  }
  return res.json() as Promise<T>;
}

export async function getDeliveryConfig(supplierId: string): Promise<DeliveryConfig | null> {
  // Mock mode has no delivery config for anyone, and until now it had no way to SAY so: the MSW
  // handler table keys off a different base URL and never had a delivery-config route, so this
  // call fell through to a real request that cannot succeed offline. Every reader then saw the
  // failure state — which was invisible while the surfaces above rendered unconditionally, and
  // became visible the moment one of them started asking before it spoke.
  //
  // `null` is the API's own answer for "nothing saved" (it returns 204), so this is the honest
  // mock: a browsable supplier with delivery not yet set up.
  if (isApiMockMode) return null;
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
