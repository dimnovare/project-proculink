/**
 * A phone's main-button bar: fixed just above the tab bar, or at the screen edge on a full-screen step.
 * Nothing from 768px up. Its buttons fill the row; the spacer keeps the page's last line clear of it.
 */
const ROW_HEIGHT = 68; // 48px buttons + 2 x 10px padding

export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden className="md:hidden" style={{ height: ROW_HEIGHT }} />
      <div
        data-testid="action-bar"
        className="fixed inset-x-0 z-drawer flex gap-[10px] border-t border-border bg-surface px-4 py-[10px] md:hidden [&>*]:h-12 [&>*]:flex-1 [&>*]:rounded-[10px] [&>*]:text-base"
        style={{ bottom: "calc(var(--plk-tabbar-h, 0px) + var(--plk-bottom-inset, 0px))" }}
      >
        {children}
      </div>
    </>
  );
}
