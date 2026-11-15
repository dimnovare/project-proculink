import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { cssToken } from "@/lib/cssTokens";
import { Mark } from "@/lib/pwa/appIcon";

// The share image, drawn at build time from the design tokens. Satori cannot
// resolve `var()`, so every colour is read out of globals.css by name, and
// nothing is imported from src/components.
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  const root = process.cwd();
  const fontDir = join(root, "node_modules", "@fontsource");
  const [css, display, body] = await Promise.all([
    readFile(join(root, "src", "app", "globals.css"), "utf8"),
    readFile(join(fontDir, "bricolage-grotesque", "files", "bricolage-grotesque-latin-600-normal.woff")),
    readFile(join(fontDir, "inter", "files", "inter-latin-400-normal.woff")),
  ]);
  const t = (name: string) => cssToken(css, name);
  const blueBright = t("brand-blue-bright");
  const greenBright = t("brand-green-bright");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: t("navy") }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <Mark size={56} blue={blueBright} green={greenBright} />
            <div style={{ fontFamily: "Bricolage Grotesque", fontSize: 44, color: t("surface") }}>ProcuLink</div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontFamily: "Bricolage Grotesque",
              fontSize: 96,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
            }}
          >
            <div style={{ color: blueBright }}>Any document in.</div>
            <div style={{ color: greenBright }}>Clean data out.</div>
          </div>
          <div style={{ fontFamily: "Inter", fontSize: 30, color: t("navy-text") }}>proculink.eu</div>
        </div>
        <div
          style={{
            height: 8,
            backgroundImage: `linear-gradient(90deg, ${t("brand-blue")} 0%, ${t("brand-blue")} 35%, ${t("brand-green")} 65%, ${t("brand-green")} 100%)`,
          }}
        />
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Bricolage Grotesque", data: display, weight: 600, style: "normal" },
        { name: "Inter", data: body, weight: 400, style: "normal" },
      ],
    },
  );
}
