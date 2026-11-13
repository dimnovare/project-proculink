import { describe, it, expect } from "vitest";
import { engineRouteMove } from "./engineRouteMoves";

describe("engineRouteMove", () => {
  it.each([
    ["/bridge", "/documents"],
    ["/inbox", "/archive"],
    ["/inbox/ord-9", "/archive/ord-9"],
    ["/documents", null],
    ["/library/mappings", "/lookups"],
    ["/library/suppliers", "/flows"],
    ["/library/suppliers/s1", "/flows"],
    ["/library/buyers", "/flows"],
    ["/library/standards", "/flows"],
    ["/connections", "/flows"],
    ["/connections/c1", "/flows"],
    ["/operations/exceptions", null],
    ["/operations/health", null],
    ["/upload", null],
    ["/flows/f1", null],
    ["/operations/log", null],
  ])("%s -> %s", (from, to) => expect(engineRouteMove(from)).toBe(to));
});
