import { describe, it, expect, test } from "vitest";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  decodeSourceText,
  filenameFromDisposition,
  normalizeContentType,
  resolveIncomingView,
  sourceFormatLabel,
  sourceRenderFor,
  sourceUnavailableMessage,
  SOURCE_PURGED_FALLBACK_MESSAGE,
  type SourceDocumentState,
} from "./sourceDocument";

const blob = () => new Blob(["x"]);
const served = (contentType: string): SourceDocumentState => ({
  kind: "document",
  document: { blob: blob(), contentType, filename: null },
});

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
    expect(sourceRenderFor("application/octet-stream")).toBe("opaque");
  });

  it("anything unlisted is opaque — an unknown type never acquires a renderer by accident", () => {
    for (const t of ["text/html", "image/svg+xml", "application/json", "", "garbage"]) {
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

describe("sourceFormatLabel", () => {
  it("says only what the media type establishes", () => {
    expect(sourceFormatLabel("application/pdf")).toBe("PDF");
    expect(sourceFormatLabel("text/csv")).toBe("CSV");
    expect(
      sourceFormatLabel("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe("XLSX");
    // The server collapses cXML / UBL / XML onto one media type and EDIFACT / X12 onto
    // another, so naming a dialect here would be re-inventing the guess this replaced.
    expect(sourceFormatLabel("application/xml")).toBe("XML");
    expect(sourceFormatLabel("text/plain")).toBe("TEXT");
  });

  it("an unrecognised type earns no chip rather than a made-up one", () => {
    expect(sourceFormatLabel("application/octet-stream")).toBeNull();
    expect(sourceFormatLabel("")).toBeNull();
  });
});

describe("filenameFromDisposition", () => {
  it("reads the quoted form", () => {
    expect(filenameFromDisposition('inline; filename="PO-2026-0142.pdf"')).toBe("PO-2026-0142.pdf");
  });

  it("prefers the RFC 5987 form, which is the one that survives non-ASCII", () => {
    expect(
      filenameFromDisposition("attachment; filename=\"order.xlsx\"; filename*=UTF-8''bestellung-%C3%A4.xlsx"),
    ).toBe("bestellung-ä.xlsx");
  });

  it("absent or unparseable yields null, never a fabricated name", () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition("inline")).toBeNull();
  });
});

describe("sourceUnavailableMessage", () => {
  it("says nothing when a document is on screen", () => {
    expect(sourceUnavailableMessage(served("application/pdf"))).toBeNull();
  });

  it("204 and 410 read as ordinary states, not as errors", () => {
    const none = sourceUnavailableMessage({ kind: "none" })!;
    expect(none).toContain("No original document is stored for this order");
    expect(none.toLowerCase()).not.toContain("error");
    expect(none.toLowerCase()).not.toContain("failed");

    const purged = sourceUnavailableMessage({
      kind: "purged",
      message: SOURCE_PURGED_FALLBACK_MESSAGE,
    })!;
    expect(purged).toContain("data-retention policy");
    expect(purged.toLowerCase()).not.toContain("error");
  });

  it("410 shows the server's own explanation when it arrives", () => {
    const serverText = "This file has been purged per the organisation's data retention policy.";
    expect(sourceUnavailableMessage({ kind: "purged", message: serverText })).toBe(serverText);
  });

  it("every refusal produces plain operator language — no status codes, no jargon", () => {
    const states: SourceDocumentState[] = [
      { kind: "none" },
      { kind: "purged", message: SOURCE_PURGED_FALLBACK_MESSAGE },
      { kind: "missing" },
      { kind: "throttled", retryAfterSeconds: 30 },
      { kind: "error" },
    ];
    for (const s of states) {
      const msg = sourceUnavailableMessage(s);
      expect(msg, `state ${s.kind} must have a sentence`).toBeTruthy();
      expect(msg).not.toMatch(/\b(204|404|410|429|HTTP|blob|storage key)\b/i);
      // CLAUDE.md §9: the purged bridge vocabulary is banned from anything a user reads.
      expect(msg).not.toMatch(/\b(dock|crossing|lane|spine)\b/i);
      expect(msg!.trim().endsWith(".")).toBe(true);
    }
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
      const label = sourceFormatLabel(t);
      if (t === "application/octet-stream") {
        // The deliberate "we could not identify these bytes" answer.
        expect(render).toBe("opaque");
        expect(label).toBeNull();
      } else {
        expect(render, `${t} has no renderer`).not.toBe("opaque");
        expect(label, `${t} has no chip label`).toBeTruthy();
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
