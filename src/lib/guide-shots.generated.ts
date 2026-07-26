/**
 * GENERATED FILE — do not edit by hand.
 *
 * Written by `bun run guides:capture` (scripts/guide-shots/capture.spec.ts).
 * It is the manifest of screenshots that actually exist under public/guides/,
 * with their intrinsic pixel size.
 *
 * `<GuideShot>` reads this manifest instead of guessing: a shot listed here
 * renders as a real <img> with correct width/height (no layout shift); a shot
 * NOT listed renders nothing in production and a dashed placeholder in dev.
 * That way a guide can reference a screenshot before the capture has been run
 * without ever shipping a broken image to a customer.
 */

export interface GuideShotMeta {
  /** Intrinsic width in CSS pixels. */
  w: number;
  /** Intrinsic height in CSS pixels. */
  h: number;
}

/** Keyed `"<guide-slug>/<shot-name>"`. */
export const GUIDE_SHOTS: Record<string, GuideShotMeta> = {
  "onboard-a-new-client/supplier-catalog-tab": { w: 2360, h: 1400 },
  "receive-orders-by-email/imap-form": { w: 2360, h: 1640 },
  "receive-orders-by-email/needs-supplier-banner": { w: 2360, h: 1640 },
  "receive-orders-by-email/settings-email-intake": { w: 2360, h: 1640 },
};
