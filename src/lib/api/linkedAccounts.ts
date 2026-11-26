/**
 * linkedAccounts.ts — the org's connected Google accounts (plan 9b) and Microsoft mailbox and OneDrive accounts (plan 30).
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
/** `available` is Google's; `microsoftAvailable`, `ksefAvailable` and `peppolAvailable` are absent on an older backend, which means hidden. */
export interface LinkedAccountList { available: boolean; microsoftAvailable?: boolean; ksefAvailable?: boolean; peppolAvailable?: boolean; accounts: LinkedAccount[] }
/** The backend's `LinkedAccount.Provider` values: `outlook` is a mailbox, `microsoft` saves files to OneDrive. */
export type LinkedProvider = "google" | "outlook" | "microsoft";
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

/** The callback page announces a saved account here; any open destination form refreshes its list (R9). */
export const GOOGLE_CONNECT_CHANNEL = "proculink:google-connect";

export const listLinkedAccounts = () => apiFetch<LinkedAccountList>(`/linked-accounts`);
export const startGoogleConnect = (origin: string, returnTo?: string) =>
  apiFetch<GoogleStart>(`/linked-accounts/google/start`, { method: "POST", body: JSON.stringify({ origin, returnTo }) });
export const completeGoogleConnect = (code: string, state: string) =>
  apiFetch<GoogleConnected>(`/linked-accounts/google/complete`, {
    method: "POST", body: JSON.stringify({ code, state }),
  });
export const startOutlookConnect = (origin: string, returnTo?: string) =>
  apiFetch<GoogleStart>(`/linked-accounts/outlook/start`, { method: "POST", body: JSON.stringify({ origin, returnTo }) });
export const completeOutlookConnect = (code: string, state: string) =>
  apiFetch<GoogleConnected>(`/linked-accounts/outlook/complete`, {
    method: "POST", body: JSON.stringify({ code, state }),
  });
export const startMicrosoftConnect = (origin: string, returnTo?: string) =>
  apiFetch<GoogleStart>(`/linked-accounts/microsoft/start`, { method: "POST", body: JSON.stringify({ origin, returnTo }) });
export const completeMicrosoftConnect = (code: string, state: string) =>
  apiFetch<GoogleConnected>(`/linked-accounts/microsoft/complete`, {
    method: "POST", body: JSON.stringify({ code, state }),
  });
export const getGooglePicker =(accountId: string) =>
  apiFetch<GooglePickerToken>(`/linked-accounts/${seg(accountId)}/picker`, { method: "POST" });
export const deleteLinkedAccount = (accountId: string) =>
  apiFetch<void>(`/linked-accounts/${seg(accountId)}`, { method: "DELETE" });
