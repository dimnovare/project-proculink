"use client";

import { GUIDE_SHOTS } from "@/lib/guide-shots.generated";
import { useGuide } from "./GuideContext";

/**
 * A screenshot slot inside a step.
 *
 * The image is NOT referenced blindly. `GUIDE_SHOTS` is a generated manifest of
 * what `bun run guides:capture` actually wrote to public/guides/, so:
 *   - captured  → real <img>, with intrinsic width/height so nothing shifts.
 *   - captured  → nothing at all in production (never a broken image icon),
 *     not         and a labelled dashed placeholder in development so whoever
 *                 is writing the guide can see which shot is still missing.
 *
 * `alt` is required and must describe what the reader should look for, not
 * "screenshot of settings" — the guide has to work for someone who cannot see
 * the image at all.
 */
export function GuideShot({
  name,
  alt,
  caption,
}: {
  /** Shot name within this guide's folder, no extension. */
  name: string;
  alt: string;
  caption?: string;
}) {
  const guide = useGuide();
  const slug = guide?.slug ?? "";
  const key = `${slug}/${name}`;
  const meta = GUIDE_SHOTS[key];

  if (!meta) {
    if (process.env.NODE_ENV === "production") return null;
    return (
      <div
        className="mt-4 flex flex-col items-start gap-1 px-4 py-5"
        style={{
          border: "1.5px dashed var(--border-strong)",
          borderRadius: "var(--radius-md)",
          background: "var(--surface-2)",
        }}
      >
        <span
          className="text-[11px] font-semibold uppercase"
          style={{ color: "var(--ink-faint)", letterSpacing: "0.06em" }}
        >
          Screenshot not captured
        </span>
        <code className="text-[12px]" style={{ fontFamily: "var(--font-mono)", color: "var(--ink-muted)" }}>
          public/guides/{key}.png
        </code>
        <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
          Run <code style={{ fontFamily: "var(--font-mono)" }}>bun run guides:capture</code> to generate it.
          This block renders nothing in production.
        </span>
      </div>
    );
  }

  return (
    <figure className="mt-4" style={{ margin: "16px 0 0" }}>
      {/* A plain <img>, like the MDX `img` override: these are static PNGs in
          public/ whose intrinsic size the manifest already knows, so next/image
          would add an optimiser round-trip for no benefit. */}
      <img
        src={`/guides/${key}.png`}
        alt={alt}
        width={meta.w}
        height={meta.h}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full"
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          background: "var(--surface)",
        }}
      />
      {caption && (
        <figcaption className="mt-1.5 text-[12.5px]" style={{ color: "var(--ink-faint)" }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
