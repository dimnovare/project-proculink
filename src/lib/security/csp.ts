// Content-Security-Policy for the whole app.
//
// This is imported by next.config.ts (build time) — it must stay a pure,
// dependency-free module with no React / next / node imports so the config
// loader can evaluate it.
//
// ── Why 'unsafe-inline' is in script-src ─────────────────────────────────────
// Next's App Router streams hydration data as INLINE <script> tags
// (`self.__next_f.push(...)`) whose contents differ per page, so hashes are not
// usable. The alternative — a per-request nonce injected by middleware — opts
// every page into dynamic rendering (Next only injects a nonce during a
// request-time render), which would kill the static prerendering of the
// marketing and help pages. We also ship one inline JSON-LD block in
// src/app/layout.tsx.
//
// So the policy's job here is NOT "stop inline XSS". It is:
//   • no script may load from a host we did not name,
//   • no data may be sent to a host we did not name (connect-src),
//   • no <object>/<embed>, no <base> hijack, no framing by third parties,
//   • no eval in production.
// That closes the exfiltration half of an XSS and every "malicious CDN" class
// of attack. It is a real improvement over no policy at all, and it is what we
// can honestly enforce today.

export type CspMode = "enforce" | "report-only";

export interface CspEnv {
  /** "enforce" emits Content-Security-Policy; "report-only" only measures. */
  mode: CspMode;
  /** true in `next dev` — relaxes eval (HMR) and drops upgrade-insecure-requests. */
  isDev: boolean;
  /** NEXT_PUBLIC_API_BASE_URL — the backend origin the browser talks to. */
  apiBaseUrl?: string;
  /** NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY — the Clerk Frontend API host is encoded in it. */
  clerkPublishableKey?: string;
  /** NEXT_PUBLIC_POSTHOG_HOST — analytics ingest origin. */
  posthogHost?: string;
  /** NEXT_PUBLIC_SENTRY_DSN — gives both the ingest origin and the CSP report endpoint. */
  sentryDsn?: string;
  /** Extra origins that serve media/images (R2 walkthrough video + poster). */
  mediaUrls?: (string | undefined)[];
  /** VERCEL_ENV — "preview" additionally allows the Vercel toolbar. */
  vercelEnv?: string;
}

/** Sentry's CSP report collector, derived from the DSN. Null when no DSN. */
export function sentryReportUri(dsn?: string, environment?: string): string | null {
  const parts = parseSentryDsn(dsn);
  if (!parts) return null;
  const env = environment ? `&sentry_environment=${encodeURIComponent(environment)}` : "";
  return `${parts.origin}/api/${parts.projectId}/security/?sentry_key=${parts.publicKey}${env}`;
}

/** The Sentry ingest origin (envelope endpoint) that connect-src must allow. */
export function sentryIngestOrigin(dsn?: string): string | null {
  return parseSentryDsn(dsn)?.origin ?? null;
}

function parseSentryDsn(dsn?: string) {
  if (!dsn) return null;
  // https://<publicKey>@<host>/<projectId>
  const m = /^https:\/\/([^@:]+)(?::[^@]*)?@([^/]+)\/(\d+)\/?$/.exec(dsn.trim());
  if (!m) return null;
  return { publicKey: m[1], origin: `https://${m[2]}`, projectId: m[3] };
}

/**
 * The Clerk Frontend API origin, decoded from the publishable key.
 * `pk_live_<base64("clerk.example.com$")>` → `https://clerk.example.com`.
 * Clerk serves clerk.browser.js from this host and the SDK calls it directly.
 */
export function clerkFrontendApiOrigin(publishableKey?: string): string | null {
  if (!publishableKey) return null;
  const encoded = publishableKey.replace(/^pk_(live|test)_/, "");
  if (encoded === publishableKey) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }
  const host = decoded.replace(/\$$/, "").trim();
  // Only accept something that actually looks like a hostname.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return null;
  return `https://${host}`;
}

