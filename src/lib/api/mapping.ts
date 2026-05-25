import type { PoMappingConfig, MappedOrder, TestPoMappingRequest } from "./types";

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
