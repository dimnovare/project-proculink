/** The flow page's four steps, the two views beside them, and the address that names one. */
export type FlowStep = "arrives" | "read" | "check" | "send";
export type FlowView = FlowStep | "documents" | "history";

export const FLOW_STEPS: readonly { id: FlowStep; number: 1 | 2 | 3 | 4; title: string }[] = [
  { id: "arrives", number: 1, title: "Arrives" },
  { id: "read", number: 2, title: "We read" },
  { id: "check", number: 3, title: "You check" },
  { id: "send", number: 4, title: "We send" },
];

/** A step's title: step 4 makes the file on a download-only flow; an unknown flag keeps "We send". */
export const stepTitle = (id: FlowStep, downloadOnly?: boolean): string =>
  id === "send" && downloadOnly === true ? "We make the file" : FLOW_STEPS.find((s) => s.id === id)!.title;

// The old tab names stay as aliases: other screens, help pages and bookmarks still link to them.
const VIEWS = new Map<string, FlowView>([
  ["arrives", "arrives"], ["read", "read"], ["check", "check"], ["send", "send"], ["documents", "documents"], ["history", "history"],
  ["intake", "arrives"], ["fields", "read"], ["outputs", "send"], ["versions", "history"],
]);

/** The view the address asks for; null when it names none, or names one we do not know, or names more than one. */
export function readFlowView(params: Pick<URLSearchParams, "get" | "getAll">): FlowView | null {
  const tab = params.get("tab");
  return tab !== null && params.getAll("tab").length === 1 ? VIEWS.get(tab) ?? null : null;
}

/** The output We send opens; null when the address names none, or more than one. An unknown id is the screen's to settle. */
export function readFlowOutput(params: Pick<URLSearchParams, "get" | "getAll">): string | null {
  return params.getAll("output").length === 1 ? params.get("output") : null;
}

export function flowAddress(flowId: string, view: FlowView | null, extra?: { output?: string }): string {
  const base = `/flows/${encodeURIComponent(flowId)}`;
  if (!view) return base;
  const q = new URLSearchParams({ tab: view });
  if (extra?.output) q.set("output", extra.output);
  return `${base}?${q}`;
}

/** The four ways the Change the file screen can open on. */
export type FileWay = "sample" | "docs" | "standard";
const WAYS: readonly string[] = ["sample", "docs", "standard"];

/** `/flows/{id}/change-file`, naming the file, the document to preview, the way to open and where to go back to. */
export function changeFileAddress(flowId: string, o: { output?: string; document?: string; way?: FileWay; from?: string } = {}): string {
  const q = `${new URLSearchParams((["output", "document", "way", "from"] as const).flatMap((k) => (o[k] ? [[k, o[k]!]] : [])))}`;
  return `/flows/${encodeURIComponent(flowId)}/change-file${q && `?${q}`}`;
}

/** The change-file address; `from` only when it stays in the app (a path, never `//host` or `/\host`). */
export function readChangeFile(params: Pick<URLSearchParams, "get">) {
  const way = params.get("way");
  const from = params.get("from");
  return {
    output: params.get("output"), document: params.get("document"),
    way: way && WAYS.includes(way) ? (way as FileWay) : null,
    from: from?.startsWith("/") && from[1] !== "/" && from[1] !== "\\" ? from : null,
  };
}
