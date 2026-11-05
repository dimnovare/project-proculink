// The review bar's Download button and the class string that demotes the Send button beside it.
// Class-based (design tokens), shared by the desktop header bar and MobileTriage's sticky bar.

/** Applied to the Send button when Download leads the bar. */
export const SECONDARY_BAR_BUTTON = "bg-surface text-ink border border-border-strong disabled:text-ink-faint";

export function DownloadButton({ primary, enabled, busy, onClick, size }: {
  primary: boolean;
  enabled: boolean;
  busy: boolean;
  onClick: () => void;
  size: "bar" | "sticky";
}) {
  const geometry = size === "sticky" ? "w-full min-h-[48px] rounded-[10px] text-[16px]" : "h-9 px-[18px] rounded-lg text-[13px] shrink-0 whitespace-nowrap";
  const tone = primary
    ? "bg-brand-green-btn text-white border border-brand-green-deep disabled:opacity-60"
    : SECONDARY_BAR_BUTTON;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      data-cta-weight={primary ? "primary" : "secondary"}
      className={`${geometry} ${tone} font-bold disabled:cursor-not-allowed`}
    >
      {busy ? "Preparing the file…" : "Download"}
    </button>
  );
}
