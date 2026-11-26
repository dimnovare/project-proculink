"use client";

// SourceDocumentBody — the received file, rendered.
//
// Three views, because purchase orders arrive as three shapes and only one of them is the easy
// case. Every one of them is addressable: the operator's task is "confirm line 14's item code",
// so the sheet view numbers its rows and the text view numbers its lines. A viewer you cannot
// point at is only half an answer.
//
//   pdf   → PdfDocumentView (pdf.js, page at a time)
//   sheet → CSV and XLSX as a real grid with row numbers and column letters
//   text  → XML / cXML / UBL / EDIFACT / X12 / JSON / plain text as numbered, wrapped monospace lines
//   opaque→ the server could not identify the bytes; we do not guess, we offer the file
//
// `bounded` is the mobile scroll-lock contract in prop form. The desktop pane owns a bounded
// scroll area;
// the mobile card must not, because a clipping ancestor without an `lg:` prefix is exactly how
// a blocked order became unscrollable on a phone. Both call sites are already separated by
// `hidden lg:grid` / `lg:hidden`, so this is a static choice, never a JS media query.

import { nextTabIndex } from "@/lib/tabKeys";
import { saveBlob } from "@/lib/saveBlob";
import { scrollTo } from "@/lib/scrollTo";
import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
  decodeSourceText,
  sourceRenderFor,
  type SourceDocument,
} from "@/lib/sourceDocument";
import type { Box, SourceLocation } from "@/lib/api/documents";
import { ImageDocumentView } from "./ImageDocumentView";
import { ZoomButtons } from "./ZoomButtons";
import { SpotsContext, spotProps, useSpotAt, type SourceSpot } from "./SourceHighlight";
import { parseAddress, spreadsheetColumnName } from "@/lib/sourceAddress";
import { scrollRegionProps } from "./scrollRegion";
import { Loading } from "@/components/bridge/LogoLoader";
import { buttonClass } from "@/components/bridge/DSPrimitives";
import {
  MAX_PREVIEW_ROWS,
  parseCsvTable,
  parseXlsxWorkbook,
  type SheetTable,
  type SheetWorkbook,
} from "@/lib/sheetPreview";

/** Stable ref: scrolls the highlighted line or cell into view (jsdom has no scrollIntoView). */
export { scrollTo };

// pdf.js is ~350KB and ESM-only; keeping it behind a client-only dynamic import means a CSV
// order never downloads it and the server bundle never sees it.
const PdfDocumentView = dynamic(
  () => import("./PdfDocumentView").then((m) => m.PdfDocumentView),
  { ssr: false, loading: () => <Loading className="px-4 py-3">Opening the document…</Loading> },
);

/** A spot the person pointed at: a box on a page or image, or a sheet cell / words on a text line. */
export type SourcePick = { page: number; box: Box } | { address: string; value: string };

export interface SourceDocumentBodyProps {
  /** Stable cache identity — the order id. */
  cacheKey: string;
  document: SourceDocument;
  bounded: boolean;
  /** Where the value being pointed at sits on the original (flows only). */
  highlight?: SourceLocation | null;
  /** Where the values that need a look sit on the original (flows only). */
  marks?: readonly SourceLocation[];
  /** Set to switch on pointing at the original; called with the spot picked. */
  onPick?(p: SourcePick): void;
  /** The read values that have a place here: clicking a place calls `onSpot` with its key (flows only). */
  spots?: readonly SourceSpot[];
  onSpot?(key: string): void;
}

export function SourceDocumentBody({ spots, onSpot, ...props }: SourceDocumentBodyProps) {
  // Never while pointing: a click then means "the value is here", not "go to the value".
  const clickable = useMemo(() => (spots && onSpot && !props.onPick ? { spots, go: onSpot } : null), [spots, onSpot, props.onPick]);
  return <SpotsContext.Provider value={clickable}><Body {...props} /></SpotsContext.Provider>;
}

