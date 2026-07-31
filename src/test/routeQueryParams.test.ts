import { describe, test, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";
import {
  ROUTE_QUERY_PARAMS,
  allParamContracts,
  paramIsReadBy,
  queryKeysOf,
  routePatternFor,
  unconsumedParams,
} from "./routeQueryParams";
import { ROOT, listAppRoutes, matchesAny } from "./appRoutes";

// ─────────────────────────────────────────────────────────────────────────────
// WP-19 + WP-24. The registry is only worth having if it cannot rot, so this
// file attacks it three ways: the declarations are checked against real source,
// the matcher is checked for ambiguity, and the checker itself is checked for
// vacuity against a link that IS broken.
//
// The bug this exists to stop shipped twice. `problemCopy.ts` sent a refused
// order's primary CTA to `/inbox/{id}?details=response`; nothing in the app has
// ever read `details`. Every gate passed it, because every gate strips the query
// before matching — and `problemContract.test.ts` cited that same href as its
// example of a healthy destination.
// ─────────────────────────────────────────────────────────────────────────────

describe("the registry describes code that exists", () => {
  test.each(allParamContracts().map((c) => [`${c.pattern} ?${c.param}=`, c] as const))(
    "%s is really read by its named file",
    (_label, contract) => {
      expect(
        paramIsReadBy(contract.param, contract.readBy),
        `${contract.pattern} declares it reads "${contract.param}" in ${contract.readBy}, ` +
          `but no live \`.get("${contract.param}")\` is there. Either the reader was removed ` +
          `(every link carrying it is now inert) or the contract names the wrong file.`,
      ).toBe(true);
    },
  );

  test("every registered pattern is a route the app actually serves", () => {
    const routes = listAppRoutes();
    for (const pattern of Object.keys(ROUTE_QUERY_PARAMS)) {
      expect(
        routes.includes(pattern),
        `${pattern} has a query contract but is not in the route tree`,
      ).toBe(true);
    }
  });

  test("no path can match two patterns — first-match-wins must not be a coin flip", () => {
    const patterns = Object.keys(ROUTE_QUERY_PARAMS);
    // Concrete probes: one realistic path per pattern, dynamic segments filled.
    const probes = patterns.map((p) => p.replace(/\[[^\]]+\]/g, "probe-1"));
    for (const probe of probes) {
      const hits = patterns.filter((p) => matchesAny(probe, [p]));
      expect(hits.length, `${probe} matches ${hits.length} patterns: ${hits.join(", ")}`).toBe(1);
    }
  });
});

describe("the checker is not vacuously green", () => {
  test("a href whose parameter IS read reports nothing", () => {
    expect(unconsumedParams("/inbox/ord-1?tab=response")).toEqual([]);
    expect(unconsumedParams("/library/suppliers/sup-1?tab=delivery")).toEqual([]);
    expect(unconsumedParams("/inbox?status=delivery_failed")).toEqual([]);
    expect(unconsumedParams("/upload?supplierId=sup-1")).toEqual([]);
    // These three were inert on origin/main and were fixed by WRITING the reader
    // rather than by dropping the parameter, because the link's promise was worth
    // keeping: "See every attempt" should open one order's attempts, and an
    // escalation should not make the operator retype what we already know.
    expect(unconsumedParams("/operations/log?orderId=ord-1")).toEqual([]);
    expect(unconsumedParams("/support?order=PO%201&problem=failed")).toEqual([]);
  });

  test("the two hrefs fixed by changing the LINK are caught", () => {
    // Both were live on origin/main and scored green on every other gate.
    // `details` was a typo for the parameter the drawer really reads; `from`
    // promised a link between a refused order and its replacement that nothing
    // kept. Neither earned a reader, so both had to change at the link.
    expect(unconsumedParams("/inbox/ord-1?details=response")).toEqual(["details"]);
    expect(unconsumedParams("/upload?supplierId=sup-1&from=ord-1")).toEqual(["from"]);
  });

  test("an undeclared parameter on a REGISTERED route is caught too", () => {
    // The registry is not a per-route amnesty: a route that declares `status`
    // has not thereby declared everything else.
    expect(unconsumedParams("/inbox?status=failed&somethingNew=1")).toEqual(["somethingNew"]);
    expect(unconsumedParams("/settings?tab=billing&highlight=plan")).toEqual(["highlight"]);
  });

  test("a route with no declared contract cannot smuggle a parameter through", () => {
    // Silence is not consent: an unregistered destination reports every key, so
    // a new query-bearing link has to declare its contract to go green.
    expect(routePatternFor("/drafts")).toBeNull();
    expect(unconsumedParams("/drafts?anything=1")).toEqual(["anything"]);
    // …but a link with no query is never in question.
    expect(unconsumedParams("/drafts")).toEqual([]);
  });

  test("keys are read exactly, including repeats and empty values", () => {
    expect(queryKeysOf("/x")).toEqual([]);
    expect(queryKeysOf("/x?a=1&b=2#frag")).toEqual(["a", "b"]);
    expect(queryKeysOf("/x?a")).toEqual(["a"]);
  });
});

