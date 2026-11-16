import { createContext, useContext, useMemo } from "react";
import type { Box, SourceLocation } from "@/lib/api/documents";

/** A read value's place on the original, as something to click: `key` names the value on the other side. */
export interface SourceSpot { key: string; label: string; location: SourceLocation }

/** Set while the places can be clicked; null while a person is pointing at the original to teach a value. */
export const SpotsContext = createContext<{ spots: readonly SourceSpot[]; go(key: string): void } | null>(null);

/** The places on one page or picture, as buttons over it. Mouse only: the keyboard starts from the values. */
export function SpotButtons({ page, exact }: { page: number; /** A PDF: only a place that names this page. A picture is one page, named or not. */ exact?: boolean }) {
  const ctx = useContext(SpotsContext);
  const area = (s: SourceSpot) => (s.location.box ? s.location.box.width * s.location.box.height : 0);
  // Largest first: a small box inside a larger one is drawn on top of it, so both can be reached.
  return ctx && [...ctx.spots].sort((a, b) => area(b) - area(a)).map(({ key, label, location: l }) => l.box && (exact ? l.page : l.page ?? 1) === page && (
    <button
      key={key} type="button" tabIndex={-1} aria-label={`Go to ${label}`} title={label} onClick={() => ctx.go(key)}
      className="absolute cursor-pointer rounded-sm hover:bg-brand-blue/10 hover:ring-2 hover:ring-brand-blue"
      style={{ left: `${l.box.x * 100}%`, top: `${l.box.y * 100}%`, width: `${l.box.width * 100}%`, height: `${l.box.height * 100}%` }}
    />
  ));
}

/**
 * What makes a piece of the original's own text lead to its value. A span, not a button: the text can still be
 * selected and copied, and a screen reader still reads what the original says. A click while text is selected does nothing.
 */
export const spotProps = (spot: { label: string; go(): void }) => ({
  "data-spot": "", title: `Go to ${spot.label}`,
  onClick: () => { if (!window.getSelection()?.toString()) spot.go(); },
});

/** The place at a sheet cell or a text line, by its address. Where several values were read there, the first. */
export function useSpotAt(): (address: string) => { label: string; go(): void } | null {
  const ctx = useContext(SpotsContext);
  const byAddress = useMemo(() => {
    const first = new Map<string, SourceSpot>();
    for (const s of ctx?.spots ?? []) if (s.location.address && !first.has(s.location.address)) first.set(s.location.address, s);
    return first;
  }, [ctx]);
  return (address) => {
    const s = byAddress.get(address);
    return s && ctx ? { label: s.label, go: () => ctx.go(s.key) } : null;
  };
}

/**
 * Where a read value sits on the original. Place inside a `relative` wrapper the size of the page or image.
 * `point` (blue) is the value being pointed at, rendered after the marks so it draws above them; `look` (amber) is a value that needs a look.
 */
export function SourceHighlight({ box, tone = "point" }: { box: Box; tone?: "point" | "look" }) {
  return (
    <div
      data-testid={tone === "look" ? "source-mark" : "source-highlight"} aria-hidden
      className={`pointer-events-none absolute ${tone === "look" ? "bg-amber-soft/40 ring-2 ring-amber" : "bg-brand-blue/15 ring-2 ring-brand-blue"}`}
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
    />
  );
}