function Body({ cacheKey, document: doc, bounded, highlight, marks, onPick }: Omit<SourceDocumentBodyProps, "spots" | "onSpot">) {
  const render = sourceRenderFor(doc.contentType);

  if (render === "pdf") {
    return (
      <Shell bounded={bounded}>
        <PdfDocumentView cacheKey={cacheKey} blob={doc.blob} bounded={bounded} highlight={highlight} marks={marks} onPick={onPick} />
        <DownloadRow document={doc} cacheKey={cacheKey} />
      </Shell>
    );
  }
  if (render === "sheet") {
    return (
      <Shell bounded={bounded}>
        <SheetView cacheKey={cacheKey} document={doc} bounded={bounded} highlight={highlight} marks={marks} onPick={onPick} />
        <DownloadRow document={doc} cacheKey={cacheKey} />
      </Shell>
    );
  }
  if (render === "image") {
    return (
      <Shell bounded={bounded}>
        <ImagePane bounded={bounded} blob={doc.blob} contentType={doc.contentType} filename={doc.filename ?? "Original document"} highlight={highlight} marks={marks} onPick={onPick} />
        <DownloadRow document={doc} cacheKey={cacheKey} />
      </Shell>
    );
  }
  if (render === "text") {
    return (
      <Shell bounded={bounded}>
        <TextView cacheKey={cacheKey} document={doc} bounded={bounded} highlight={highlight} marks={marks} onPick={onPick} />
        <DownloadRow document={doc} cacheKey={cacheKey} />
      </Shell>
    );
  }
  return (
    <Shell bounded={bounded}>
      <Message>
        We can&rsquo;t display this file type in the browser, so nothing is shown rather than
        something we&rsquo;d be guessing at. Download it to check the values yourself.
      </Message>
      <DownloadRow document={doc} cacheKey={cacheKey} />
    </Shell>
  );
}

// ── Sheet ────────────────────────────────────────────────────────────────────

