import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { GuideIndex } from "@/components/help/guide/GuideIndex";
import { SITE } from "@/components/marketing/sitePictures";
import { SITE_PAGE } from "@/components/marketing/LegalPage";

export const metadata = pageMetadata({
  path: "/help/guides",
  title: "Step-by-step setup guides — ProcuLink",
  description:
    "Numbered walkthroughs for setting ProcuLink up: your first flow, sending documents in, building an output, sending it to a destination, and importing a lookup.",
  ogDescription:
    "Numbered walkthroughs for setting up flows, intake, outputs, destinations and lookups in ProcuLink.",
});

export default function GuidesIndexPage() {
  return (
    <div className={SITE_PAGE}>
      <div className={`${SITE.wrap} pb-24 pt-10 sm:pt-14`}>
        <div className="max-w-[920px]">
          <nav aria-label="Breadcrumb" className="text-[15px] text-ink-muted">
            <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 p-0">
              <li>
                <Link href="/help" className="inline-flex min-h-[44px] items-center text-brand-blue-deep underline underline-offset-4">
                  Help centre
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-ink">
                Step-by-step guides
              </li>
            </ol>
          </nav>

          <header className="mt-4 flex flex-col gap-3">
            <h1 className="m-0 font-display text-[clamp(34px,4vw,48px)] font-semibold leading-[1.06] tracking-[-0.02em]">
              Step-by-step guides
            </h1>
            <p className={`${SITE.soft} m-0 max-w-[72ch] text-[19px]`}>
              One task per guide, in numbered steps, with what to do when a step does not work. The help articles stay
              the reference; a guide is the procedure.
            </p>
          </header>

          <GuideIndex audience="client" />

          <p className="mt-12">
            Need a guide that is not here yet?{" "}
            <Link href="/support" className={SITE.more}>
              Ask support
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}