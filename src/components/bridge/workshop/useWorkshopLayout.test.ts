import { describe, test, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { computeGrid, useWorkshopLayout, type WorkshopFocus } from "./useWorkshopLayout";

// ── computeGrid — the pure derivation (focus overrides, else per-zone collapse) ──

describe("computeGrid", () => {
  test("mapping focus collapses both sides", () => {
    expect(computeGrid({ focus: "mapping", leftCollapsed: false, rightCollapsed: false })).toEqual({
      left: "rail",
      center: "1fr",
      right: "rail",
    });
  });

  test("output focus gives output the width", () => {
    expect(computeGrid({ focus: "output", leftCollapsed: false, rightCollapsed: false })).toEqual({
      left: "rail",
      center: "rail",
      right: "1fr",
    });
  });

  test("all = three zones, honoring manual collapses", () => {
    expect(computeGrid({ focus: "all", leftCollapsed: true, rightCollapsed: false })).toEqual({
      left: "rail",
      center: "1fr",
      right: "auto",
    });
  });

  test("all with nothing collapsed = three open zones", () => {
    expect(computeGrid({ focus: "all", leftCollapsed: false, rightCollapsed: false })).toEqual({
      left: "auto",
      center: "1fr",
      right: "auto",
    });
  });

  test("focus overrides manual collapses (mapping focus ignores leftCollapsed:false)", () => {
    expect(computeGrid({ focus: "mapping", leftCollapsed: false, rightCollapsed: true })).toEqual({
      left: "rail",
      center: "1fr",
      right: "rail",
    });
  });
});

// ── useWorkshopLayout — state + sessionStorage persistence ──

describe("useWorkshopLayout", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  test("defaults to focus=all, nothing collapsed, and derives a three-zone grid", () => {
    const { result } = renderHook(() => useWorkshopLayout());
    expect(result.current.focus).toBe("all");
    expect(result.current.leftCollapsed).toBe(false);
    expect(result.current.rightCollapsed).toBe(false);
    expect(result.current.grid).toEqual({ left: "auto", center: "1fr", right: "auto" });
  });

  test("setFocus switches the derived grid", () => {
    const { result } = renderHook(() => useWorkshopLayout());
    act(() => result.current.setFocus("mapping"));
    expect(result.current.focus).toBe("mapping");
    expect(result.current.grid).toEqual({ left: "rail", center: "1fr", right: "rail" });
  });

  test("toggleLeft / toggleRight flip the per-zone collapse flags", () => {
    const { result } = renderHook(() => useWorkshopLayout());
    act(() => result.current.toggleLeft());
    expect(result.current.leftCollapsed).toBe(true);
    act(() => result.current.toggleRight());
    expect(result.current.rightCollapsed).toBe(true);
    expect(result.current.grid).toEqual({ left: "rail", center: "1fr", right: "rail" });
  });

  test("persists layout to sessionStorage and rehydrates it on remount", () => {
    const { result, unmount } = renderHook(() => useWorkshopLayout());
    act(() => {
      result.current.setFocus("output");
      result.current.toggleLeft();
    });
    unmount();

    const { result: result2 } = renderHook(() => useWorkshopLayout());
    expect(result2.current.focus).toBe("output");
    expect(result2.current.leftCollapsed).toBe(true);
    // sanity: the persisted value is the layout key, not a persona flag
    expect(sessionStorage.getItem("plk-workshop-layout")).toContain("output");
  });

  test("a corrupt persisted value falls back to defaults without throwing", () => {
    sessionStorage.setItem("plk-workshop-layout", "{not json");
    const { result } = renderHook(() => useWorkshopLayout());
    expect(result.current.focus).toBe("all");
    expect(result.current.leftCollapsed).toBe(false);
  });

  test("exposes the WorkshopFocus union values", () => {
    const focuses: WorkshopFocus[] = ["all", "mapping", "output"];
    expect(focuses).toHaveLength(3);
  });
});
