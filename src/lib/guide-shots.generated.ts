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
  "check-and-send-a-document/compare": { w: 2360, h: 1640 },
  "check-and-send-a-document/files": { w: 2360, h: 1640 },
  "check-and-send-a-document/fix": { w: 2360, h: 1640 },
  "check-and-send-a-document/needs-you": { w: 2360, h: 1200 },
  "check-and-send-a-document/sent": { w: 2360, h: 1640 },
  "onboard-a-new-client/supplier-catalog-tab": { w: 2360, h: 1400 },
  "send-to-a-destination/deliveries": { w: 2360, h: 1640 },
  "send-to-a-destination/goes-to": { w: 2360, h: 1640 },
  "send-to-a-destination/new-destination": { w: 2360, h: 1640 },
  "send-to-a-destination/send-a-test": { w: 2360, h: 1640 },
  "send-to-a-destination/sign-in-and-save": { w: 2360, h: 1640 },
  "set-up-your-first-flow/add-a-document": { w: 2360, h: 1120 },
  "set-up-your-first-flow/check-what-we-read": { w: 2360, h: 1640 },
  "set-up-your-first-flow/choose-where-it-goes": { w: 2360, h: 1640 },
};
