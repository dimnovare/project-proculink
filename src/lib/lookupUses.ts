/** "Used by A." / "Used by A and B." / "Used by A, B and C." / [] → "Not used yet." / undefined → null. */
export function usedByLine(names: string[] | undefined): string | null {
  if (!names) return null;
  if (!names.length) return "Not used yet.";
  const last = names[names.length - 1];
  return `Used by ${names.length === 1 ? last : `${names.slice(0, -1).join(", ")} and ${last}`}.`;
}
