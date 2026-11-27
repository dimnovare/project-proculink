"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCopy } from "@/i18n/useCopy";

/** The legal pages whose English text is the binding one. */
export const ENGLISH_ONLY_PATHS: readonly string[] = ["/terms", "/privacy", "/dpa", "/aup", "/subprocessors"];

/**
 * A legal page read in another language: one translated line on top, and the English body marked
 * `lang="en"` so a screen reader reads it as English. In English, or on any other page, it adds nothing.
 */
export function EnglishOnly({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { locale, c } = useCopy("legal");
  if (locale === "en" || !ENGLISH_ONLY_PATHS.includes(pathname ?? "")) return <>{children}</>;
  return (
    <>
      <p role="note" className="m-0 border-b border-border bg-surface-2 px-6 py-3 text-center text-[15px] text-ink">
        {c("englishOnly", "This page is available in English only. The English version is binding.")}
      </p>
      <div lang="en">{children}</div>
    </>
  );
}
