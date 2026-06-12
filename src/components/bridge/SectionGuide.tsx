"use client";

// SectionGuide — calm first-visit guide card for every sidebar screen.
//
// Mounted ONCE in the (app) layout between the topbar and the page content.
// Matches the current pathname against the section-guides registry:
//   • no entry            → renders nothing
//   • first visit         → expanded inline card (title, purpose, bullets,
//                           highlighted "Start here" line, "Got it" dismiss)
//   • after dismissal     → tiny muted "About this screen" pill that
//                           re-expands transiently (the seen key is kept)
//
// NOT a tour / coachmarks / modal. No animation beyond the simple expand.
// HelpSlideover reuses <SectionGuideBody> in compact form and can replay the
// intro via the SECTION_GUIDE_REPLAY_EVENT window event.

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Info } from "lucide-react";
import { capture } from "@/lib/analytics";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { Card } from "@/components/bridge/layout/Card";
import {
  SECTION_GUIDE_REPLAY_EVENT,
  guideSeenKey,
  matchGuide,
  resolveGuideText,
  type GuidePartyLabels,
  type SectionGuideEntry,
} from "@/lib/section-guides";

// SSR renders collapsed; the layout effect re-checks localStorage BEFORE the
// browser paints, so a first visit expands without a collapsed-pill flash and
// without any hydration mismatch (initial render is identical on both sides).
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// ─── Shared body renderer (full card + HelpSlideover compact form) ──────────

interface SectionGuideBodyProps {
  guide: SectionGuideEntry;
  labels: GuidePartyLabels;
  /** Tighter type + spacing for the HelpSlideover. */
  compact?: boolean;
  /** Called when a guide link is followed (HelpSlideover closes itself). */
  onNavigate?: () => void;
}

export function SectionGuideBody({
  guide,
  labels,
  compact = false,
  onNavigate,
}: SectionGuideBodyProps) {
  const t = (s: string) => resolveGuideText(s, labels);
  const bodySize = compact ? 12 : 12.5;

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
          margin: compact ? "10px 0 5px" : "12px 0 6px",
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
              padding: compact ? "2.5px 0" : "3px 0",
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
          marginTop: compact ? 10 : 12,
          padding: compact ? "8px 10px" : "9px 12px",
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

// ─── Inline guide (mounted once in the (app) layout) ────────────────────────

function SectionGuideInner({ guide }: { guide: SectionGuideEntry }) {
  const { labels } = useOrderDirection();
  const [expanded, setExpanded] = useState(false);

  // First-visit check. Read failure (blocked storage) counts as "seen" so the
  // card never nags when we can't remember a dismissal.
  useIsomorphicLayoutEffect(() => {
    let seen = true;
    try {
      seen = window.localStorage.getItem(guideSeenKey(guide.route)) !== null;
    } catch {
      seen = true;
    }
    if (!seen) setExpanded(true);
  }, [guide.route]);

  // "Replay intro" from the HelpSlideover.
  useEffect(() => {
    function onReplay(e: Event) {
      const detail = (e as CustomEvent<{ route?: string }>).detail;
      if (detail?.route === guide.route) setExpanded(true);
    }
    window.addEventListener(SECTION_GUIDE_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(SECTION_GUIDE_REPLAY_EVENT, onReplay);
  }, [guide.route]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(guideSeenKey(guide.route), new Date().toISOString());
    } catch {
      // Storage unavailable — collapse for this session anyway.
    }
    setExpanded(false);
    capture("section_guide_dismissed", { route: guide.route });
  }, [guide.route]);

  // Transient re-expand — the seen key is intentionally left in place.
  const reopen = useCallback(() => {
    setExpanded(true);
    capture("section_guide_reopened", { route: guide.route });
  }, [guide.route]);

  const title = resolveGuideText(guide.title, labels);

  return (
    <div
      className="flex-shrink-0 px-4 sm:px-6 lg:px-[34px]"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="mx-auto w-full"
        style={{ maxWidth: "var(--container-narrow)" }}
      >
        {expanded ? (
          <div style={{ paddingTop: 14, paddingBottom: 2 }}>
            <Card edge="bridge">
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 8,
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    color: "var(--ink)",
                  }}
                >
                  {title}
                </h2>
                <button
                  type="button"
                  onClick={dismiss}
                  className="min-h-[44px] sm:min-h-[30px] flex-shrink-0"
                  style={{
                    padding: "4px 14px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--ink-muted)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--surface-2)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "var(--surface)";
                  }}
                >
                  Got it
                </button>
              </div>
              <SectionGuideBody guide={guide} labels={labels} />
            </Card>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={reopen}
              aria-expanded={false}
              aria-label={`About this screen: ${title}`}
              className="inline-flex items-center gap-1.5"
              style={{
                minHeight: "var(--tap-min)",
                padding: "0 6px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 500,
                color: "var(--ink-faint)",
                transition: "color 150ms",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = "var(--ink-muted)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color = "var(--ink-faint)";
              }}
            >
              <Info size={13} strokeWidth={2} aria-hidden />
              About this screen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Route-aware wrapper. Keyed by the matched registry route so navigating to a
 * different screen resets the transient expanded state and re-runs the
 * first-visit check (the layout itself persists across App Router navigation).
 */
export function SectionGuide() {
  const pathname = usePathname();
  const guide = matchGuide(pathname);
  if (!guide) return null;
  return <SectionGuideInner key={guide.route} guide={guide} />;
}
