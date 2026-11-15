/**
 * Reads a design token's value straight out of `globals.css`, for renderers
 * that cannot resolve `var()` (the share image is drawn by Satori).
 */

/** The value of `--{name}` as `globals.css` defines it. Throws naming the token when it is not defined. */
export function cssToken(css: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `\s*:` right after the name: "--brand-blue" never matches "--brand-blue-bright".
  const match = new RegExp(`--${escaped}\\s*:\\s*([^;]+);`).exec(css);
  if (!match) throw new Error(`CSS token --${name} is not defined`);
  return match[1].trim();
}
