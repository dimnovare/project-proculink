/** A small square button of the original's toolbar: a page turn or a zoom step. */
export function PagerButton({ children, disabled, onClick, label }: { children: React.ReactNode; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-11 w-11 items-center justify-center rounded border border-border text-ink-muted disabled:opacity-40 lg:h-7 lg:w-7"
    >
      {children}
    </button>
  );
}

export const ZOOM = { min: 0.5, max: 3, step: 1.25 };

/** Smaller, the pane's own width, larger. Used by the PDF and the picture views. */
export function ZoomButtons({ zoom, onZoom }: { zoom: number; onZoom(z: number): void }) {
  const to = (z: number) => onZoom(Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(z * 100) / 100)));
  return (
    <div className="ml-auto flex items-center gap-1">
      <PagerButton disabled={zoom <= ZOOM.min} onClick={() => to(zoom / ZOOM.step)} label="Zoom out">−</PagerButton>
      <button
        type="button" onClick={() => onZoom(1)} aria-label="Fit to width" aria-pressed={zoom === 1}
        className="inline-flex h-11 items-center rounded border border-border px-3 text-[12.5px] font-semibold text-ink-muted aria-pressed:bg-surface-2 aria-pressed:text-ink lg:h-7 lg:px-2"
      >
        Fit
      </button>
      <PagerButton disabled={zoom >= ZOOM.max} onClick={() => to(zoom * ZOOM.step)} label="Zoom in">+</PagerButton>
    </div>
  );
}
