/**
 * The practice-order chip — ONE affordance for "shown here, counted by nothing".
 *
 * WP-28 introduced it on the review screen, split in two so it costs no vertical budget
 * above the three columns: the at-a-glance half is this chip on the identity row, next to
 * the status badge; the sentence — per-order teaching — lives in the Issues column, where
 * per-order teaching already lives (CatalogHintCard renders from the same slot).
 *
 * IT LIVES IN ITS OWN FILE because the inbox row and the dashboard's lists need the same
 * chip, and the two alternatives were both worse. Copying the markup would put a second
 * practice affordance in the product, which is the vocabulary split this directory keeps
 * paying for. Importing it from OrderWorkshop would pull the entire order-detail module —
 * mapper workbench, passport, problem panels — into the inbox bundle to render a 17px
 * green pill.
 *
 * `size="sm"` is the list-row form. It is a density change only: same words, same colours,
 * same dot, so a row badge and the review screen's badge are recognisably one thing.
 * #1E6D29 on #E9F1EA is 5.57:1 — AA at both sizes.
 */
export function PracticeChip({ size = "md" }: { size?: "sm" | "md" } = {}) {
  const sm = size === "sm";
  return (
    <span
      className="inline-flex items-center rounded-full"
      title="Practice order — free, and it doesn't count against your plan."
      style={{
        fontSize: sm ? 10.5 : 12,
        fontWeight: 600,
        gap: sm ? 4 : 6,
        padding: sm ? "1px 7px" : "3px 11px",
        background: "#E9F1EA",
        color: "#1E6D29",
        whiteSpace: "nowrap",
      }}
    >
      {/* The same CSS dot InvoiceBadge draws, not an emoji: an emoji renders in the
          platform's font at the platform's colour and cannot participate in the system's
          icon construction language. */}
      <span
        aria-hidden
        style={{ width: sm ? 5 : 6, height: sm ? 5 : 6, borderRadius: "50%", background: "#2E8E3A", flexShrink: 0 }}
      />
      Practice
    </span>
  );
}
