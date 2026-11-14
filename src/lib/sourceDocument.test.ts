import { describe, it, expect, test } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  decodeSourceText,
  DOCX_MEDIA_TYPE,
  normalizeContentType,
  resolveIncomingView,
  sourceRenderFor,
} from "./sourceDocument";

describe("normalizeContentType", () => {
  it("drops parameters and case, because a charset must not change the branch taken", () => {
    expect(normalizeContentType("Application/PDF; charset=utf-8")).toBe("application/pdf");
    expect(normalizeContentType("  text/csv  ")).toBe("text/csv");
  });

  it("absent or blank is the empty string, never a guessed type", () => {
    expect(normalizeContentType(null)).toBe("");
    expect(normalizeContentType(undefined)).toBe("");
  });
});

describe("sourceRenderFor", () => {
  it("routes each served media type to its viewer", () => {
    expect(sourceRenderFor("application/pdf")).toBe("pdf");
    expect(sourceRenderFor("text/csv")).toBe("sheet");
    expect(
      sourceRenderFor("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe("sheet");
    expect(sourceRenderFor("application/xml")).toBe("text");
    expect(sourceRenderFor("text/plain")).toBe("text");
    expect(sourceRenderFor("application/json")).toBe("text");
    expect(sourceRenderFor("application/octet-stream")).toBe("opaque");
  });

  it("anything unlisted is opaque — an unknown type never acquires a renderer by accident", () => {
    for (const t of ["text/html", "image/svg+xml", "application/ld+json", "", "garbage"]) {
      expect(sourceRenderFor(t)).toBe("opaque");
    }
  });

  it("reaches at least three distinct viewers, so the map is not collapsing to one answer", () => {
    const kinds = new Set(
      [
        "application/pdf",
        "text/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/xml",
        "text/plain",
      ].map(sourceRenderFor),
    );
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    expect(kinds.has("opaque")).toBe(false);
  });
});

describe("resolveIncomingView", () => {
  it("shows the document when one exists", () => {
    expect(resolveIncomingView("document", true)).toBe("document");
  });

  it("falls back to the field list rather than rendering an empty pane", () => {
    expect(resolveIncomingView("document", false)).toBe("fields");
  });

  it("an explicit field request is honoured even when a document exists", () => {
    expect(resolveIncomingView("fields", true)).toBe("fields");
  });
});

describe("decodeSourceText", () => {
  it("decodes UTF-8 and says so", () => {
    const bytes = new TextEncoder().encode("Schrauben, verzinkt");
    expect(decodeSourceText(bytes)).toEqual({ text: "Schrauben, verzinkt", fellBackToLatin: false });
  });

  it("falls back to Windows-1252 rather than emitting replacement characters", () => {
    // 0xE4 is 'ä' in Windows-1252 and an invalid lone lead byte in UTF-8. The server declares
    // no charset on purpose, so this is the case an ERP-exported CSV actually hits.
    const latin = new Uint8Array([0x53, 0x63, 0x68, 0x72, 0xe4, 0x75, 0x62, 0x65]);
    const out = decodeSourceText(latin);
    expect(out.fellBackToLatin).toBe(true);
    expect(out.text).toBe("Schräube");
    expect(out.text).not.toContain("�");
  });
});

// ── The map must match the server's, and the server owns it ──────────────────
//
// `SourceDocumentMediaType.For()` in the backend is a CLOSED allowlist, and this module has to
// cover exactly it: a type the server can send that this file does not know renders as opaque
// bytes (a silently degraded screen), and a type this file claims that the server can never
// send is dead code that reads as coverage. Both directions are checked against the C# itself
// rather than a list retyped here — a hand-copied expectation is how the drift it is supposed
// to catch survives.

const MEDIA_TYPE_REL = "ProcuLink.Core/Services/Detection/SourceDocumentMediaType.cs";

function findBackendRoot(): string | null {
  const fromEnv = process.env.PROCULINK_BACKEND_PATH;
  if (fromEnv && existsSync(join(fromEnv, MEDIA_TYPE_REL))) return fromEnv;
  let dir = resolve(process.cwd());
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dirname(dir), "ProcuLink");
    if (existsSync(join(candidate, MEDIA_TYPE_REL))) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const BACKEND = findBackendRoot();
/** CI checks the backend out, so there "no checkout" is a failure and not a reason to skip. */
const REQUIRE_MIRROR = process.env.PROCULINK_REQUIRE_BACKEND_MIRROR === "1";

/** Every `new("<media/type>", …)` in the C# map, including the Unknown fallback. */
export function mediaTypesFromCSharp(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/new\s*\(\s*"([^"]+)"/g)) found.add(m[1]);
  return [...found].sort();
}

describe("the media-type map mirrors the C# that produces it", () => {
  it("fails rather than skips when CI required the mirror", () => {
    if (REQUIRE_MIRROR) expect(BACKEND, "PROCULINK_REQUIRE_BACKEND_MIRROR=1 but no backend checkout").not.toBeNull();
  });

  it("the extractor finds the types it claims to (anti-vacuity)", () => {
    const sample = `"pdf" => new("application/pdf", RenderInline: true), "csv" => new("text/csv", RenderInline: true),`;
    expect(mediaTypesFromCSharp(sample)).toEqual(["application/pdf", "text/csv"]);
  });

  test.skipIf(!BACKEND)("every type the server can send has a renderer here", () => {
    const cs = readFileSync(join(BACKEND!, MEDIA_TYPE_REL), "utf8");
    const types = mediaTypesFromCSharp(cs);

    // The extractor must not be silently matching nothing.
    expect(types.length).toBeGreaterThanOrEqual(5);
    expect(types).toContain("application/pdf");

    for (const t of types) {
      const render = sourceRenderFor(t);
      if (t === "application/octet-stream") {
        // The deliberate "we could not identify these bytes" answer.
        expect(render).toBe("opaque");
      } else if (t === DOCX_MEDIA_TYPE) {
        // Word is a download on purpose: a browser cannot render it.
        expect(render).toBe("opaque");
      } else {
        expect(render, `${t} has no renderer`).not.toBe("opaque");
      }
    }
  });

  test.skipIf(!BACKEND)("this file claims no type the server cannot send", () => {
    const cs = readFileSync(join(BACKEND!, MEDIA_TYPE_REL), "utf8");
    const serverTypes = new Set(mediaTypesFromCSharp(cs));
    const claimed = [
      "application/pdf",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/xml",
      "text/plain",
      "application/json",
      DOCX_MEDIA_TYPE,
    ];
    for (const t of claimed) {
      expect(serverTypes.has(t), `${t} has a renderer here but the server never sends it`).toBe(true);
    }
  });

  test.skipIf(!BACKEND)("nothing scriptable is ever given a renderer", () => {
    const cs = readFileSync(join(BACKEND!, MEDIA_TYPE_REL), "utf8");
    for (const t of mediaTypesFromCSharp(cs)) {
      expect(t).not.toMatch(/html|svg|xhtml|javascript|ecmascript/i);
    }
  });
});
