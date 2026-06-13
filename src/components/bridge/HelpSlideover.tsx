"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { capture } from "@/lib/analytics";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import {
  POPULAR_ARTICLE_SLUGS,
  resolveArticles,
  type HelpArticle,
} from "@/lib/help-articles";
import { buildHelpFuse, searchHelpArticles } from "@/lib/help-search";
import { walkthroughConfigured } from "@/lib/walkthrough";
import {
  matchGuide,
  resolveGuideText,
  type GuidePartyLabels,
  type SectionGuideEntry,
} from "@/lib/section-guides";

interface Props {
  open:    boolean;
  onClose: () => void;
}

// ─── Section guide body ──────────────────────────────────────────────────────
// Renders one registry entry's purpose / bullets / "Start here" line. The help
// slideover is the ONLY home for guide content (the inline first-visit card was
// removed); guide hrefs that are bare "?tab=…" resolve against the CURRENT
// pathname, which is correct because the slideover always renders on the page
// the guide describes.

interface SectionGuideBodyProps {
  guide: SectionGuideEntry;
  labels: GuidePartyLabels;
  /** Called when a guide link is followed (the slideover closes itself). */
  onNavigate?: () => void;
}

function SectionGuideBody({ guide, labels, onNavigate }: SectionGuideBodyProps) {
  const t = (s: string) => resolveGuideText(s, labels);
  const bodySize = 12;

  const linkStyle: React.CSSProperties = {
    color: "var(--brand-blue-deep)",
    fontWeight: 500,
    textDecoration: "none",
  };

  return (
    <div>
      <p
        style={{
          margin: 0,
          fontSize: bodySize + 0.5,
          lineHeight: 1.5,
          color: "var(--ink-muted)",
        }}
      >
        {t(guide.purpose)}
      </p>

      <p
        style={{
          margin: "10px 0 5px",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        What you can do here
      </p>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {guide.bullets.map((bullet, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "2.5px 0",
              fontSize: bodySize,
              lineHeight: 1.5,
              color: "var(--ink-muted)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "var(--border-strong)",
                marginTop: 7,
                flexShrink: 0,
              }}
            />
            {bullet.href ? (
              <Link
                href={bullet.href}
                onClick={onNavigate}
                className="hover:underline"
                style={linkStyle}
              >
                {t(bullet.text)}
              </Link>
            ) : (
              <span>{t(bullet.text)}</span>
            )}
          </li>
        ))}
      </ul>

      <div
        style={{
          marginTop: 10,
          padding: "8px 10px",
          borderRadius: 6,
          background: "var(--brand-green-soft)",
          fontSize: bodySize,
          lineHeight: 1.5,
          color: "var(--ink)",
        }}
      >
        <span style={{ fontWeight: 700, color: "var(--brand-green-deep)" }}>
          Start here:
        </span>{" "}
        {guide.firstStep.href ? (
          <Link
            href={guide.firstStep.href}
            onClick={onNavigate}
            className="hover:underline"
            style={{ ...linkStyle, color: "var(--ink)", fontWeight: 600 }}
          >
            {t(guide.firstStep.text)}
          </Link>
        ) : (
          <span>{t(guide.firstStep.text)}</span>
        )}
      </div>
    </div>
  );
}

// ─── Article row ─────────────────────────────────────────────────────────────
// One help-center article link — used by both search results and the related-
// reading / popular lists. Always opens in a NEW TAB so the operator's
// work-in-progress on the current screen is preserved.

function ArticleLinkRow({
  article,
  surface,
  route,
  showCategory,
}: {
  article: HelpArticle;
  surface: string;
  route: string | null;
  showCategory?: boolean;
}) {
  return (
    <a
      href={`/help/${article.slug}`}
      target="_blank"
      rel="noopener"
      onClick={() => capture("help_article_click", { slug: article.slug, surface, route })}
      className="hover:underline"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: "var(--tap-min)",
        padding: "8px 10px",
        borderRadius: 6,
        textDecoration: "none",
      }}
    >
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink)",
            lineHeight: 1.35,
          }}
        >
          {article.title}
        </span>
        <span
          style={{
            display: "block",
            marginTop: 2,
            fontSize: 11,
            color: "var(--ink-faint)",
          }}
        >
          {showCategory && (
            <span
              style={{
                display: "inline-block",
                marginRight: 6,
                padding: "1px 6px",
                borderRadius: 99,
                background: "var(--surface-2)",
                color: "var(--ink-muted)",
                fontWeight: 600,
              }}
            >
              {article.category}
            </span>
          )}
          {article.readMin} min read
        </span>
      </span>
      <span aria-hidden style={{ color: "var(--ink-faint)", fontSize: 12, flexShrink: 0 }}>
        ↗
      </span>
    </a>
  );
}

// ─── Slideover ───────────────────────────────────────────────────────────────

