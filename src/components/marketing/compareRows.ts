import { euro } from "@/lib/billingWords";
import { DOCUMENT_PLANS, PLAN_BY_ID } from "@/lib/plans";

// The table /compare prints. The columns are KINDS of tool, never a product, so each cell must
// hold for the kind in general: where tools of a kind differ, the cell says "Varies by tool.",
// never No. Every ProcuLink Yes is something every plan does today (offer ⇔ works). The price is
// read off the public paid ladder, never typed. Kept under components/marketing so the
// public-copy guards read these words.

export const COMPARE_TOOLS = [
  "ProcuLink",
  "Template-based PDF parsers",
  "General AI extraction tools",
  "Typing it by hand",
] as const;

/** The icon beside a cell. The words carry the answer; the icon only repeats it. */
export type CompareMark = "yes" | "no" | "partly" | null;
export type CompareCell = readonly [CompareMark, string];

const VARIES: CompareCell = [null, "Varies by tool."];
const CHEAPEST_MONTHLY = Math.min(...DOCUMENT_PLANS.map((p) => p.priceMonthly ?? Infinity));

export const COMPARE_ROWS: readonly { name: string; cells: readonly [CompareCell, CompareCell, CompareCell, CompareCell] }[] = [
  {
    name: "No template to build for each layout",
    cells: [["yes", "Yes, a new layout needs no setup."], ["no", "No, usually one template per layout."], ["yes", "Usually none needed."], ["yes", "Yes, but you type every value."]],
  },
  {
    name: "The original shown beside what was read",
    cells: [["yes", "Yes, side by side on a wide screen."], VARIES, VARIES, ["partly", "Only if you keep both open."]],
  },
  {
    name: "Values to check are marked and held for you",
    cells: [["yes", "Yes, with how sure we are. You choose what waits."], VARIES, VARIES, ["no", "No, a typo looks like any other value."]],
  },
  {
    name: "Learns where each sender puts a value",
    cells: [["yes", "Yes, point at a value once and we look there next time."], ["partly", "You edit the template."], VARIES, ["partly", "Only what the person remembers."]],
  },
  {
    name: "Makes the file your system imports",
    cells: [["yes", "Yes, with your column names and separator."], VARIES, VARIES, ["partly", "You build it by hand."]],
  },
  {
    name: "Swaps codes for the ones on your own list",
    cells: [["yes", "Yes, with lookup lists you keep."], VARIES, VARIES, ["partly", "You look each one up."]],
  },
  {
    name: "Documents in by email, upload, SFTP, S3 or API",
    cells: [["yes", "Yes, on every plan."], VARIES, VARIES, ["no", "No, you open each file yourself."]],
  },
  {
    name: "Files out by email, SFTP, a web address, Google Sheets or download",
    cells: [["yes", "Yes, on every plan."], VARIES, VARIES, ["no", "No, you enter it yourself."]],
  },
  {
    name: "Files and data stored in the EU",
    cells: [["yes", "Yes, though some processing uses named US providers."], VARIES, VARIES, [null, "Wherever you keep them."]],
  },
  {
    name: "Price a month, cheapest paid plan",
    cells: [
      [null, `From ${euro(CHEAPEST_MONTHLY)} a month, free for ${PLAN_BY_ID.pilot.priceCadence} first.`],
      VARIES,
      VARIES,
      [null, "No subscription, but it takes staff time."],
    ],
  },
];
