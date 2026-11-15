import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { ApiHttpError } from "@/lib/api/core";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { eachDocument, fetchOriginal, MissingOriginal, saveOriginals } from "./eachDocument";

const api = vi.hoisted(() => ({ sendDocument: vi.fn(), fetchDocumentSource: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
const save = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock("@/lib/saveBlob", () => save);

const doc = (n: number) => ({ id: `doc-${n}`, fileName: `invoice-${n}.pdf` });
const refuse = (status: number, body: unknown) => new ApiHttpError("refused", status, body);
/** Runs `answers` in order through eachDocument; each answer is a value to resolve or an error to reject. */
const run = (answers: unknown[]) => {
  const fn = vi.fn(async (d: { id: string }) => {
    const a = answers[Number(d.id.slice(4)) - 1];
    if (a instanceof Error) throw a;
    return a;
  });
  const onDone = vi.fn();
  return { fn, onDone, result: eachDocument(answers.map((_, i) => doc(i + 1)), fn, onDone) };
};

// jsdom's Blob has no arrayBuffer(); a browser's does.
vi.stubGlobal("Blob", NodeBlob);
beforeEach(() => vi.clearAllMocks());

describe("eachDocument", () => {
  it("goes on past a refusal about one document and stops at one about the workspace or the connection", async () => {
    const one = run(["ok", refuse(409, { error: "not_ready" }), refuse(422, { error: "output_invalid" }), "ok", "ok"]);
    const r1 = await one.result;
    expect(r1.done.map((x) => x.item.id)).toEqual(["doc-1", "doc-4", "doc-5"]);
    expect(r1.refused.map((x) => x.item.id)).toEqual(["doc-2", "doc-3"]);
    expect(r1.stopped).toBeUndefined();
    expect(one.onDone.mock.calls.map(([d]) => d.id)).toEqual(["doc-1", "doc-4", "doc-5"]);

    const paused = run(["ok", refuse(409, { error: "processing_paused" }), "ok"]);
    const r2 = await paused.result;
    expect(r2.done).toHaveLength(1);
    expect(r2.stopped?.left).toBe(2);
    expect(paused.fn).toHaveBeenCalledTimes(2);

    const offline = run(["ok", new TypeError("Failed to fetch"), "ok", "ok"]);
    expect((await offline.result).stopped?.left).toBe(3);

    for (const e of [
      refuse(429, "Rate limit exceeded. Please slow down and retry shortly."),
      refuse(429, { error: "order_limit_reached" }),
      refuse(403, { error: "bulk_send_requires_operations" }),
      refuse(503, null),
    ]) {
      const r = await run(["ok", e, "ok"]).result;
      expect(r.stopped?.error).toBe(e);
      expect(r.done).toHaveLength(1);
    }

    const gone = await run([refuse(404, { error: "document_not_found" }), "ok"]).result;
    expect(gone.refused).toHaveLength(1);
    expect(gone.done).toHaveLength(1);
    expect(gone.stopped).toBeUndefined();
  });

  it("saves one original under its own name and several in documents.zip, and says when an original is missing", async () => {
    api.fetchDocumentSource.mockResolvedValueOnce(undefined);
    const missing = await fetchOriginal(doc(1)).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(MissingOriginal);
    expect(documentRefusalMessage(missing)).toBe("The original isn't available right now.");

    await saveOriginals([{ name: "invoice-1001.csv", blob: new Blob(["a,b"]) }]);
    expect(save.saveBlob).toHaveBeenCalledTimes(1);
    expect(save.saveBlob.mock.calls[0][1]).toBe("invoice-1001.csv");

    save.saveBlob.mockClear();
    await saveOriginals([{ name: "invoice.pdf", blob: new Blob(["one"]) }, { name: "invoice.pdf", blob: new Blob(["two"]) }]);
    expect(save.saveBlob).toHaveBeenCalledTimes(1);
    const [zip, name] = save.saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe("documents.zip");
    expect(Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer())))).toEqual(["invoice.pdf", "invoice (2).pdf"]);
  });
});
