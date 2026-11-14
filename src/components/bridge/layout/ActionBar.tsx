/**
 * A phone's main-button bar: fixed just above the tab bar, or at the screen edge on a full-screen step.
 * Nothing from 768px up. Its buttons fill the row; the spacer keeps the page's last line clear of it.
 *
 * Bottom padding: 10px, plus whatever of the home-indicator inset the tab bar does not already cover
 * (the tab bar covers all of it, so on a full-screen step, where the token is 0px, the bar adds it itself).
 * The bar and the spacer share this one expression so they cannot drift apart.
 */
const BOTTOM_PAD = "calc(10px + max(0px, env(safe-area-inset-bottom) - var(--plk-tabbar-h, 0px)))";
/** 1px border + 10px top padding + 48px buttons + the bottom padding. */
const BAR_HEIGHT = `calc(59px + ${BOTTOM_PAD})`;

export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden className="md:hidden" style={{ height: BAR_HEIGHT }} />
      <div
        data-testid="action-bar"
        className="fixed inset-x-0 z-drawer flex gap-[10px] border-t border-border bg-surface px-4 pt-[10px] md:hidden [&>*]:h-12 [&>*]:flex-1 [&>*]:rounded-[10px] [&>*]:text-base"
        style={{
          bottom: "calc(var(--plk-tabbar-h, 0px) + var(--plk-bottom-inset, 0px))",
          paddingBottom: BOTTOM_PAD,
        }}
      >
        {children}
      </div>
    </>
  );
}
