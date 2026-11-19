/**
 * A phone's main-button bar: fixed just above the tab bar, or at the screen edge on a full-screen step.
 * Nothing from 768px up. Its buttons fill the row; the spacer keeps the page's last line clear of it.
 *
 * Its bottom padding and height are --plk-actionbar-pad / --plk-actionbar-h in globals.css (they clear the tab bar's
 * raised Add and the home indicator). The bar and the spacer share them so they cannot drift apart, and the main
 * scroll area reads the height so what is scrolled into view stops above the bar.
 */
export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden className="md:hidden" style={{ height: "var(--plk-actionbar-h)" }} />
      <div
        data-testid="action-bar"
        className="plk-actionbar fixed inset-x-0 z-drawer flex gap-[10px] border-t border-border bg-surface px-4 pt-[10px] md:hidden [&>*]:h-12 [&>*]:flex-1 [&>*]:rounded-[10px] [&>*]:text-base"
        style={{
          bottom: "calc(var(--plk-tabbar-h, 0px) + var(--plk-bottom-inset, 0px))",
          paddingBottom: "var(--plk-actionbar-pad)",
        }}
      >
        {children}
      </div>
    </>
  );
}
