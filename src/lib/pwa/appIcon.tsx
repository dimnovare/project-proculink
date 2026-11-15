import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { cssToken } from "@/lib/cssTokens";

/** The System Identity mark (viewBox 40): the arc with a blue end and a green end. Shared by the share image and the app icon. */
export function Mark({ size, blue, green }: { size: number; blue: string; green: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <defs>
        <linearGradient id="arc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={blue} />
          <stop offset="100%" stopColor={green} />
        </linearGradient>
      </defs>
      <path
        d="M8 10h14a10 10 0 0 1 10 10v0a10 10 0 0 1-10 10H8"
        stroke="url(#arc)"
        strokeWidth="3.6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="8" cy="10" r="2.5" fill={blue} />
      <circle cx="8" cy="30" r="2.5" fill={green} />
    </svg>
  );
}

/**
 * A square PNG: --navy background, the mark centred at 62.5% of the side (inside the
 * maskable safe zone). Colours are read from globals.css at build, because Satori
 * cannot resolve `var()`.
 */
export async function appIcon(size: 180 | 192 | 512): Promise<Response> {
  const css = await readFile(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const t = (name: string) => cssToken(css, name);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: t("navy") }}>
        <Mark size={Math.round(size * 0.625)} blue={t("brand-blue-bright")} green={t("brand-green-bright")} />
      </div>
    ),
    { width: size, height: size },
  );
}
