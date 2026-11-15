"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { euro, monthsFree, priceWords } from "@/lib/billingWords";
import { NUMBER_LOCALE } from "@/lib/format-number";
import {
  ANNUAL_BILLING_ENABLED,
  DOCUMENT_PLANS,
  PLAN_BY_ID,
  cheapestDocumentPlan,
  type BillingPeriod,
} from "@/lib/plans";
import { SITE, Tag } from "./sitePictures";

// The one client island on /pricing: the billing period, the volume slider, its answer and the
// four plans. Every figure is read from src/lib/plans.ts; the arithmetic is cheapestDocumentPlan,
// which mirrors how the backend bills extra documents. The first render (200 documents, monthly)
// is in the server's HTML, so the answer reads before any script runs.

/** Volumes people actually have, so 200 a month is not lost at the far left of a 10,000 scale. */
export const PRICE_STOPS: readonly number[] = [50, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000];
export const INITIAL_DOCUMENTS = 200;

const fmt = (n: number) => n.toLocaleString(NUMBER_LOCALE);

/** The two lines the helper shows; pure, so the server's first HTML and every later answer use one function. */
export function priceAnswer(documents: number, period: BillingPeriod): { answer: string; hint: string } {
  const { plan, fits, euros, next } = cheapestDocumentPlan(documents, period);
  const answer = fits
    ? `${fmt(documents)} a month fits in ${plan.name}.`
    : `About ${fmt(documents)} a month: ${plan.name}${next ? " is cheapest" : ""}, about ${euro(euros)} with extra documents.`;
  const hint = next
    ? `From about ${fmt(next.from)} a month, ${next.plan.name} ${next.same ? "costs the same, with no extra documents" : "costs less"}.`
    : `For more, talk to us about ${PLAN_BY_ID.enterprise.name}.`;
  return { answer, hint };
}

/** One grid for every width: one column, then auto-fit columns, then labels + four plans that share rows. */
const DESK = "min-[1100px]:grid-cols-[minmax(0,208fr)_repeat(4,minmax(0,226fr))]";
const ROW_LABEL = "flex min-h-[52px] items-center border-t border-border pr-4 text-[15.5px] text-ink-muted";

