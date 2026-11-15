"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { capture } from "@/lib/analytics";
import { INK_CTA, SITE_PAGE } from "@/components/marketing/LegalPage";
import { SITE } from "@/components/marketing/sitePictures";
import { CheckoutReceipt } from "./checkoutReceipt";

/* This page has TWO referrers and both are load-bearing:
   - Stripe checkout returns every paying customer here with `?upgraded={plan}`
     (success_url is built in the backend, not in this repo), which is why the
     receipt block below is conditional and why the route is noindex and absent
     from the sitemap.
   - It is also the first-run guide for a new workspace.
   Do not delete it, and do not remove the `upgraded` branch.

   ⚠ `upgraded` is a HINT, never the claim. The receipt reads the plan and the
   "active" assertion off `GET /api/billing/status`; see checkoutReceipt.tsx for
   what this page used to assert from the URL alone and why that was a truth
   defect rather than a cosmetic one. */

/* What happens next. Text, not links: the one action on this page is "Open ProcuLink". */
const STEPS: [string, string][] = [
  ["Drop your first document", "A PDF, a spreadsheet, a scan or a photo. A test or anonymised one is fine."],
  ["Check what we read", "The original stays on screen beside it. Fix anything that's wrong."],
  [
    "Choose where it goes",
    "Download the file, or send it by email, to a server or to Google Drive. Nothing is sent until you say so.",
  ],
];

function WelcomeBody() {
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();
  const upgraded = searchParams.get("upgraded");

  useEffect(() => {
    if (!isLoaded) return;
    capture("welcome_viewed", { upgraded: upgraded ?? "" });
  }, [isLoaded, upgraded]);

  const firstName = user?.firstName;

  return (
    <div className={SITE_PAGE}>
      <section aria-label="Welcome" className="pb-24 pt-[72px]">
        <div className={`${SITE.wrap} grid grid-cols-1 items-start gap-x-[72px] gap-y-12 min-[900px]:grid-cols-2`}>
          <div className="flex min-w-0 flex-col items-start gap-6">
            <h1 className="m-0 font-display text-[clamp(36px,4.2vw,56px)] font-semibold leading-[1.04] tracking-[-0.02em] [text-wrap:balance]">
              {`Welcome to ProcuLink${firstName ? `, ${firstName}` : ""}.`}
            </h1>
            <div className="w-full empty:hidden">
              <CheckoutReceipt expectedPlan={upgraded} />
            </div>
            <Link href="/documents" className={`${INK_CTA} w-full sm:w-auto`}>
              Open ProcuLink
            </Link>
            <p className={SITE.soft}>
              Your first document takes a few minutes. Prefer to follow along?{" "}
              <Link
                href="/help/guides/set-up-your-first-flow"
                className="font-semibold text-brand-blue-deep underline underline-offset-[5px]"
              >
                Read the step-by-step guide
              </Link>
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <h2 className="font-display text-[26px] font-semibold leading-[1.2] tracking-[-0.015em]">What happens next</h2>
            <ol className="m-0 list-none border-b border-border p-0">
              {STEPS.map(([title, detail], i) => (
                <li key={title} className="flex flex-col gap-1.5 border-t border-border py-5">
                  <span className="text-[14px] font-semibold text-ink-muted">{`Step ${i + 1}`}</span>
                  <h3 className={SITE.h3}>{title}</h3>
                  <p className={SITE.soft}>{detail}</p>
                </li>
              ))}
            </ol>
          </div>

          <p className={`${SITE.soft} min-[900px]:col-span-2`}>
            Need a hand?{" "}
            <a href="mailto:support@proculink.eu" className="font-semibold text-brand-blue-deep underline underline-offset-[5px]">
              support@proculink.eu
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}

export default function WelcomePage() {
  // The (marketing) layout has no QueryClientProvider — only the (app) layout does,
  // and /welcome deliberately sits outside it (a customer returning from Stripe may
  // not have completed org selection yet). The receipt needs a real server read, so
  // this route brings its own client. Same query key as the app's billing query, so
  // nothing is lost when the user walks into /settings next.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <WelcomeBody />
      </Suspense>
    </QueryClientProvider>
  );
}
