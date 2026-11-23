import { euro, priceWords } from "@/lib/billingWords";
import { NUMBER_LOCALE } from "@/lib/format-number";
import { DOCUMENT_PLANS, PLAN_BY_ID } from "@/lib/plans";
import { HELP_TABLE } from "@/mdx-components";

// The billing article's plan list, built from src/lib/plans.ts so no price is typed by hand.
// Server-safe: no hooks.

const fmt = (n: number) => n.toLocaleString(NUMBER_LOCALE);
const flows = (n: number | null) => (n == null ? "Unlimited" : fmt(n));

export function PlanTable() {
  const trial = PLAN_BY_ID.pilot;
  const rows: string[][] = [
    [trial.name, `Free for ${trial.priceCadence}`, `${fmt(trial.orderLimit!)} in total`, flows(trial.flowLimit), "—"],
    ...DOCUMENT_PLANS.map((p) => [
      p.name,
      [priceWords(p, "monthly"), priceWords(p, "yearly")].filter(Boolean).join(", or "),
      `${fmt(p.orderLimit!)} a month`,
      flows(p.flowLimit),
      euro(p.overageEur!),
    ]),
  ];
  return (
    <div tabIndex={0} className={HELP_TABLE.wrap}>
      <table className={HELP_TABLE.table}>
        <thead>
          <tr>
            {["Plan", "Price", "Documents", "Flows", "Extra document"].map((h) => (
              <th key={h} scope="col" className={HELP_TABLE.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, ...cells]) => (
            <tr key={name}>
              <th scope="row" className={HELP_TABLE.th}>{name}</th>
              {cells.map((c, i) => <td key={i} className={HELP_TABLE.td}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