describe("a commented-out reader confers nothing", () => {
  // The `4c7350a` defect in this repo was a stripper that treated a comment as
  // code. If `paramIsReadBy` ever stops stripping, this goes red — which is the
  // point, because a contract satisfied by a comment is worse than no contract.
  test("paramIsReadBy ignores a reader inside a comment", () => {
    const dir = mkdtempSync(join(tmpdir(), "plk-wp19-params-"));
    try {
      const file = join(dir, "Fixture.tsx");
      writeFileSync(
        file,
        [
          "export function Fixture() {",
          '  // const dead = searchParams.get("ghost");',
          '  /* const alsoDead = searchParams.get("ghost"); */',
          '  const live = searchParams.get("real");',
          "  return live;",
          "}",
        ].join("\n"),
        "utf8",
      );
      const rel = relative(ROOT, file);
      expect(paramIsReadBy("ghost", rel)).toBe(false);
      expect(paramIsReadBy("real", rel)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a file that does not exist reads nothing", () => {
    expect(paramIsReadBy("tab", "src/components/bridge/NoSuchFile.tsx")).toBe(false);
  });

  // Stripping comments was not enough. With the real reader renamed away, a
  // SENTENCE mentioning the call satisfied the contract — the guard proved only
  // "these characters appear outside a comment". `maskLiterals` (offset-preserving,
  // exported beside the stripper) closes it: the match is found in the raw text so
  // the parameter name is readable, then the CODE part is re-checked at the same
  // offset in the masked copy, where anything inside an outer literal is blank.
  test("a reader quoted inside a string literal confers nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "plk-wp19-literal-"));
    try {
      const file = join(dir, "Fixture.tsx");
      writeFileSync(
        file,
        [
          "export function Fixture() {",
          "  const label = 'we used to call params.get(\"orderId\") here';",
          '  const doc = `see params.get("orderId") in the old build`;',
          '  const live = searchParams.get("realOne");',
          "  return [label, doc, live];",
          "}",
        ].join("\n"),
        "utf8",
      );
      const rel = relative(ROOT, file);
      expect(paramIsReadBy("orderId", rel)).toBe(false);
      expect(paramIsReadBy("realOne", rel)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a .get on something that is not a search-params object confers nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "plk-wp19-receiver-"));
    try {
      const file = join(dir, "Fixture.tsx");
      writeFileSync(
        file,
        [
          "export function Fixture(formData: FormData, headers: Headers) {",
          // None of these reads a URL query, and all three look identical to a
          // bare `.get(` pattern.
          '  const a = formData.get("order");',
          '  const b = headers.get("order");',
          '  const c = new Map<string, string>().get("order");',
          "  return [a, b, c];",
          "}",
        ].join("\n"),
        "utf8",
      );
      const rel = relative(ROOT, file);
      expect(paramIsReadBy("order", rel)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
