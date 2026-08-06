/**
 * Transport-security policy for tenant-supplied outbound URLs — supplier delivery endpoints, ERP
 * connector endpoints, catalog feeds, OAuth token endpoints, webhook targets, S3 endpoints.
 *
 * MIRROR of `ProcuLink.Core/Security/OutboundUrlPolicy.cs`. The backend is the source of truth and
 * refuses independently; this copy exists so an operator is told at the point of typing rather
 * than after a round trip. `src/test/backendMirror.test.ts` diffs the scheme sets and error codes
 * against the real C# whenever a backend checkout is reachable.
 *
 * Why the rule exists: a delivery request carries the purchase order AND the credentials that
 * authenticate it — a Directo post sends `user`, `password` and `key` as form fields. Over plain
 * http both are readable by anyone on the network path, while /security tells customers their
 * data moves under TLS in transit.
 *
 * Loopback keeps plain http because that traffic never leaves the machine, and local development
 * plus the e2e suites drive delivery against loopback listeners. Private/RFC-1918 ranges get no
 * such exemption: the backend's SSRF guard already blocks them outright in production, and "it is
 * a trusted internal network" cannot be verified from a URL string.
 */

/** Schemes that carry transport security and are allowed to any host. */
export const SECURE_SCHEMES = ["https"] as const;

/** Schemes with no transport security, allowed only against loopback. */
export const LOOPBACK_ONLY_SCHEMES = ["http"] as const;

/** Machine-readable codes, matching the backend's 400 `error` field exactly. */
export const OUTBOUND_URL_ERRORS = {
  required: "url_required",
  notAbsolute: "url_not_absolute",
  schemeNotAllowed: "url_scheme_not_allowed",
  credentialsInUrl: "credentials_in_url_not_allowed",
  insecureTransport: "url_requires_tls",
} as const;

export type OutboundUrlErrorCode =
  (typeof OUTBOUND_URL_ERRORS)[keyof typeof OUTBOUND_URL_ERRORS];

export type OutboundUrlRefusal = {
  allowed: false;
  errorCode: OutboundUrlErrorCode;
  message: string;
};

export type OutboundUrlVerdict = { allowed: true } | OutboundUrlRefusal;

/**
 * Narrows a verdict to its refusal shape.
 *
 * This repo compiles with `strict: false` / `strictNullChecks: false`, under which TypeScript does
 * NOT narrow a discriminated union by its boolean discriminant — `if (v.allowed) return;` leaves
 * `v` as the full union and every read of `.message` is a compile error. An explicit type
 * predicate works regardless of strict mode, so callers get the fields without casting.
 */
export function isRefusal(verdict: OutboundUrlVerdict): verdict is OutboundUrlRefusal {
  return !verdict.allowed;
}

const ALLOWED = { allowed: true } as const;

function block(errorCode: OutboundUrlErrorCode, message: string): OutboundUrlVerdict {
  return { allowed: false, errorCode, message };
}

/**
 * Loopback per RFC 6761 plus the standard address ranges: `localhost` and any `*.localhost` name,
 * `127.0.0.0/8`, and `::1`. `hostname` is the WHATWG URL value, so IPv6 arrives bracketed.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]" || host === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Validates a tenant-supplied outbound URL. `subject` is the noun the operator should read
 * ("Delivery endpoint", "Catalog feed URL", "Webhook target URL"), so one shared policy still
 * produces a message that fits the screen it appears on.
 */
export function inspectOutboundUrl(
  url: string | null | undefined,
  subject = "URL",
): OutboundUrlVerdict {
  if (!url || !url.trim()) {
    return block(OUTBOUND_URL_ERRORS.required, `${subject} is required.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return block(
      OUTBOUND_URL_ERRORS.notAbsolute,
      `${subject} must be a complete address including the scheme, for example ` +
        `https://orders.supplier.example/inbound.`,
    );
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  const isSecure = (SECURE_SCHEMES as readonly string[]).includes(scheme);
  const isLoopbackOnly = (LOOPBACK_ONLY_SCHEMES as readonly string[]).includes(scheme);

  if (!isSecure && !isLoopbackOnly) {
    return block(
      OUTBOUND_URL_ERRORS.schemeNotAllowed,
      `${subject} uses the '${scheme}' scheme, which is not supported. Use https://.`,
    );
  }

  // Checked before the TLS verdict: a userinfo secret leaks on https too. The message must never
  // quote the URL back — that would copy the very password being refused onto the screen.
  if (parsed.username || parsed.password) {
    return block(
      OUTBOUND_URL_ERRORS.credentialsInUrl,
      `${subject} must not contain a username or password before the host. Credentials written ` +
        `into a URL are stored and displayed in clear text and are copied into every delivery ` +
        `record. Remove them from the address and enter them in the credential fields instead.`,
    );
  }

  if (isLoopbackOnly && !isLoopbackHost(parsed.hostname)) {
    return block(
      OUTBOUND_URL_ERRORS.insecureTransport,
      `${subject} must use https://. ProcuLink will not send purchase orders or supplier ` +
        `credentials over plain http, where anyone on the network path can read them. Ask the ` +
        `supplier for their https endpoint. Plain http is accepted only against localhost, for ` +
        `local development.`,
    );
  }

  return ALLOWED;
}

/** True when the URL is one this policy would refuse. Used to flag already-saved configs. */
export function isRefusedOutboundUrl(url: string | null | undefined): boolean {
  return !inspectOutboundUrl(url).allowed;
}
