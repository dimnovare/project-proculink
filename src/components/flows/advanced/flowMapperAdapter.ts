import type { MapperAdapter } from "@/components/bridge/mapper/types";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { previewOutput, updateOutput } from "@/lib/api/documents";
import type { Flow, FlowOutput, ReadResult } from "@/lib/api/documents";
import { flowSourceFields, outputTable, toOverride, toTemplate } from "./flowMapperModel";

/** Wires one flow output to the mapper. Preview exists only when there is a document to preview against. */
export function flowMapperAdapter(args: {
  flow: Flow; output: FlowOutput; documentId: string | null; read: ReadResult | null; onSaved: (o: FlowOutput) => void;
}): MapperAdapter {
  const { flow, output, documentId, read, onSaved } = args;
  const columns = outputTable(flow.fields.tables, output.tableKey)?.columns.map((c) => c.key) ?? [];
  // A workbook previews as the CSV text of the same grid, as the backend renders it.
  const format = output.format === "xlsx" ? "csv" : output.format;
  return {
    scope: output.id,
    load: async () => toOverride(output.template, columns),
    save: async (next) => {
      const saved = await updateOutput(flow.id, output.id, {
        name: output.name, format: output.format, tableKey: output.tableKey, destinationId: output.destinationId,
        sendWhen: output.sendWhen, template: toTemplate(output.template, next),
      }).catch((e) => { throw new Error(documentRefusalMessage(e)); });
      onSaved(saved);
      return toOverride(saved.template, columns);
    },
    preview: documentId
      ? async (next) => {
          try {
            const p = await previewOutput(documentId, output.id, { template: toTemplate(output.template, next) });
            return { format, contentType: p.contentType, content: p.content };
          } catch (e) {
            return { format, content: "", error: documentRefusalMessage(e) };
          }
        }
      : undefined,
    sourceFields: flowSourceFields(flow.fields, output.tableKey, read),
  };
}