/** Origin of a URL, or null when the value is empty / not absolute-http. */
export function originOf(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function uniq(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

export function buildContentSecurityPolicy(env: CspEnv): string {
  const clerk = clerkFrontendApiOrigin(env.clerkPublishableKey);
  const api = originOf(env.apiBaseUrl);
  const sentry = sentryIngestOrigin(env.sentryDsn);
  const posthog = originOf(env.posthogHost) ?? "https://eu.posthog.com";
  // PostHog serves its remote-config + lazy extension bundles from the
  // regional assets host, not the ingest host.
  const posthogAssets = posthog.includes("eu.")
    ? "https://eu-assets.i.posthog.com"
    : "https://us-assets.i.posthog.com";
  // THE HOST EVENTS ACTUALLY GO TO, which is none of the two above.
  //
  // NEXT_PUBLIC_POSTHOG_HOST is `https://eu.posthog.com` in production — the app
  // host — but posthog-js remaps that to the regional INGEST host and posts
  // every event to `https://eu.i.posthog.com/e/` and `/i/v0/e/`. Note the `.i.`;
  // it is the whole difference, and allowing the configured origin does not
  // allow it.
  //
  // Measured, not reasoned: production Sentry issue 136782317, 188 CSP reports
  // between 2026-07-30 and 2026-08-20, every one `effective-directive:
  // connect-src`, `blocked-host: eu.i.posthog.com`, on proculink.eu. The policy
  // has been report-only, so nothing broke — but this is the single reason it
  // could not be enforced, and it would have taken analytics down on the day
  // anyone flipped CSP_MODE.
  const posthogIngest = posthog.includes("eu.")
    ? "https://eu.i.posthog.com"
    : "https://us.i.posthog.com";
  const media = uniq((env.mediaUrls ?? []).map(originOf));

  // The Vercel preview toolbar (comments / feedback) injects its own scripts,
  // frames and websockets. Allowing it on production would be pointless extra
  // surface, so it is preview-only.
  const isPreview = env.vercelEnv === "preview";
  const vercelToolbar = isPreview
    ? ["https://vercel.live", "https://assets.vercel.com"]
    : [];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'self'"],
    // Clerk posts its sign-in / SSO forms straight to the Frontend API.
    "form-action": uniq(["'self'", clerk]),
    "script-src": uniq([
      "'self'",
      "'unsafe-inline'", // see the header comment — Next inline hydration chunks
      env.isDev ? "'unsafe-eval'" : null, // Next dev HMR only
      clerk,
      // Clerk's bot-protection widget (Cloudflare Turnstile).
      "https://challenges.cloudflare.com",
      posthogAssets,
      ...vercelToolbar,
    ]),
    // React inline style props + Next's injected <style> blocks + Clerk's
    // component styles. Unavoidable without a nonce.
    "style-src": uniq(["'self'", "'unsafe-inline'", ...vercelToolbar]),
    "img-src": uniq([
      "'self'",
      "data:",
      "blob:",
      "https://img.clerk.com",
      ...media,
      ...vercelToolbar,
    ]),
    "font-src": uniq(["'self'", "data:", ...vercelToolbar]),
    "media-src": uniq(["'self'", "blob:", ...media]),
    "connect-src": uniq([
      "'self'",
      "blob:",
      api,
      clerk,
      "https://clerk-telemetry.com",
      posthog,
      posthogAssets,
      posthogIngest,
      sentry,
      ...vercelToolbar,
      isPreview ? "wss://ws-us3.pusher.com" : null,
      isPreview ? "https://sockjs-us3.pusher.com" : null,
      // `next dev` HMR websocket. Chrome accepts ws://same-origin under 'self',
      // Firefox historically does not — name the scheme so dev is never noisy.
      env.isDev ? "ws:" : null,
    ]),
    "frame-src": uniq([
      "'self'",
      "https://challenges.cloudflare.com",
      // /watch embeds a Loom player when NEXT_PUBLIC_WALKTHROUGH_LOOM_URL is set.
      "https://www.loom.com",
      ...vercelToolbar,
    ]),
    // MSW's mock service worker (dev) and Clerk's blob workers.
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };

  const serialized = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  );

  // upgrade-insecure-requests, and ONLY on a header that is actually enforced.
  //
  // A report-only policy ignores this directive outright — Chrome says so, once per
  // page load: "The Content Security Policy directive 'upgrade-insecure-requests' is
  // ignored when delivered in a report-only policy." Measured live on proculink.eu
  // 2026-08-29: twenty-five of those per navigation, and the directive doing nothing
  // the whole time. It was on the report-only header and nowhere else, so the one
  // protection here that is not merely observational was the one switched off.
  //
  // In report-only mode it therefore moves to baselineEnforcedPolicy below, which is
  // the header that IS enforced. In enforce mode this string is that header, so it
  // belongs here. Either way it ships exactly once, on something that obeys it.
  //
  // Localhost dev talks to the API over plain http, so this must not apply there.
  if (!env.isDev && env.mode === "enforce") serialized.push("upgrade-insecure-requests");

  const report = sentryReportUri(env.sentryDsn, env.vercelEnv);
  if (report) {
    // report-uri is deprecated but still the only one Safari/Firefox honour;
    // report-to pairs with the Reporting-Endpoints header below.
    serialized.push(`report-uri ${report}`);
    serialized.push("report-to csp-endpoint");
  }

  return serialized.join("; ");
}

export interface HeaderPair {
  key: string;
  value: string;
}

/**
 * Every security header the app sends, CSP included.
 *
 * In "report-only" mode we still ENFORCE the three directives that cannot
 * break a working page (frame-ancestors / base-uri / object-src) so the
 * clickjacking protection we already shipped is never weakened while the full
 * policy is only being measured.
 */
export function securityHeaders(env: CspEnv): HeaderPair[] {
  const headers: HeaderPair[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
  ];

  const report = sentryReportUri(env.sentryDsn, env.vercelEnv);
  if (report) {
    headers.push({ key: "Reporting-Endpoints", value: `csp-endpoint="${report}"` });
  }

  const policy = buildContentSecurityPolicy(env);

  if (env.mode === "enforce") {
    headers.push({ key: "Content-Security-Policy", value: policy });
    return headers;
  }

  headers.push({
    key: "Content-Security-Policy",
    value: baselineEnforcedPolicy(report, env.isDev),
  });
  headers.push({ key: "Content-Security-Policy-Report-Only", value: policy });
  return headers;
}

/** The subset that is safe to enforce before the full policy has been measured. */
function baselineEnforcedPolicy(report: string | null, isDev: boolean): string {
  const parts = ["frame-ancestors 'self'", "base-uri 'self'", "object-src 'none'"];
  // Carried here rather than on the report-only header, where a browser ignores it.
  // See the note in buildContentSecurityPolicy.
  if (!isDev) parts.push("upgrade-insecure-requests");
  if (report) {
    parts.push(`report-uri ${report}`);
    parts.push("report-to csp-endpoint");
  }
  return parts.join("; ");
}

/** Reads the mode from the environment. Report-only unless explicitly enforced. */
export function cspModeFromEnv(value?: string): CspMode {
  return value?.trim().toLowerCase() === "enforce" ? "enforce" : "report-only";
}
