import Link from "next/link";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { COPYRIGHT_NOTICE } from "@/lib/legal-entity";
import { SITE_TAGLINE } from "@/lib/seo";
import { FOOTER_COLS } from "./footerColumns";

const LINK = "flex items-center min-h-[44px] text-navy-text no-underline hover:text-white";

/** The one footer of the public site: Home and every page under the marketing layout. */
export function SiteFooter() {
  const statusUrl = process.env.NEXT_PUBLIC_STATUS_URL;
  return (
    <footer className="on-navy bg-navy text-navy-text text-[15px] leading-normal">
      <div className="mx-auto flex max-w-[1208px] flex-col gap-10 px-6 pb-7 pt-14">
        <div className="grid gap-x-10 gap-y-8 [grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr))]">
          <div className="flex max-w-[420px] flex-col gap-3.5 sm:col-span-2">
            <div className="flex items-center gap-2.5 font-display text-[20px] font-bold tracking-[-0.02em] text-white">
              <span aria-hidden="true" className="inline-flex">
                <ProcuLinkMark size={26} mono />
              </span>
              ProcuLink
            </div>
            <p className="m-0">
              {`${SITE_TAGLINE} ProcuLink reads your documents, lets you check them and sends them on in the format you need, with a record of every delivery.`}
            </p>
          </div>
          {FOOTER_COLS.map((col) => (
            <nav key={col.h} aria-label={col.h} className="flex flex-col">
              {/* A group label, not a heading: it would jump the page's heading order. */}
              <p className="mb-1.5 font-semibold text-white">{col.h}</p>
              <ul className="m-0 list-none p-0">
                {col.links.map(([label, href]) => (
                  <li key={href}>
                    <Link href={href} className={LINK}>{label}</Link>
                  </li>
                ))}
                {col.h === "Company" && statusUrl && (
                  <li>
                    <a href={statusUrl} target="_blank" rel="noopener noreferrer" className={LINK}>Status</a>
                  </li>
                )}
              </ul>
            </nav>
          ))}
        </div>
        <div className="flex flex-wrap justify-between gap-3 border-t border-navy-border pt-5 text-[13.5px] text-navy-faint">
          <span>{COPYRIGHT_NOTICE}</span>
          <span>
            <Link href="/security" className="text-navy-text underline">EU-region document storage</Link>, AES-GCM at rest
          </span>
        </div>
      </div>
    </footer>
  );
}
