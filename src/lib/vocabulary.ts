/**
 * vocabulary.ts — the closed vocabulary ProcuLink is allowed to teach.
 *
 * DESIGN-DB-1 §7.4: blocklists say what NOT to say; this file says what the
 * product MAY say. It is the source of truth for `bun run lint:vocab --nouns`,
 * which reads these arrays out of this file and fails when a NAVIGATION label
 * (sidebar item, hub tab, supplier tab, settings tab, inbox filter chip)
 * introduces a word outside them.
 *
 * Only nine nouns are taught to a customer. Everything else a label may contain
 * is either a place word, a support word from the closed list below, or a
 * grammatical filler.
 *
 * NOTE ON SCOPE: this governs *navigation* labels — the words the product uses
 * as the names of things and places. Order STATUS labels are sentences about
 * one order's state ("Extracting", "Couldn't read file") and are policed by the
 * jargon tiers in scripts/check-vocabulary.mjs, not by this budget.
 */

/** The nine nouns a customer may be taught. DESIGN-DB-1 §7.4. */
export const APPROVED_NOUNS = [
  "order",
  "supplier",
  "item code",
  "order layout",
  "output",
  "delivery",
  "rule",
  "issue",
  "workspace",
] as const;

/** The small closed set of place words the four-destination IA needs. */
export const APPROVED_PLACES = [
  "overview",
  "activity",
  "settings",
  "buyer",
  "change",
] as const;

/**
 * Support words that are NOT concepts the user has to learn — they are either
 * plain English verbs/adjectives, a factual acronym, or the name of a thing the
 * user already owns (their plan, their email, their API key). Every entry is
 * here because a shipped label in DESIGN-DB-1 §6 needs it; keep it closed.
 */
export const APPROVED_SUPPORT = [
  // tail + utility destinations
  "admin", "help", "support", "upload",
  // inbound documents (flag-gated tabs) — plain trade words, not jargon
  "invoice", "shipping", "notice",
  // read-only reference surfaces
  "format", "reference", "system", "status", "channel",
  // settings destinations
  "plan", "billing", "intake", "api", "key", "notification",
  "email", "sftp", "cloud", "folder", "s3", "r2",
  // inbox filter chips. "failed" stays: it is plain English for what happened,
  // and it is the SAME word as the collapsed row badge it filters, so the chip
  // and the rows can never disagree.
  "all", "need", "review", "ready", "send", "delivered", "failed", "queued",
] as const;

/** Grammatical filler that carries no concept. */
const FILLER = new Set([
  "a", "an", "and", "the", "to", "of", "in", "for", "with", "your", "our",
  "&", "·", "-", "–", "or", "on", "by", "from", "at", "is", "are",
]);

/**
 * Labels that still teach an unapproved noun ON PURPOSE, because the row that
 * retires them is a STRUCTURAL change (delete / merge / hide a destination) and
 * not a rename. WP-25 is rename-only; these belong to the IA packet that
 * rebuilds the nav tree. Every entry cites the DESIGN-DB-1 §6.1/§6.2 row that
 * kills it, so this list reads as a to-do rather than an amnesty.
 */
export const PENDING_IA_LABELS: ReadonlyArray<{ label: string; specRow: string }> = [
  { label: "Workbench", specRow: "§6.1 #3 DELETE — group headers go away with the four-item nav" },
  { label: "Library", specRow: "§6.1 #4 DELETE — group headers go away with the four-item nav" },
  { label: "Monitor", specRow: "§6.1 #5 DELETE — group headers go away with the four-item nav" },
  { label: "Rules & formats", specRow: "§6.1 #7 DELETE — split into Item codes / Rules / Output layouts" },
  { label: "Integrations", specRow: "§6.1 #9 DELETE — children move to hidden + Settings" },
  { label: "Drafts", specRow: "§6.1 #10 DELETE — /drafts redirects to /inbox" },
  { label: "Inbound", specRow: "§6.1 #11 DELETE — children become Orders tabs" },
  { label: "Connections", specRow: "§6.1 #16 HIDE — content is the supplier Changes tab" },
  { label: "Webhooks", specRow: "§6.1 #29 MERGE — into Settings ▸ Notifications" },
  { label: "Catalog", specRow: "§6.2 #36 MERGE — into Item codes ▸ Their product list" },
];

const PENDING_SET = new Set(PENDING_IA_LABELS.map((p) => p.label.toLowerCase()));

/** Every single word the vocabulary permits inside a navigation label. */
function approvedWordSet(): Set<string> {
  const words = new Set<string>();
  const add = (phrase: string) => {
    for (const w of phrase.toLowerCase().split(/\s+/)) if (w) words.add(w);
  };
  APPROVED_NOUNS.forEach(add);
  APPROVED_PLACES.forEach(add);
  APPROVED_SUPPORT.forEach(add);
  return words;
}

const APPROVED_WORDS = approvedWordSet();

/** Naive singulariser — enough for label words ("deliveries" → "delivery"). */
function singularForms(word: string): string[] {
  const out = [word];
  if (/ies$/.test(word)) out.push(word.slice(0, -3) + "y");
  if (/(ses|xes|zes|ches|shes)$/.test(word)) out.push(word.slice(0, -2));
  if (/es$/.test(word)) out.push(word.slice(0, -1), word.slice(0, -2));
  else if (/s$/.test(word) && !/ss$/.test(word)) out.push(word.slice(0, -1));
  return out;
}

/**
 * Words in `label` that the approved vocabulary does not permit.
 * Returns [] for an approved label. Case- and plural-insensitive.
 */
export function unapprovedWords(label: string): string[] {
  if (PENDING_SET.has(label.trim().toLowerCase())) return [];
  const bad: string[] = [];
  const words = label
    .toLowerCase()
    .replace(/[()"'’,.:;/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const w of words) {
    if (FILLER.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    if (singularForms(w).some((f) => APPROVED_WORDS.has(f))) continue;
    bad.push(w);
  }
  return bad;
}
