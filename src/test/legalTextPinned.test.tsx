import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createHash } from "node:crypto";
import PrivacyPage from "@/app/(marketing)/privacy/page";
import TermsPage from "@/app/(marketing)/terms/page";
import AupPage from "@/app/(marketing)/aup/page";
import DpaPage from "@/app/(marketing)/dpa/page";
import SubprocessorsPage from "@/app/(marketing)/subprocessors/page";
import SecurityPage from "@/app/(marketing)/security/page";

// The legal wording is pinned by the text a reader sees, not by the source file:
// markup and styling may move, the words may not. Digests were taken on the
// unedited pages before any restyle touched them.
//
// What is outside the hash: <style>, <script>, every <nav> (the related-pages
// row), anything hidden, and anything marked [data-legal-chrome] (template
// chrome that is the same on every page). Everything else, including the page's
// h1 and its updated/effective line, is legal text.
//
// Known limit: text nodes are joined with one space, so a lost {" "} between two
// separate text nodes is invisible here. A changed word, number or punctuation
// mark is not.
function legalText(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll('style,script,nav,[hidden],[aria-hidden="true"],[data-legal-chrome]')
    .forEach((el) => el.remove());
  const parts: string[] = [];
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const PINNED: Record<"/privacy" | "/terms" | "/aup" | "/dpa" | "/subprocessors" | "/security#statements", string> = {
  // Re-pinned 2026-11-25: new "Microsoft accounts you connect" section (Outlook pickup) and date line.
  // Re-pinned 2026-11-25 (plan 30 Part B): that section also covers saving files to a OneDrive folder.
  // Re-pinned 2026-11-26 (release pass): new "AI assistants you connect" section, destinations sentence, date line.
  // Re-pinned 2026-11-27 (legal polish): "In short" summary, numbered sections, new 5 (who receives), 7 (protection), 16 (changes); sources and Art. 22 lines; retention list as a table; cookie-choice line; date line.
  "/privacy": "e44f2ae8f11b8ce6aa80a1793e63115cfa3f0a7c7d4d1adf0570f9013e28a13f",
  // Re-pinned 2026-11-26 (release pass): §2 e-invoicing providers + KSeF confirm + early access, new §2a, §7 connected services, effective date.
  // Re-pinned 2026-11-26 (terms �5): the earlier paid plans moved under their own lead-in line, after Enterprise.
  // Re-pinned 2026-11-27 (legal polish): "In short" summary, sections renumbered 1-14, new 4 (account), 7 (confidentiality), 13 (general); support, AI provider, renewal, failed payment, objection and download lines; overage rules as a list; date line.
  "/terms": "dad21aa13dcc56909dad3b661aebf24f86e186c6315767b798374d34b648d25f",
  "/aup": "917a1e45c7f3775aad05ae6d74275ee63f522e4a2db5012bdecca0702f4c0fbf",
  // Re-pinned 2026-11-26 (release pass): §3 instructed disclosures, version 1.6.
  "/dpa": "a6cc19cf206af3bb271987f63a92532457cf72f677ab2491d56de8d2e086b585",
  // Re-pinned 2026-11-26 (release pass): Clerk purpose names the assistant sign-in (wording only; list unchanged).
  "/subprocessors": "afc6dea9fd52cd3ad3128d2f426c4937517fa07309b74ecaebdc23abb22a074e",
  // Re-pinned 2026-11-23 (UI review C-04): each card gained a one-sentence plain answer above its
  // unchanged detail, and the residency card's link reads "the subprocessor list", not "/subprocessors".
  // Re-pinned 2026-11-26 (release pass): the training line no longer covers assistants a customer connects.
  "/security#statements": "4752c15cabf3da75d1280b0b558f7341de72b888a6853d2c58e14df8f2055f94",
};

const PAGES = [
  ["/privacy", PrivacyPage],
  ["/terms", TermsPage],
  ["/aup", AupPage],
  ["/dpa", DpaPage],
  ["/subprocessors", SubprocessorsPage],
] as const;

const reason = (route: string) =>
  `${route}: the legal text changed. Legal wording is not rewritten in a design piece. If the founder approved this wording, list every changed sentence in the PR and re-pin with the digest printed here.`;

describe("legal text", () => {
  it.each(PAGES)("keeps the text of every legal page exactly as published (%s)", (route, Page) => {
    const { container } = render(<Page />);
    const t = legalText(container);
    expect(t.length, `${route} rendered almost no text`).toBeGreaterThan(1500);
    expect(sha256(t), reason(route)).toBe(PINNED[route]);
  });

  it("keeps the six security statements exactly as published", () => {
    const { container } = render(<SecurityPage />);
    const articles = Array.from(container.querySelectorAll("article"));
    expect(articles.length).toBe(6);
    const t = articles.map((a) => legalText(a as HTMLElement)).join("\n");
    expect(sha256(t), reason("/security#statements")).toBe(PINNED["/security#statements"]);
  });
});
