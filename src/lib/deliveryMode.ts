/**
 * deliveryMode.ts — the one set of names for which documents wait for a person.
 *
 * A flow's check mode (`Flow.automation`, mirroring `FlowAutomation` on the backend) is one of
 * three: check only what we marked, check every document, or check nothing. Every surface reads
 * `CHECK_MODES` and `checkModeLine` from here.
 *
 * The same idea has shipped under other names: "Auto-process", "Auto-deliver", "Send
 * automatically" and "auto-send" (the old per-supplier switch, until 2026-11), then "Review
 * before delivery" and "Automatic delivery" (the two flow modes, until plan 25a added the third).
 * `deliveryMode.test.ts` fails if any retired name comes back in shipped copy.
 *
 * Code identifiers (`autoDeliver`, `automation`, …) are deliberately unchanged.
 */

/** A flow's check mode: which documents wait for a person. Mirrors `FlowAutomation` (backend). */
export type CheckMode = "marked" | "review" | "auto";

/** The three check modes, in the order they are offered. */
export const CHECK_MODES: readonly { id: CheckMode; title: string; short: string }[] = [
  { id: "marked", title: "Check only what we marked", short: "Only what we marked" },
  { id: "review", title: "Check every document", short: "Every document" },
  { id: "auto", title: "Check nothing", short: "Nothing" },
];

/** An unknown mode reads as `review`: never claim a document goes by itself. */
const modeOf = (mode: string) => CHECK_MODES.find((m) => m.id === mode) ?? CHECK_MODES[1];
export const checkModeTitle = (mode: string): string => modeOf(mode).title;
export const checkModeShort = (mode: string): string => modeOf(mode).short;

const LINES: Record<CheckMode, [downloadOnly: string, withDestination: string]> = {
  marked: [
    "A document with a marked value waits for you. Every other document has its file made straight away.",
    "A document with a marked value waits for you. Every other document is sent straight away.",
  ],
  review: [
    "Every document waits in Needs you until someone presses Make the file.",
    "Every document waits in Needs you until someone presses Send.",
  ],
  auto: [
    "Every file is made as soon as the document is read, marked values included. You don't press anything.",
    "Every document is sent as soon as it is read, marked values included. You don't press anything.",
  ],
};
export const checkModeLine = (mode: CheckMode, downloadOnly: boolean): string => (LINES[mode] ?? LINES.review)[downloadOnly ? 0 : 1];

/** As FlowAutomation.SendsByItself: some documents go without a person. */
export const sendsByItself = (mode: string): boolean => mode === "auto" || mode === "marked";

/**
 * The names these modes used to ship under. Exported for the guard test only — nothing may
 * render them.
 */
export const RETIRED_DELIVERY_MODE_NAMES = [
  "Auto-process",
  "Auto-deliver",
  "Send automatically",
  "auto-send",
  "Review before delivery",
  "Automatic delivery",
] as const;
