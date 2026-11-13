/**
 * linkedAccounts.ts — the org's connected Google accounts (plan 9b).
 *
 * Mirrors `ProcuLink.Api/Controllers/LinkedAccountsController.cs`. A token never passes through here
 * except the Picker's short-lived access token, which goes straight to `openGooglePicker`.
 *
 * Paths are backticked on purpose so `src/test/endpoint-reachability.test.ts` can see them.
 */

import { API_BASE_URL, authHeader, fetchWithTimeout, isApiMockMode } from "./core";
import { mockEngineFetch } from "./mockEngine";
import { readRefusal } from "./refusal";

/** `status` is "active" or "reconnect" (Google access was removed). Kept a string: a newer value is never coerced. */
export interface LinkedAccount { id: string; provider: string; email: string; status: string; createdAt: string }
// Named types, not inline ones: the backend's reachability scanner reads `apiFetch<T>(` only when T has no braces.
export interface LinkedAccountList { available: boolean; accounts: LinkedAccount[] }
export interface GoogleConnected { account: LinkedAccount; returnTo: string | null }
export interface GooglePickerToken { accessToken: string; apiKey: string; appId: string }
export interface GoogleStart { authorizeUrl: string }

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (isApiMockMode) return mockEngineFetch<T>(path, init);
  const res = await fetchWithTimeout(`${API_BASE_URL}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(await authHeader()), ...init?.headers },
  });
  if (!res.ok) throw await readRefusal(res, `linked-accounts: ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const seg = (id: string) => encodeURIComponent(id);

export const listLinkedAccounts = () => apiFetch<LinkedAccountList>(`/linked-accounts`);
export const startGoogleConnect = (origin: string, returnTo?: string) =>
  apiFetch<GoogleStart>(`/linked-accounts/google/start`, { method: "POST", body: JSON.stringify({ origin, returnTo }) });
export const completeGoogleConnect = (code: string, state: string) =>
  apiFetch<GoogleConnected>(`/linked-accounts/google/complete`, {
    method: "POST", body: JSON.stringify({ code, state }),
  });
export const getGooglePicker = (accountId: string) =>
  apiFetch<GooglePickerToken>(`/linked-accounts/${seg(accountId)}/picker`, { method: "POST" });
export const deleteLinkedAccount = (accountId: string) =>
  apiFetch<void>(`/linked-accounts/${seg(accountId)}`, { method: "DELETE" });
