import type { Box } from "@/lib/api/documents";

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
