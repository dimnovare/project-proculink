import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./locales";

type Values = Record<string, string | number>;
type Tags = Record<string, string | number | ((chunks: ReactNode) => ReactNode)>;

/**
 * Copy for one namespace. The ENGLISH text stays written at the call site — it is the source,
 * so English output is unchanged and every source-scanning copy guard still reads it. The other
 * languages come from messages/<locale>.json; a key a language lacks falls back to the English.
 * Outside an intl provider (unit tests render components bare) everything is English.
 */
export function useCopy(namespace: string) {
  let locale: Locale = DEFAULT_LOCALE;
  let t: ReturnType<typeof useTranslations> | null = null;
  // Both hooks run on every render; with no provider the first throws on every render, so the order never changes.
  // Only that missing-provider error is caught: anything else (a server render suspending on the request config) rethrows.
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    locale = useLocale() as Locale;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    t = useTranslations(namespace);
  } catch (e) {
    // use-intl's message in development; its production build throws the same error with no message.
    if (!(e instanceof Error && (e.message === "" || e.message.startsWith("No intl context found")))) throw e;
    t = null;
  }
  const has = (key: string) => locale !== DEFAULT_LOCALE && t != null && t.has(key);
  return {
    locale,
    /** `c("key", "English")`, with `{name}` values for the translations. */
    c: (key: string, english: string, values?: Values): string => (has(key) ? t!(key, values) : english),
    /** Like `c`, for text holding links or markup: `<link>…</link>` tags in the translation. */
    rich: (key: string, english: ReactNode, tags: Tags): ReactNode => (has(key) ? t!.rich(key, tags) : english),
    /** A list in the translation (a JSON array), else the English list. */
    list: (key: string, english: readonly string[]): string[] => (has(key) ? (t!.raw(key) as string[]) : [...english]),
  };
}

/** € amounts in the reader's language ("€149" in English, "149 €" in German); cents only when there are any. */
export function euroIn(locale: string, amount: number): string {
  const digits = Math.round(amount * 100) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}
