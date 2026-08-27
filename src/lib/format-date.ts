// Fixed-locale date formatting. Uses an EXPLICIT "en-GB" locale + explicit
// Intl options on both sides of the render boundary so the Node SSR pass and
// the browser hydration pass produce byte-identical strings. Passing
// `undefined` as the locale (the old per-component helpers did) resolves to the
// host's runtime locale, which differs between the server process and the
// user's browser — the classic source of hydration drift on dates. Do NOT swap
// this back to the ambient locale.

/** Exported for call sites that need their own Intl options but must not pass `undefined`. */
export const DATE_LOCALE = "en-GB";

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

/** e.g. "12 Jun 2026". Returns "—" for null / unparseable input. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(DATE_LOCALE, DATE_OPTIONS);
}

/** e.g. "12 Jun 2026, 14:05". Returns "—" for null / unparseable input. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(DATE_LOCALE, DATE_TIME_OPTIONS);
}
