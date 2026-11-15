import type { Metadata } from "next";
import Link from "next/link";
import { SkipToContent } from "@/components/a11y/SkipToContent";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { INK_CTA, SITE_PAGE } from "@/components/marketing/LegalPage";
import { SITE } from "@/components/marketing/sitePictures";

// Global branded 404. App Router renders this for any unmatched route outside the
// app (the app has its own, src/app/(app)/not-found.tsx). Kept as a Server Component
// with no data fetching so it renders even when the API is down. The root not-found
// is not wrapped by the (marketing) layout, so it draws the site frame itself. The
// H1's words are pinned by tests/e2e/csp.spec.ts and tests/e2e/no-mock-residue.spec.ts.
export const metadata: Metadata = {
  title: "Page not found — ProcuLink",
  description: "The page you were looking for doesn't exist or has moved.",
  robots: { index: false, follow: false },
};

const LINE = "h-2.5 rounded-full bg-surface-2";

export default function NotFound() {
  return (
    <div className="min-h-dvh bg-surface">
      <SkipToContent />
      <MarketingNav />
      <main id="main-content" tabIndex={-1} className={`${SITE_PAGE} outline-none`}>
        <section className="pb-32 pt-[104px]">
          <div className={`${SITE.wrap} flex flex-wrap items-center gap-x-24 gap-y-16`}>
            <div className="flex min-w-0 flex-[1_1_480px] flex-col items-start gap-6">
              <h1 className="m-0 font-display text-[clamp(40px,4.8vw,66px)] font-semibold leading-[1.02] tracking-[-0.02em] [text-wrap:balance]">
                This page took a wrong turn.
              </h1>
              <p className={`${SITE.lead} max-w-[540px]`}>
                The page you were looking for doesn&apos;t exist or has moved. Let&apos;s get you back on
                route.
              </p>
              <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5">
                <Link href="/" className={INK_CTA}>
                  Back to home
                </Link>
                <Link href="/help" className={SITE.more}>
                  Visit the help centre
                </Link>
              </div>
              <p className="text-[15px] text-ink-muted">Error 404</p>
            </div>

            {/* A sheet that missed its place: drawing only, so screen readers skip it. */}
            <div aria-hidden="true" className="flex min-w-0 flex-[0_1_380px] justify-center py-5">
              <div className="relative h-[330px] w-[250px] max-w-full">
                <div className="absolute inset-0 rounded-md border-2 border-dashed border-border-strong" />
                <div className="absolute inset-0 flex -translate-x-[26px] translate-y-[22px] -rotate-[9deg] flex-col gap-[13px] rounded-[5px] bg-surface px-7 py-[30px] shadow-md">
                  <div className={`${LINE} !h-3 w-[48%] !bg-border-strong`} />
                  <div className={`${LINE} w-[82%]`} />
                  <div className={`${LINE} w-[70%]`} />
                  <div className={`${LINE} mt-3 w-[88%]`} />
                  <div className={`${LINE} w-[88%]`} />
                  <div className={`${LINE} w-[61%]`} />
                  <p className="mt-auto self-end font-display text-[54px] font-semibold leading-none tracking-[-0.03em] text-border-strong">
                    404
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
