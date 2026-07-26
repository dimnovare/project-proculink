import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { API_BASE_URL, USE_MOCK } from "./api/core";

/**
 * Server-side admin gate for pages whose CONTENT must never reach a
 * non-admin — internal runbooks, in particular.
 *
 * Why this exists rather than reusing the client-side gate: `/admin` today is a
 * Client Component that renders a "no access" card when `/api/admin/*` answers
 * 403. That is fine for a dashboard whose data comes from the API, because the
 * data never arrives. It is NOT fine for a page whose value IS its prose — the
 * text would ship inside the client bundle to every signed-in user regardless
 * of the API's answer.
 *
 * So: a Server Component awaits this first, and the prose is only rendered on
 * the server after the API has confirmed the caller is on the allowlist
 * (`Admin__Emails` / `Admin__UserIds`, enforced by AdminAllowlist.cs).
 *
 * Fail-closed by construction. No token, an unreachable API, a timeout, or any
 * non-2xx all end in `notFound()` — a 404, not a 403, so the URL does not even
 * confirm that an admin page exists there.
 *
 * Pair every caller with `export const dynamic = "force-dynamic"`: a page that
 * prerendered at build time would have no request to authenticate.
 */
export async function requireAdminOrNotFound(): Promise<void> {
  // Mock and QA-bypass builds have no Clerk session to check. Both flags are
  // dev-only — USE_MOCK is force-false when NODE_ENV is production (see
  // api/core.ts), and the NODE_ENV guard below covers the bypass flag — so this
  // cannot open the gate on a real deployment. It is what lets the screenshot
  // capture rig and the e2e harness reach admin pages locally.
  if (USE_MOCK) return;
  if (
    process.env.NEXT_PUBLIC_QA_BYPASS_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    return;
  }

  let token: string | null = null;
  try {
    const { getToken } = await auth();
    token = await getToken();
  } catch {
    token = null;
  }
  if (!token) notFound();

  let allowed = false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/admin/access`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    allowed = res.ok;
  } catch {
    allowed = false;
  }

  // Outside the try/catch: notFound() signals by throwing, and catching our own
  // signal would swallow it.
  if (!allowed) notFound();
}
