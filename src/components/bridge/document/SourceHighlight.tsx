import type { Box } from "@/lib/api/documents";

/** Where a read value sits on the original. Place inside a `relative` wrapper the size of the page or image. */
export function SourceHighlight({ box }: { box: Box }) {
  return (
    <div
      data-testid="source-highlight" aria-hidden
      className="pointer-events-none absolute bg-brand-blue/15 ring-2 ring-brand-blue"
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
    />
  );
}
