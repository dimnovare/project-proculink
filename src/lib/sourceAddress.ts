export type SourceAddress = { kind: "line" | "para"; n: number } | { kind: "cell"; row: number; col: number };

/** Reads the backend's `line:N`, `para:N` and `cell:rRcC` addresses; anything else is null. */
export function parseAddress(a: string | null | undefined): SourceAddress | null {
  const pl = /^(para|line):(\d+)$/.exec(a ?? "");
  if (pl) return { kind: pl[1] as "para" | "line", n: Number(pl[2]) };
  const m = /^cell:r(\d+)c(\d+)$/.exec(a ?? "");
  return m ? { kind: "cell", row: Number(m[1]), col: Number(m[2]) } : null;
}

/** 0 → A, 25 → Z, 26 → AA. */
export function spreadsheetColumnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
