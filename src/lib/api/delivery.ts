import type {
  DeliveryConfig,
  DeliveryTestResult,
  UpsertDeliveryConfigRequest,
} from "./types";
import {
  API_BASE_URL,
  ApiHttpError,
  authHeader,
  isApiMockMode,
  jsonBodyOrNull,
  retryAfterFrom,
} from "./core";
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
    //
    // The MESSAGE is thrown alone; the STATUS still has to ride along, which is why this is an
    // `ApiHttpError` and not a bare `Error`. `classifyApiFailure` opens with an `instanceof`
    // test, so a plain Error classified this refusal as `unreachable` — a dropped connection —
    // and the QueryClient retried a PUT/DELETE that is refused by role and can never succeed,
    // while anything branching on `kind === "forbidden"` never fired. The constructor runs
    // `operatorSafeApiMessage`, which returns plain prose byte-for-byte, so the sentence is
    // unchanged (pinned by delivery.retryPolicy.test.ts).
    const admin = orgAdminRefusal(res.status, text);
    if (admin) throw new ApiHttpError(admin, res.status);
    // The line above carries the same reasoning for the org-admin 403; this is every OTHER status,
    // and the MESSAGE here is byte-identical to the one this line always threw. A plain Error made
    // all of them read as `unreachable`, so the QueryClient in src/app/(app)/layout.tsx retried a
    // plan-gate 403, a 404 and a 409, none of which answer differently the second time, and a 429
    // was retried immediately against a window that had not moved.
    //
    // The string may not move: `DeliveryConfigEditor` renders it, and `PlanGateNotice` reads the
    // `<capability>_requires_<plan>` code back out of it. The constructor runs
    // `operatorSafeApiMessage`, which returns plain prose byte-for-byte — pinned, not assumed, by
    // delivery.httpFailureKind.test.ts. The body rides along on `.body` because `serverReason`
    // lifts only the `error` field out of a plan gate, dropping the `upgradeUrl` beside it — and it
    // rides as an OBJECT where it parses, because both readers of it prefer one. `retryAfterFrom`
    // reads `retryAfterSeconds` off the body, which is the ONLY carrier that survives cross-origin
    // (the header is not CORS-safelisted — see core.ts), and `"key" in body` is false for a string.
    // `planGateUpgradeUrl` reads `.upgradeUrl` directly rather than regexing the serialised form.
    // Raw text is kept when it is not JSON, so a gateway's HTML page still arrives intact.
    const body = jsonBodyOrNull(text);
    throw new ApiHttpError(
      `API error ${res.status}: ` + serverReason(text, res.statusText || `HTTP ${res.status}`),
      res.status,
      body ?? text,
      retryAfterFrom(res, body),
    );
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
