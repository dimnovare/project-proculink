"use client";

// The language switcher: the header button and its menu, the phone menu group and the footer list.
// Languages by their own names, no flags. The choice is a cookie; the same URL re-renders in it.

import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Check, Globe } from "lucide-react";
import { useMenuDismiss } from "@/components/bridge/OrgSwitcher";
import { chooseLocale, ENDONYMS, LOCALES } from "@/i18n/locales";
import { useCopy } from "@/i18n/useCopy";

/** The header's "[globe] EN" button, just before Sign in. */
export function LanguageMenuButton() {
  const { locale, c } = useCopy("switcher");
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useMenuDismiss(open, close, btnRef, menuRef);

  return (
    <div className="relative hidden min-[900px]:block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="language-menu"
        aria-label={`${locale.toUpperCase()}, ${c("language", "Language")}: ${ENDONYMS[locale]}`}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-[14px] font-medium text-navy-text hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <Globe aria-hidden="true" className="size-4" strokeWidth={1.9} />
        {/* The code shows once the header has room; below that the globe stands alone (the name says the language). */}
        <span className="max-[1179px]:sr-only">{locale.toUpperCase()}</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id="language-menu"
          className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-[10px] border border-border bg-surface py-1 shadow-lg"
        >
          <LanguageList variant="menu" />
        </div>
      )}
    </div>
  );
}

const ROW = {
  menu: "flex min-h-11 w-full items-center justify-between px-3 text-left text-[14px] font-medium text-ink hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue",
  sheet: "flex min-h-11 w-full items-center justify-between border-b border-navy-line px-3 text-left text-[17px] font-medium text-navy-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
  footer: "flex min-h-[44px] items-center text-navy-text no-underline hover:text-white",
} as const;

/** The five languages as rows (menu, phone sheet) or as links (footer). */
export function LanguageList({ variant }: { variant: keyof typeof ROW }) {
  const { locale } = useCopy("switcher");
  const pathname = usePathname() ?? "/";
  return (
    <ul className="m-0 list-none p-0">
      {LOCALES.map((l) => {
        const current = l === locale;
        const label = (
          <>
            <span lang={l}>{ENDONYMS[l]}</span>
            {current && variant !== "footer" && <Check aria-hidden="true" className="size-4 shrink-0" />}
          </>
        );
        return (
          <li key={l}>
            {variant === "footer" ? (
              <a
                href={pathname}
                hrefLang={l}
                aria-current={current ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  chooseLocale(l);
                }}
                className={`${ROW.footer} ${current ? "font-semibold text-white" : ""}`}
              >
                {label}
              </a>
            ) : (
              <button type="button" aria-current={current ? "true" : undefined} onClick={() => chooseLocale(l)} className={ROW[variant]}>
                {label}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
