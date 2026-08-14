"use client";

// DashboardContextLine — the 36px context line under the navy topbar (dashboard
// only). Founder-approved mock (2026-07): the "Dashboard" tab in the topbar IS
// the page name, so the row that held the H1 becomes a compact line that says
// something the tab cannot: greeting + date + the one thing needing action,
// with a jump link to the blockers section.
//
// Data sources — nothing fetched here:
//   • first name: Clerk useUser(), already mounted in the shell (UserChipMenu);
//   • blockers: passed in by BridgeDashboard from the same needsYouAll list its
//     "Needs you" section renders — the two numbers can never disagree;
//   • clock/locale: the CLIENT clock, read after mount (`now` starts null) so
//     the SSR pass and first client render agree — no hydration mismatch.

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";

/** Day-part for the greeting, from the client's local hour. */
export function greetingForHour(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

interface DashboardContextLineProps {
  /**
   * Count of orders blocking the pipeline (BridgeDashboard's needsYouAll
   * length). null while the source query is loading or errored — the segment
   * and jump link are simply absent, never a fabricated number.
   */
  blockers: number | null;
  /**
   * How many orders `blockers` was counted over.
   *
   * REQUIRED, and deliberately not defaulted. `blockers === 0` on its own cannot tell
   * "nothing is wrong" apart from "nothing is wrong in the part we looked at", and a
   * default would let the next caller skip the question — which is exactly how this
   * component came to print "All clear" over a 100-order page.
   */
  blockersScanned: number;
  /**
   * True when those `blockersScanned` orders are EVERY order in the account.
   *
   * Also required. False is the honest answer whenever the source is paged, and the
   * component says which window it covers instead of a verdict it cannot support.
   */
  blockersComplete: boolean;
  /** Scrolls the "Needs you" section into view. */
  onJumpToBlockers: () => void;
}

const SEP = <span aria-hidden style={{ color: "#CBD0DA" }}>·</span>;

export function DashboardContextLine({
  blockers,
  blockersScanned,
  blockersComplete,
  onJumpToBlockers,
}: DashboardContextLineProps) {
  const { user } = useUser();
  // Mounted guard: date + greeting depend on the client clock; rendering them
  // only after mount keeps server and first-client markup identical.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);

  const firstName = user?.firstName ?? null;
  const greeting = now ? `Good ${greetingForHour(now.getHours())}` : null;
  const dateLabel = now
    ? now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : null;

  return (
    <div
      className="flex flex-shrink-0 items-center gap-2 px-3 sm:px-5"
      style={{
        height: 36,
        background: "#FFFFFF",
        borderBottom: "1px solid #E5E8EE",
        fontSize: 12,
        color: "#566982",
      }}
    >
      {greeting && (
        <span className="truncate" style={{ fontWeight: 700, color: "#0B1A2F" }}>
          {firstName ? `${greeting}, ${firstName}` : greeting}
        </span>
      )}
      {dateLabel && (
        <>
          <span className="hidden sm:inline" aria-hidden style={{ color: "#CBD0DA" }}>·</span>
          <span className="hidden whitespace-nowrap sm:inline">{dateLabel}</span>
        </>
      )}
      {blockers !== null && (
        <>
          {greeting && SEP}
          {blockers > 0 ? (
            <span className="whitespace-nowrap">
              <b style={{ color: "var(--danger, #B3362A)", fontWeight: 700 }}>
                {blockers} {blockers === 1 ? "blocker" : "blockers"}
              </b>{" "}
              {blockers === 1 ? "needs you first" : "need you first"}
            </span>
          ) : blockersComplete ? (
            // Earned: the count covered every order in the account, and found none.
            <span
              className="whitespace-nowrap"
              style={{ color: "var(--brand-green-deep, #1E6D29)", fontWeight: 600 }}
            >
              All clear
            </span>
          ) : (
            // Not earned. The count covered one page, and the attention strip further
            // down the same screen prints the whole population — so "All clear" here
            // could sit directly above "137 orders need your attention". Name the window
            // instead of returning a verdict. Muted, not brand green: the green is the
            // verdict colour, and this is a fact about what was looked at.
            // (GET /api/orders is OrderByDescending(o => o.CreatedAt), so "newest" is
            // the real ordering, not a guess.)
            <span className="whitespace-nowrap">
              No blockers in the newest {blockersScanned.toLocaleString()}{" "}
              {blockersScanned === 1 ? "order" : "orders"}
            </span>
          )}
        </>
      )}
      {blockers !== null && blockers > 0 && (
        <button
          type="button"
          onClick={onJumpToBlockers}
          className="ml-auto flex-shrink-0 whitespace-nowrap"
          style={{
            // 44px hit area centered in the 36px row (same overflow-hit-area
            // pattern as the topbar's 44px buttons inside its 52px row).
            height: 44,
            margin: "-4px 0 -4px auto",
            padding: "0 2px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 11.5,
            fontWeight: 600,
            color: "#1E66C9",
          }}
        >
          Jump to blockers →
        </button>
      )}
    </div>
  );
}

export default DashboardContextLine;
