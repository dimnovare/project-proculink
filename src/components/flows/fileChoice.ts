import { getFlow, publishFlow, updateOutput } from "@/lib/api/documents";
import type { FileChoice, Flow, FlowOutput } from "@/lib/api/documents";
import { refusalToken } from "@/lib/documentRefusals";
import { fromSimple, toSimple } from "@/lib/flowOutputModel";
import { outputTypeLabel } from "./OutputEditor";

/** The one-tap types on the Change the file screen, in the board's order. */
export const COMMON_TYPES = ["csv", "xlsx", "xml", "json", "pdf", "txt"] as const;

/** The same file in another type: its columns kept when they are plain, else every value we read (the server's default). */
export function typeChoice(output: FlowOutput, format: string): FileChoice {
  const simple = output.standard ? null : toSimple(output.template);
  return { format, standard: null, tableKey: output.tableKey, template: simple ? fromSimple(simple, format) : null };
}

/** A standard instead; the output's saved sender and receiver ids go along, so its preview shows them. */
export const standardChoice = (id: string, output: FlowOutput, flow: Flow): FileChoice => ({
  format: "", standard: id, tableKey: output.tableKey ?? flow.fields.tables[0]?.key ?? null,
  template: output.template?.envelope ? output.template : null,
});

export const choiceType = (c: FileChoice) => outputTypeLabel(c);

/** "a CSV file", "an Excel file", "a text file": mid-sentence an ordinary word is lower-case, a name or an acronym is not. */
export function aFileOf(o: { format: string; standard?: string | null }): string {
  const type = outputTypeLabel(o);
  const said = !o.standard && (o.format === "txt" || o.format === "fixed") ? type.toLowerCase() : type;
  return `${/^[AEIOX]/.test(said) ? "an" : "a"} ${said} file`;
}

/** A name that ends with the old type gets the new one ("Invoices CSV" → "Invoices XML"); a name the person typed is kept. */
export function renamed(name: string, from: string, to: string): string {
  if (!name.endsWith(` ${from}`)) return name;
  return `${name.slice(0, name.length - from.length - 1).slice(0, 120 - to.length - 1).trimEnd()} ${to}`;
}

/**
 * The same output becomes the choice, its destination and send-when rule kept. A flow in use with nothing else
 * waiting is published at once; with other changes waiting it is not (that would put unfinished edits in use).
 */
export async function replaceOutput(flowId: string, output: FlowOutput, choice: FileChoice): Promise<{ output: FlowOutput; inUse: boolean }> {
  const flow = await getFlow(flowId);
  const saved = await updateOutput(flowId, output.id, {
    ...choice, replace: true, name: renamed(output.name, outputTypeLabel(output), outputTypeLabel(choice)),
    destinationId: output.destinationId, sendWhen: output.sendWhen,
    layout: !choice.standard && (choice.format === "pdf" || choice.format === "txt") ? output.layout ?? null : null,
  });
  const live = typeof flow.publishedVersion === "number";
  if (live && !flow.hasChanges)
    await publishFlow(flowId).catch((e: unknown) => { if (refusalToken(e) !== "nothing_to_publish") throw e; });
  return { output: saved, inUse: !live || !flow.hasChanges };
}
