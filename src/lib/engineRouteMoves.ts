// Where an engine-on org's old routes go. Pure: takes a pathname only, so a query is never carried over.
// First match wins; EngineRouteRedirect applies it client-side (a per-org flag cannot drive a static 308).
const MOVES: Array<[RegExp, (m: RegExpMatchArray) => string | null]> = [
  [/^\/bridge$/, () => "/documents"],
  [/^\/inbox$/, () => "/archive"],
  [/^\/inbox\/([^/]+)$/, (m) => `/archive/${m[1]}`],
  [/^\/documents$/, () => null],
  [/^\/library\/mappings$/, () => "/lookups"],
  [/^\/library\/(suppliers(\/.*)?|buyers|standards)$/, () => "/flows"],
  [/^\/connections(\/.*)?$/, () => "/flows"],
];

export function engineRouteMove(pathname: string): string | null {
  for (const [re, to] of MOVES) {
    const m = pathname.match(re);
    if (m) return to(m);
  }
  return null;
}
