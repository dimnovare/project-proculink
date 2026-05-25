import type { PoMappingConfig, MappedOrder, TestPoMappingRequest } from "./types";

const BASE = "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function getPoMapping(supplierId: string): Promise<PoMappingConfig | null> {
  return apiFetch<PoMappingConfig | null>(`/suppliers/${supplierId}/po-mapping`);
}

export async function upsertPoMapping(
  supplierId: string,
  config: PoMappingConfig
): Promise<PoMappingConfig> {
  return apiFetch<PoMappingConfig>(`/suppliers/${supplierId}/po-mapping`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export async function deletePoMapping(supplierId: string): Promise<void> {
  return apiFetch<void>(`/suppliers/${supplierId}/po-mapping`, { method: "DELETE" });
}

export async function testPoMapping(
  supplierId: string,
  request: TestPoMappingRequest
): Promise<MappedOrder> {
  return apiFetch<MappedOrder>(`/suppliers/${supplierId}/po-mapping/test`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}
