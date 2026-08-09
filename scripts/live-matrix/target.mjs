/* =============================================================================
 * ProcuLink live-harness TARGET RESOLUTION
 * -----------------------------------------------------------------------------
 * Every harness in this folder WRITES. They create purchase orders, overwrite a
 * supplier's delivery config, and fire real outbound requests. So "which
 * deployment am I pointed at" is not a convenience setting — it is the whole
 * safety boundary, and it must never be answered by a default.
 *
 * It used to be. Each harness carried `process.env.PLK_API || "https://api.proculink.eu"`,
 * so a run with no environment at all went to production. On 2026-06-10 that
 * default was taken: `ingest-harness.mjs` wrote 2,000 purchase orders into the
 * live customer database in ~54 seconds, every one of them HTTP 200.
 *
 * The contract now:
 *
 *   1. `PLK_API` unset  ->  http://localhost:5223  (the local API from CLAUDE.md §13).
 *      The safe target is what you get for free.
 *
 *   2. Any other target must be named explicitly in `PLK_API`. A staging or
 *      preview deployment needs nothing further — you already said where.
 *
 *   3. A PRODUCTION target (proculink.eu and its subdomains) additionally
 *      requires `--allow-production` on the command line, and is REFUSED
 *      without it. Not warned about. Refused, non-zero exit, nothing sent.
 *
 * Why the opt-in is an argv flag and not an environment variable
 * -------------------------------------------------------------
 * An environment variable is exactly the wrong instrument here, because it can
 * be true without anyone having decided it should be true *for this run*:
 * `export`ed once, it applies to every later command in that shell; it can
 * arrive from a `.env` file, a CI secret, or a parent process, and it survives
 * long after the person who set it stopped thinking about production.
 *
 * `process.argv` cannot. A flag has to be typed at the call site, on the
 * invocation that is about to write, and it is visible verbatim in shell
 * history, in a CI workflow diff, and in code review. There is no state
 * anywhere in the environment that can supply it by accident — which is the
 * property the control needs, since these scripts are run from CI and from
 * agent sessions, where a printed warning is read by nobody.
 *
 * Nothing in this module reads any environment variable other than `PLK_API`.
 * That is deliberate: it is what makes "no stray env var can unlock production"
 * a checkable claim rather than a hope. It is checked, by
 * `src/test/liveHarnessTarget.test.ts`.
 * ========================================================================== */

/** Target used when `PLK_API` is unset or blank. Must never be a production host. */
export const DEFAULT_LOCAL_API = "http://localhost:5223";

/** The one and only way to reach production. Command line only — never an env var. */
export const PRODUCTION_OPT_IN_FLAG = "--allow-production";

/** Production apex. `proculink.eu` itself and anything under it. */
export const PRODUCTION_HOST = "proculink.eu";

/** Thrown when a production target was requested without the command-line opt-in. */
export class ProductionTargetRefusedError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionTargetRefusedError";
  }
}

/** Thrown when `PLK_API` is set to something that is not a usable URL. */
export class InvalidTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidTargetError";
  }
}

function hostOf(rawUrl) {
  const trimmed = String(rawUrl).trim();
  // Tolerate a bare host ("api.proculink.eu") so a missing scheme cannot smuggle
  // a production host past the check as an unparseable string.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const { hostname } = new URL(withScheme);
  // Lowercase, and drop the trailing dot of a fully-qualified form ("proculink.eu.").
  return hostname.toLowerCase().replace(/\.$/, "");
}

/**
 * True when `rawUrl` points at the production deployment.
 * Matches the apex and its subdomains only — `notproculink.eu` is a different host.
 * Throws `InvalidTargetError` if `rawUrl` cannot be parsed.
 */
export function isProductionUrl(rawUrl) {
  let host;
  try {
    host = hostOf(rawUrl);
  } catch {
    throw new InvalidTargetError(
      `PLK_API is not a usable URL: ${JSON.stringify(String(rawUrl))}`,
    );
  }
  return host === PRODUCTION_HOST || host.endsWith(`.${PRODUCTION_HOST}`);
}

/** True only when the opt-in flag is present on the command line. */
export function hasProductionOptIn(argv) {
  return Array.isArray(argv) && argv.includes(PRODUCTION_OPT_IN_FLAG);
}

function refusalMessage(api, scriptName) {
  return [
    `REFUSED: ${scriptName} was pointed at PRODUCTION (${api}).`,
    "",
    "This harness WRITES. Against production it creates real rows in the live",
    "customer database that are indistinguishable from customer data in every",
    "count derived from it — inbox totals, dashboard KPIs, and plan usage.",
    "",
    `If that is genuinely what you want, say so on the command line:`,
    ``,
    `    PLK_API=${api} <this command> ${PRODUCTION_OPT_IN_FLAG}`,
    "",
    "There is deliberately no environment variable for this. Drop PLK_API to run",
    `against ${DEFAULT_LOCAL_API}, or set it to a staging deployment.`,
  ].join("\n");
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

/**
 * Resolve the API base URL a harness should write to.
 *
 * @returns {{ api: string, isProduction: boolean, explicit: boolean }}
 * @throws {ProductionTargetRefusedError} production requested without `--allow-production`
 * @throws {InvalidTargetError} `PLK_API` is not parseable as a URL
 */
export function resolveTarget({ env = process.env, argv = process.argv, scriptName = "This harness" } = {}) {
  const raw = String(env.PLK_API ?? "").trim();
  const explicit = raw.length > 0;
  const api = explicit ? stripTrailingSlash(raw) : DEFAULT_LOCAL_API;

  if (!isProductionUrl(api)) return { api, isProduction: false, explicit };

  if (!hasProductionOptIn(argv)) {
    throw new ProductionTargetRefusedError(refusalMessage(api, scriptName));
  }

  return { api, isProduction: true, explicit };
}

/**
 * `resolveTarget` for use at a harness's top level: prints the resolved target so
 * the operator always sees where the writes are going, and turns a refusal into a
 * legible stderr message plus a non-zero exit instead of a stack trace.
 */
export function resolveTargetOrExit(scriptName) {
  try {
    const target = resolveTarget({ scriptName });
    const label = target.isProduction
      ? "PRODUCTION (opt-in given)"
      : target.explicit
        ? "explicitly configured"
        : "local default";
    console.log(`[target] ${scriptName} -> ${target.api}  (${label})`);
    return target;
  } catch (err) {
    if (err instanceof ProductionTargetRefusedError || err instanceof InvalidTargetError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