function SheetView({
  cacheKey,
  document: doc,
  bounded,
  highlight,
  marks,
  onPick,
}: {
  cacheKey: string;
  document: SourceDocument;
  bounded: boolean;
  highlight?: SourceLocation | null;
  marks?: readonly SourceLocation[];
  onPick?(p: SourcePick): void;
}) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const base = useId();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["source-document-sheet", cacheKey],
    queryFn: async (): Promise<SheetWorkbook> => {
      const buffer = await doc.blob.arrayBuffer();
      if (doc.contentType === "text/csv") {
        const { text } = decodeSourceText(buffer);
        return { tables: [parseCsvTable(text)], omittedSheetNames: [] };
      }
      return parseXlsxWorkbook(new Uint8Array(buffer));
    },
    staleTime: Infinity,
    retry: false,
  });

  if (isLoading) return <Loading className="px-4 py-3">Reading the spreadsheet…</Loading>;
  if (isError || !data || data.tables.length === 0) {
    return (
      <Message>
        We couldn&rsquo;t read this spreadsheet in the browser. Download it to check the values
        against your own copy.
      </Message>
    );
  }

  const sel = Math.min(sheetIndex, data.tables.length - 1);
  const table = data.tables[sel];

  return (
    <div className={bounded ? "flex min-h-0 flex-1 flex-col" : "flex flex-col"}>
      {data.tables.length > 1 && (
        <div
          className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5"
          role="tablist"
          aria-label="Sheets in this workbook"
        >
          {data.tables.map((t, i) => (
            <button
              key={`${t.name}-${i}`}
              type="button"
              role="tab"
              id={`${base}-sheet-tab-${i}`}
              aria-controls={`${base}-sheet-panel`}
              aria-selected={i === sel}
              tabIndex={i === sel ? 0 : -1}
              onKeyDown={(e) => {
                const to = nextTabIndex(e.key, i, data.tables.length);
                if (to === undefined) return;
                e.preventDefault();
                setSheetIndex(to);
                document.getElementById(`${base}-sheet-tab-${to}`)?.focus();
              }}
              onClick={() => setSheetIndex(i)}
              className={
                i === sel
                  ? "flex-shrink-0 rounded border border-brand-blue px-2 py-0.5 text-[12.5px] font-semibold text-brand-blue-deep"
                  : "flex-shrink-0 rounded border border-border px-2 py-0.5 text-[12.5px] text-ink-muted"
              }
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      {/* Scrolls on both branches: vertically when bounded, horizontally otherwise — a wide
          sheet on a phone is exactly the case a keyboard user must be able to pan. */}
      <div
        {...scrollRegionProps(
          data.tables.length > 1 ? `Original document, sheet ${table.name}` : "Original document",
          true,
        )}
        {...(data.tables.length > 1 && {
          role: "tabpanel",
          id: `${base}-sheet-panel`,
          "aria-labelledby": `${base}-sheet-tab-${sel}`,
        })}
        className={
          (bounded ? "min-h-0 flex-1 overflow-auto" : "overflow-x-auto") +
          " focus-visible:[outline-offset:-2px]"
        }
      >
        <SheetGrid bounded={bounded} table={table} highlight={sel === 0 ? highlight : null} marks={sel === 0 ? marks : undefined} onPick={sel === 0 ? onPick : undefined} clickable={sel === 0} />
      </div>
      <TruncationNote table={table} omitted={data.omittedSheetNames} />
    </div>
  );
}

function SheetGrid({ bounded, table, highlight, marks, onPick, clickable }: { bounded: boolean; table: SheetTable; highlight?: SourceLocation | null; marks?: readonly SourceLocation[]; onPick?(p: SourcePick): void; /** This sheet is the one the values were read from. */ clickable: boolean }) {
  const spot = parseAddress(highlight?.address);
  const cell = spot?.kind === "cell" ? spot : null;
  const marked = new Set(marks?.map((m) => m.address));
  const spotAt = useSpotAt();
  const width = table.rows.reduce((m, r) => Math.max(m, r.length), 0);
  const columnLabels = useMemo(
    () => Array.from({ length: width }, (_, i) => spreadsheetColumnName(i)),
    [width],
  );

  if (table.rows.length === 0) {
    // NOT "This sheet is empty." — a zero-row table does not establish that.
    //
    // `parseXlsxWorkbook`'s own docblock says it "throws when the bytes are not a readable
    // OOXML zip — the caller turns that into the honest 'we can't display this one' state
    // rather than pretending the sheet is empty". Two paths inside it break that contract
    // without throwing: `readSheetRows` returns `[]` when `parseXml` fails on the worksheet
    // XML (sheetPreview.ts:318-319), and `parseXlsxWorkbook` substitutes `[]` when the
    // worksheet part named by the workbook relationships is not in the zip (:399). Both
    // arrive here as a table with no rows, indistinguishable from a genuinely blank sheet.
    //
    // So an operator checking an item code against a full spreadsheet read "This sheet is
    // empty" and stopped. This says what is actually known — no rows could be read — names
    // both possibilities, and points at the file itself, which is one button away below.
    return (
      <Message>
        <span data-testid="source-document-no-rows">
          We couldn&rsquo;t read any rows from this sheet. It may be empty, or laid out in a way
          this preview can&rsquo;t read — download the file below to check the values.
        </span>
      </Message>
    );
  }

  return (
    <table className="w-full border-collapse font-mono text-[12.5px]" data-testid="source-document-sheet">
      <thead>
        <tr>
          <th className="sticky left-0 z-10 border border-border bg-surface-2 px-2 py-1 text-right text-[12.5px] font-semibold text-ink-faint">
            #
          </th>
          {columnLabels.map((label) => (
            <th
              key={label}
              className="border border-border bg-surface-2 px-2 py-1 text-left text-[12.5px] font-semibold text-ink-faint"
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r}>
            <td className="sticky left-0 z-10 border border-border bg-surface-2 px-2 py-1 text-right text-[12.5px] text-ink-faint">
              {r + 1}
            </td>
            {columnLabels.map((label, c) => {
              const hit = cell?.row === r + 1 && cell.col === c + 1;
              const flag = marked.has(`cell:r${r + 1}c${c + 1}`);
              const text = row[c] ?? "";
              const go = clickable && text ? spotAt(`cell:r${r + 1}c${c + 1}`) : null;
              return (
                <td
                  key={label}
                  {...(hit && { "data-highlighted": "true", ref: bounded ? scrollTo : undefined })}
                  {...(flag && { "data-marked": "true" })}
                  className={`whitespace-pre border border-border px-2 py-1 align-top text-ink ${hit ? "bg-brand-blue-soft" : flag ? "bg-amber-soft" : "bg-surface"}`}
                >
                  {onPick && text ? (
                    <button
                      type="button"
                      aria-label={`Use cell ${label}${r + 1}`}
                      className="whitespace-pre text-left hover:underline"
                      onClick={() => onPick({ address: `cell:r${r + 1}c${c + 1}`, value: text })}
                    >
                      {text}
                    </button>
                  ) : go ? (
                    <span {...spotProps(go)} className="cursor-pointer hover:underline">{text}</span>
                  ) : (
                    text
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TruncationNote({ table, omitted }: { table: SheetTable; omitted: string[] }) {
  const parts: string[] = [];
  if (table.truncatedRows) parts.push(`Showing the first ${MAX_PREVIEW_ROWS} rows`);
  if (table.truncatedCols) parts.push("some columns are not shown");
  if (omitted.length) parts.push(`${omitted.length} more sheet${omitted.length === 1 ? "" : "s"} not shown`);
  if (parts.length === 0) return null;
  return (
    <p className="flex-shrink-0 border-t border-border px-3 py-1.5 text-[12.5px] text-ink-faint">
      {parts.join(" · ")}. Download the file to see all of it.
    </p>
  );
}

// ── Text (XML / cXML / UBL / EDIFACT / X12 / JSON / plain text) ──────────────────────────────────

/** Long enough to cover a real interchange, short enough that the DOM stays cheap. */
const MAX_TEXT_LINES = 4000;

function TextView({
  cacheKey,
  document: doc,
  bounded,
  highlight,
  marks,
  onPick,
}: {
  cacheKey: string;
  document: SourceDocument;
  bounded: boolean;
  highlight?: SourceLocation | null;
  marks?: readonly SourceLocation[];
  onPick?(p: SourcePick): void;
}) {
  const spot = parseAddress(highlight?.address);
  const markedLines = new Set(marks?.map((m) => parseAddress(m.address)).flatMap((a) => (a?.kind === "line" ? [a.n] : [])));
  const [noSelection, setNoSelection] = useState(false);
  const spotAt = useSpotAt();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["source-document-text", cacheKey],
    queryFn: async () => {
      const { text, fellBackToLatin } = decodeSourceText(await doc.blob.arrayBuffer());
      // EDIFACT is one enormous line terminated by `'`; splitting on the segment terminator is
      // what makes it readable at all, and it is the only reshaping done to any format here.
      const looksLikeEdifact = /(^|\n)UN[BH]\+/.test(text.slice(0, 4000));
      const body = looksLikeEdifact ? text.replace(/'(?!\n)/g, "'\n") : text;
      const lines = body.replace(/\r\n?/g, "\n").split("\n");
      return {
        lines: lines.slice(0, MAX_TEXT_LINES),
        truncated: lines.length > MAX_TEXT_LINES,
        fellBackToLatin,
      };
    },
    staleTime: Infinity,
    retry: false,
  });

  if (isLoading) return <Loading className="px-4 py-3">Reading the document…</Loading>;
  if (isError || !data) {
    return <Message>We couldn&rsquo;t read this file in the browser. Download it to check it.</Message>;
  }

  return (
    <div className={bounded ? "flex min-h-0 flex-1 flex-col" : "flex flex-col"}>
      {data.fellBackToLatin && (
        <p className="flex-shrink-0 border-b border-border bg-amber-soft px-3 py-1.5 text-[12.5px] text-amber-text">
          This file didn&rsquo;t declare a character set and isn&rsquo;t valid UTF-8, so it is
          shown as Windows-1252. Accented characters may differ from the sender&rsquo;s copy.
        </p>
      )}
      {onPick && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <button
            type="button"
            onClick={() => {
              const sel = window.getSelection();
              const line = sel?.anchorNode?.parentElement?.closest("li[data-line]");
              const value = sel?.toString().trim();
              const ok = line && value && line === sel?.focusNode?.parentElement?.closest("li[data-line]");
              setNoSelection(!ok);
              if (ok) onPick({ address: `line:${line.getAttribute("data-line")}`, value });
            }}
            className="rounded border border-border px-2 py-0.5 text-[12.5px] text-ink-muted hover:border-border-strong"
          >
            Use selected words
          </button>
          {noSelection && (
            <span role="status" className="text-[12.5px] text-ink-faint">
              Select words on one line first.
            </span>
          )}
        </div>
      )}
      {/* Only the bounded branch scrolls. Unbounded, the list renders at its natural height and
          <main> scrolls it, so a tab stop here would be a dead one. */}
      <div
        {...scrollRegionProps("Original document", bounded)}
        className={bounded ? "min-h-0 flex-1 overflow-auto focus-visible:[outline-offset:-2px]" : ""}
      >
        <ol
          className="m-0 list-none p-0 font-mono text-[12.5px] leading-[1.55]"
          data-testid="source-document-text"
        >
          {data.lines.map((line, i) => {
            const hit = spot?.kind === "line" && spot.n === i + 1;
            const flag = markedLines.has(i + 1);
            const go = spotAt(`line:${i + 1}`);
            return (
              <li
                key={i}
                data-line={i + 1}
                {...(hit && { "data-highlighted": "true", ref: bounded ? scrollTo : undefined })}
                {...(flag && { "data-marked": "true" })}
                className={`flex gap-2 px-2 ${hit ? "bg-brand-blue-soft" : flag ? "bg-amber-soft" : "hover:bg-surface-2"}`}
              >
                <span className="w-9 flex-shrink-0 select-none text-right text-[12.5px] text-ink-faint">
                  {i + 1}
                </span>
                <span {...(go && spotProps(go))} className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-ink ${go ? "cursor-pointer hover:underline" : ""}`}>{line}</span>
              </li>
            );
          })}
        </ol>
      </div>
      {data.truncated && (
        <p className="flex-shrink-0 border-t border-border px-3 py-1.5 text-[12.5px] text-ink-faint">
          Showing the first {MAX_TEXT_LINES} lines. Download the file to see all of it.
        </p>
      )}
    </div>
  );
}

// ── Shared chrome ────────────────────────────────────────────────────────────

/** A photo or scan with its zoom buttons above the area that scrolls. */
function ImagePane({ bounded, ...image }: { bounded: boolean } & Omit<React.ComponentProps<typeof ImageDocumentView>, "zoom">) {
  const [zoom, setZoom] = useState<number | null>(null);
  return (
    <>
      <div className="flex flex-shrink-0 items-center border-b border-border px-3 py-1.5"><ZoomButtons zoom={zoom} onZoom={setZoom} /></div>
      <div className={bounded ? "min-h-0 flex-1 overflow-auto" : "overflow-auto"}>
        <ImageDocumentView {...image} zoom={zoom} />
      </div>
    </>
  );
}

function Shell({ bounded, children }: { bounded: boolean; children: React.ReactNode }) {
  // No `overflow-hidden` on the unbounded branch: the mobile card must grow with its content
  // and let <main> scroll it.
  return (
    <div className={bounded ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "flex flex-col"}>
      {children}
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-3 text-[12.5px] leading-relaxed text-ink-faint">{children}</p>;
}

function DownloadRow({ document: doc, cacheKey }: { document: SourceDocument; cacheKey: string }) {
  const [failed, setFailed] = useState(false);
  const name = doc.filename || `order-${cacheKey}-source`;

  const onDownload = () => {
    try {
      saveBlob(doc.blob, name);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-faint" title={name}>
        {name}
      </span>
      <button
        type="button"
        onClick={onDownload}
        className={`${buttonClass("secondary", "sm")} flex-shrink-0`}
      >
        Download
      </button>
      {failed && (
        <span role="status" className="text-[12.5px] text-danger">
          Couldn&rsquo;t start the download.
        </span>
      )}
    </div>
  );
}