export function HelpSlideover({ open, onClose }: Props) {
  const pathname = usePathname();
  const { labels } = useOrderDirection();
  const guide = matchGuide(pathname);

  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  const fuse = useMemo(() => buildHelpFuse(), []);
  const results = useMemo(
    () => searchHelpArticles(fuse, debounced, 6),
    [fuse, debounced],
  );
  const searching = debounced.trim().length > 0;

  const related = resolveArticles(guide?.articleSlugs, 3);
  const popular = resolveArticles(POPULAR_ARTICLE_SLUGS, 3);
  const showWatch = walkthroughConfigured();

  useEffect(() => {
    if (open) capture("help_slideover_opened", { route: pathname });
  }, [open, pathname]);

  // Focus the search input on open (BridgeTopbar restores focus to "?" on close).
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else {
      setQuery("");
      setDebounced("");
    }
  }, [open]);

  // Debounce the query 150 ms before searching.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  // One help_search event per settled (debounced) non-empty query.
  useEffect(() => {
    const q = debounced.trim();
    if (!q) return;
    capture("help_search", {
      query_len: q.length,
      results: searchHelpArticles(fuse, q, 6).length,
      surface: "slideover",
    });
  }, [debounced, fuse]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sectionLabelStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--ink-faint)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "12px 14px",
    marginBottom: 16,
  };

  return (
    <div
      role="dialog"
      aria-label="Help"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(11,26,47,0.32)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(380px, 100%)",
          background: "var(--surface)",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-12px 0 30px rgba(11,26,47,0.12)",
        }}
      >
        {/* Header */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 22px 0",
            marginBottom: 12,
            flexShrink: 0,
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)",
              fontSize: 18,
              fontWeight: 600,
              color: "var(--ink)",
              margin: 0,
            }}
          >
            Help
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
              lineHeight: 1,
              color: "var(--ink-faint)",
              padding: 10,
              minWidth: "var(--tap-min)",
              minHeight: "var(--tap-min)",
            }}
          >
            ×
          </button>
        </header>

        {/* Search */}
        <div style={{ padding: "0 22px", marginBottom: 14, flexShrink: 0 }}>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help…"
            aria-label="Search help articles"
            style={{
              width: "100%",
              height: 38,
              padding: "0 12px",
              fontSize: 13,
              color: "var(--ink)",
              background: "var(--surface)",
              border: "1px solid var(--border-strong)",
              borderRadius: 6,
              outline: "none",
            }}
          />
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 22px 16px" }}>
          {searching ? (
            // ── Search results replace sections 3–5 while a query is active ──
            <section style={cardStyle}>
              <p style={sectionLabelStyle}>Search results</p>
              {results.length === 0 ? (
                <p
                  style={{
                    margin: "8px 0 2px",
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: "var(--ink-muted)",
                  }}
                >
                  No matches — open the help center or contact support.
                </p>
              ) : (
                <div style={{ marginTop: 4 }}>
                  {results.map((a) => (
                    <ArticleLinkRow
                      key={a.slug}
                      article={a}
                      surface="slideover_search"
                      route={pathname}
                      showCategory
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <>
              {/* "This screen" — the current route's section guide. */}
              {guide && (
                <section style={cardStyle}>
                  <p style={sectionLabelStyle}>This screen</p>
                  <h3
                    style={{
                      margin: "6px 0 8px",
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--ink)",
                      lineHeight: 1.3,
                    }}
                  >
                    {resolveGuideText(guide.title, labels)}
                  </h3>
                  <SectionGuideBody
                    guide={guide}
                    labels={labels}
                    onNavigate={onClose}
                  />
                </section>
              )}

              {/* No-guide fallback — popular articles instead of an empty panel. */}
              {!guide && popular.length > 0 && (
                <section style={cardStyle}>
                  <p style={sectionLabelStyle}>Popular articles</p>
                  <div style={{ marginTop: 4 }}>
                    {popular.map((a) => (
                      <ArticleLinkRow
                        key={a.slug}
                        article={a}
                        surface="slideover_popular"
                        route={pathname}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* "Related reading" — up to 3 registry-driven article rows. */}
              {guide && related.length > 0 && (
                <section style={cardStyle}>
                  <p style={sectionLabelStyle}>Related reading</p>
                  <div style={{ marginTop: 4 }}>
                    {related.map((a) => (
                      <ArticleLinkRow
                        key={a.slug}
                        article={a}
                        surface="slideover_related"
                        route={pathname}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Walkthrough — rendered only when the video is configured. */}
              {showWatch && (
                <a
                  href="/watch"
                  target="_blank"
                  rel="noopener"
                  onClick={() => capture("help_watch_click", { surface: "slideover" })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minHeight: "var(--tap-min)",
                    padding: "10px 14px",
                    marginBottom: 16,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink)",
                    textDecoration: "none",
                    background: "var(--brand-green-soft)",
                  }}
                >
                  <span aria-hidden style={{ color: "var(--brand-green-deep)" }}>▷</span>
                  Watch the walkthrough
                  <span aria-hidden style={{ marginLeft: "auto", color: "var(--ink-faint)", fontSize: 12 }}>↗</span>
                </a>
              )}
            </>
          )}
        </div>

        {/* Persistent footer nav — visible during search too. All new tab. */}
        <nav
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "14px 22px 20px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          {[
            { href: "/help",                 label: "Open help center" },
            { href: "/support",              label: "Contact support" },
            { href: "/support#report-a-bug", label: "Report a bug" },
          ].map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                minHeight: "var(--tap-min)",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 14,
                color: "var(--ink)",
                textDecoration: "none",
              }}
            >
              {l.label}
              <span aria-hidden style={{ color: "var(--ink-faint)", fontSize: 12 }}>↗</span>
            </a>
          ))}
        </nav>
      </aside>
    </div>
  );
}