export function PriceHelper({ heading }: { heading?: ReactNode }) {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [stop, setStop] = useState(PRICE_STOPS.indexOf(INITIAL_DOCUMENTS));
  const yearly = ANNUAL_BILLING_ENABLED && period === "yearly";
  const documents = PRICE_STOPS[stop];
  const { answer, hint } = priceAnswer(documents, yearly ? "yearly" : "monthly");
  const winner = cheapestDocumentPlan(documents, yearly ? "yearly" : "monthly").plan;

  const segment = (value: BillingPeriod, label: string) => (
    <button
      type="button"
      aria-pressed={period === value}
      onClick={() => setPeriod(value)}
      className={`h-11 whitespace-nowrap rounded-lg px-1.5 text-[15.5px] font-semibold min-[660px]:px-[18px] ${
        period === value ? "bg-surface text-ink shadow-card" : "text-ink-muted"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div data-testid="price-helper" className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        {heading}
        {ANNUAL_BILLING_ENABLED && (
          <div
            role="group"
            aria-label="Billing period"
            className="grid w-full grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] rounded-[11px] bg-surface-2 p-[3px] min-[660px]:inline-flex min-[660px]:w-auto"
          >
            {segment("monthly", "Monthly")}
            {segment("yearly", `Annual, ${monthsFree(DOCUMENT_PLANS[0])} months free`)}
          </div>
        )}
      </div>

      <div>
        <div className={`flex flex-col gap-2 rounded-[14px] bg-bg px-[18px] pb-[18px] pt-4 min-[1100px]:grid ${DESK} min-[1100px]:items-center min-[1100px]:gap-0 min-[1100px]:px-0 min-[1100px]:py-5`}>
          <div className="flex flex-col gap-0.5 min-[1100px]:col-span-2 min-[1100px]:pl-6 min-[1100px]:pr-8">
            <label htmlFor="plk-volume" className="text-[16px] font-semibold [text-wrap:balance]">
              About how many documents a month?
            </label>
            <input
              id="plk-volume"
              type="range"
              min={0}
              max={PRICE_STOPS.length - 1}
              step={1}
              value={stop}
              aria-valuetext={`${fmt(documents)} documents a month`}
              onChange={(e) => setStop(Number(e.target.value))}
              className="block h-11 w-full cursor-pointer accent-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            />
            <div aria-hidden="true" className="flex justify-between text-[13.5px] text-ink-muted">
              <span>{fmt(PRICE_STOPS[0])}</span>
              <span>{fmt(PRICE_STOPS[PRICE_STOPS.length - 1])}</span>
            </div>
          </div>
          <div data-testid="price-answer" aria-live="polite" className="mt-1.5 flex min-w-0 flex-col gap-1.5 min-[1100px]:col-span-3 min-[1100px]:mt-0 min-[1100px]:pl-5 min-[1100px]:pr-6">
            <p className="font-display text-[22px] font-semibold leading-[1.2] tracking-[-0.01em] [text-wrap:balance] min-[1100px]:text-[24px]">{answer}</p>
            <p className={`${SITE.soft} text-[15.5px]`}>{hint}</p>
          </div>
        </div>

        <div
          role="group"
          aria-label="The four paid plans"
          className={`mt-3 grid gap-3 min-[660px]:grid-cols-[repeat(auto-fit,minmax(300px,1fr))] ${DESK} min-[1100px]:mt-4 min-[1100px]:grid-rows-[repeat(8,auto)] min-[1100px]:gap-0`}
        >
          <div aria-hidden="true" className="hidden min-[1100px]:row-span-8 min-[1100px]:grid min-[1100px]:grid-rows-subgrid">
            <span className={`${ROW_LABEL} row-start-5`}>Documents a month</span>
            <span className={`${ROW_LABEL} row-start-6`}>Flows</span>
            <span className={`${ROW_LABEL} row-start-7 border-b`}>Each extra document</span>
          </div>
          {DOCUMENT_PLANS.map((plan) => {
            const on = plan === winner;
            return (
              <article
                key={plan.id}
                data-plans={plan.id}
                data-cheapest={on ? "" : undefined}
                className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-[12px] p-5 min-[1100px]:row-span-8 min-[1100px]:grid-cols-1 min-[1100px]:grid-rows-subgrid min-[1100px]:items-stretch min-[1100px]:py-0 ${
                  on ? "bg-brand-blue-soft" : "bg-bg min-[1100px]:bg-transparent"
                }`}
              >
                <h3 className={`${SITE.h3} min-[1100px]:row-start-2 min-[1100px]:mt-2.5`}>{plan.name}</h3>
                <p className="whitespace-nowrap text-right min-[1100px]:row-start-3 min-[1100px]:mt-3.5 min-[1100px]:flex min-[1100px]:items-baseline min-[1100px]:text-left">
                  <span className="font-display text-[28px] font-semibold leading-none tracking-[-0.02em] min-[1100px]:text-[clamp(38px,3.2vw,44px)]">
                    {euro(yearly ? plan.priceYearly! / 12 : plan.priceMonthly!)}
                  </span>
                  <span className={`${SITE.soft} ml-2 text-[15px] min-[1100px]:text-[17px]`}>a month</span>
                </p>
                {on ? (
                  <Tag tone="in" className="col-span-2 mt-2 justify-self-start min-[1100px]:col-span-1 min-[1100px]:row-start-1 min-[1100px]:mt-[18px]">
                    Cheapest for your volume
                  </Tag>
                ) : (
                  <span aria-hidden="true" className="col-span-2 mt-2 hidden h-[26px] min-[660px]:block min-[1100px]:col-span-1 min-[1100px]:row-start-1 min-[1100px]:mt-[18px]" />
                )}
                <p
                  className={`col-span-2 mt-1.5 text-[15px] text-ink-muted min-[1100px]:col-span-1 min-[1100px]:row-start-4 min-[1100px]:mt-2 min-[1100px]:block min-[1100px]:pb-[22px] min-[1100px]:text-[14px] ${
                    yearly ? "" : "hidden"
                  }`}
                >
                  {yearly ? `Billed once a year, ${euro(plan.priceYearly!)}` : `Or ${priceWords(plan, "yearly")}`}
                </p>
                <ul className="col-span-2 m-0 mt-2 list-none p-0 text-[16.5px] leading-[1.5] min-[1100px]:col-span-1 min-[1100px]:row-span-3 min-[1100px]:row-start-5 min-[1100px]:mt-0 min-[1100px]:grid min-[1100px]:grid-rows-subgrid min-[1100px]:text-[17px]">
                  {[
                    [fmt(plan.orderLimit!), " documents a month"],
                    [plan.flowLimit == null ? "Unlimited" : fmt(plan.flowLimit), " flows"],
                    ["Each extra document ", euro(plan.overageEur!)],
                  ].map(([a, b], i) => (
                    <li
                      key={i}
                      className="min-[1100px]:-mx-5 min-[1100px]:flex min-[1100px]:min-h-[52px] min-[1100px]:items-center min-[1100px]:border-t min-[1100px]:border-border min-[1100px]:px-5 min-[1100px]:last:border-b"
                    >
                      {i < 2 ? (
                        <><span className="font-semibold">{a}</span><span className="min-[1100px]:sr-only">{b}</span></>
                      ) : (
                        <><span className="min-[1100px]:sr-only">{a}</span><span className="font-semibold">{b}</span></>
                      )}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.cta.href}
                  className="col-span-2 mt-3.5 inline-flex h-12 items-center justify-center whitespace-nowrap rounded-[10px] border-[1.5px] border-ink bg-surface px-5 text-[16px] font-semibold text-ink no-underline hover:bg-ink hover:text-white min-[1100px]:col-span-1 min-[1100px]:row-start-8 min-[1100px]:mb-[22px] min-[1100px]:mt-5 min-[1100px]:px-2"
                >
                  Choose {plan.name}
                </Link>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
