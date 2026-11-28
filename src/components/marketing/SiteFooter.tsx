import Link from "next/link";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { COPYRIGHT_NOTICE } from "@/lib/legal-entity";
import { SITE_TAGLINE } from "@/lib/seo";
import { useCopy } from "@/i18n/useCopy";
import { FOOTER_COLS } from "./footerColumns";
import { LanguageList } from "./LanguageSwitcher";

// py-2 keeps a gap between links that wrap to two lines (German), not only between one-line ones.
const LINK = "flex items-center min-h-[44px] py-2 leading-snug text-navy-text no-underline hover:text-white";

/** The one footer of the public site: Home and every page under the marketing layout. */
export function SiteFooter() {
  const statusUrl = process.env.NEXT_PUBLIC_STATUS_URL;
  const { c } = useCopy("footer");
  return (
    <footer className="on-navy bg-navy text-navy-text text-[15px] leading-normal">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-10 px-6 pb-7 pt-14">
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-4 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
          <div className="flex max-w-[420px] flex-col gap-3.5 sm:col-span-4 lg:col-span-1">
            <Link href="/" className="flex min-h-[44px] items-center gap-2.5 self-start font-display text-[20px] font-bold tracking-[-0.02em] text-white no-underline">
              <span aria-hidden="true" className="inline-flex">
                <ProcuLinkMark size={26} mono />
              </span>
              ProcuLink
            </Link>
            <p className="m-0">
              {c("about", `${SITE_TAGLINE} ProcuLink reads your documents, lets you check them and sends them on in the format you need, with a record of every delivery.`)}
            </p>
          </div>
          {FOOTER_COLS.map((col) => (
            <nav key={col.h} aria-label={c(col.h, col.h)} className="flex flex-col">
              {/* A group label, not a heading: it would jump the page's heading order. */}
              <p className="mb-1.5 font-semibold text-white">{c(col.h, col.h)}</p>
              <ul className="m-0 list-none p-0">
                {col.links.map(([label, href]) => (
                  <li key={href}>
                    <Link href={href} className={LINK}>{c(`link${href.replaceAll("/", "_")}`, label)}</Link>
                  </li>
                ))}
                {col.h === "Company" && statusUrl && (
                  <li>
                    <a href={statusUrl} target="_blank" rel="noopener noreferrer" className={LINK}>{c("status", "Status")}</a>
                  </li>
                )}
              </ul>
            </nav>
          ))}
          <nav aria-label={c("language", "Language")} className="flex flex-col">
            <p className="mb-1.5 font-semibold text-white">{c("language", "Language")}</p>
            <LanguageList variant="footer" />
          </nav>
        </div>
        <div className="flex flex-wrap justify-between gap-3 border-t border-navy-border pt-5 text-[13.5px] text-navy-faint">
          <span>{COPYRIGHT_NOTICE}</span>
          <span>
            <Link href="/security" className="inline-flex items-center text-navy-text underline">{c("storage", "EU-region document storage")}</Link>{c("atRest", ", AES-GCM at rest")}
          </span>
        </div>
      </div>
    </footer>
  );
}
