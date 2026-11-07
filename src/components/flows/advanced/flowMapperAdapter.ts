import type { MapperAdapter } from "@/components/bridge/mapper/types";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { previewOutput, updateOutput } from "@/lib/api/documents";
import type { Flow, FlowOutput, ReadResult } from "@/lib/api/documents";
import { flowSourceFields, toOverride, toTemplate } from "./flowMapperModel";

/** Wires one flow output to the mapper. Preview exists only when there is a document to preview against. */
export function flowMapperAdapter(args: {
  flow: Flow; output: FlowOutput; documentId: string | null; read: ReadResult | null; onSaved: (o: FlowOutput) => void;
}): MapperAdapter {
  const { flow, output, documentId, read, onSaved } = args;
  const columns = flow.fields.tables.find((t) => t.key === output.tableKey)?.columns.map((c) => c.key) ?? [];
  return {
    scope: output.id,
    load: async () => toOverride(output.template, columns),
    save: async (next) => {
      const saved = await updateOutput(flow.id, output.id, {
        name: output.name, format: output.format, tableKey: output.tableKey, destinationId: output.destinationId,
        sendWhen: output.sendWhen, template: toTemplate(output.template, next),
      });
      onSaved(saved);
      return toOverride(saved.template, columns);
    },
    preview: documentId
      ? async (next) => {
          try {
            const p = await previewOutput(documentId, output.id, toTemplate(output.template, next));
            return { format: output.format, contentType: p.contentType, content: p.content };
          } catch (e) {
            return { format: output.format, content: "", error: documentRefusalMessage(e) };
          }
        }
      : undefined,
    sourceFields: flowSourceFields(flow.fields, output.tableKey, read),
  };
}
