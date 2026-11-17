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
  "/privacy": "6a218955bbc61ff9ac3f5ed2a68709a2e698854210f04d5f0f34d1767b3df716",
  "/terms": "956ddada611494eceb92a44fba4364382a66a51a6b50f5a07fa31011e130ea96",
  "/aup": "e9398125d3b0e8b4c41df0c9f3a92607bfff7bb35e8235419fa02cdd99062e1c",
  "/dpa": "cec1d1e805b2ad2f506c491079ca97f28f9e63d26b57a85f6eb8653136690301",
  "/subprocessors": "e4bd03fe1c61f9709e8a396e8070351c8ec6991a0b202b3b2dc7d47a89956122",
  "/security#statements": "280994103424d63c5b854ab168afcbc4eea525c4d35883069d1ffa2e2bad37b4",
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
