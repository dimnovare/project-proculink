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
  "/privacy": "ebf3de27e3028925e1af25bd82f6d27bc3974df93de99dbdb20c594c3f55014e",
  "/terms": "a85ed4affde78a10ef0566eea7e67f89a4b9d53848f7b73979469dddbe538c45",
  "/aup": "917a1e45c7f3775aad05ae6d74275ee63f522e4a2db5012bdecca0702f4c0fbf",
  "/dpa": "a86971bb79039f2a9403ebef616bf194cd955d36d4fe3cd3b20a5fe903a72e39",
  "/subprocessors": "e4bd03fe1c61f9709e8a396e8070351c8ec6991a0b202b3b2dc7d47a89956122",
  // Re-pinned 2026-11-23 (UI review C-04): each card gained a one-sentence plain answer above its
  // unchanged detail, and the residency card's link reads "the subprocessor list", not "/subprocessors".
  "/security#statements": "54a4c704be2ee16152bfc84ff949b36bef493e4f469be56b3f0be512c7494a76",
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
