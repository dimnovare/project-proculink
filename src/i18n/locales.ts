/** The languages of the countries ProcuLink serves. English is the default and the source text. */
export const LOCALES = ["en", "de", "fr", "pl", "et"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Each language by its own name. No flags: a flag is a country, not a language. */
export const ENDONYMS: Record<Locale, string> = { en: "English", de: "Deutsch", fr: "Français", pl: "Polski", et: "Eesti" };

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

/** The saved choice, else the best Accept-Language match among LOCALES (by q), else English. */
export function pickLocale(cookie: string | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookie)) return cookie;
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { lang: tag.split("-")[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  const best = ranked.find((x) => isLocale(x.lang));
  return best ? (best.lang as Locale) : DEFAULT_LOCALE;
}

/** Saves the choice for a year and re-renders the same URL in it. */
export function chooseLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
  window.location.reload();
}
