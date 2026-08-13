import { describe, test, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { computeGrid, useWorkshopLayout, type WorkshopFocus } from "./useWorkshopLayout";

// ── computeGrid — the pure derivation (focus overrides, else per-zone collapse) ──

describe("computeGrid", () => {
  test("mapping focus shows received + outgoing, rails only the preview", () => {
    expect(computeGrid({ focus: "mapping", leftCollapsed: false, rightCollapsed: false })).toEqual({
      left: "auto",
      center: "1fr",
      right: "rail",
    });
  });

  test("output focus shows outgoing + preview, rails only the received", () => {
    expect(computeGrid({ focus: "output", leftCollapsed: false, rightCollapsed: false })).toEqual({
      left: "rail",
      center: "1fr",
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

  test("focus overrides manual collapses (mapping focus forces received visible despite leftCollapsed:true)", () => {
    expect(computeGrid({ focus: "mapping", leftCollapsed: true, rightCollapsed: false })).toEqual({
      left: "auto",
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
    expect(result.current.grid).toEqual({ left: "auto", center: "1fr", right: "rail" });
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

// ── The received column's body: document vs the field list ──
//
// The document is the default because it is the ground truth the field list was derived from.
// The one thing that must override it is Mapping focus: those field rows are the drag-source
// for the connector wires, so being asked to map from a column showing a PDF is being asked to
// drag from nothing.
describe("useWorkshopLayout — incoming view", () => {
  // The hook rehydrates from sessionStorage, so a leaked key from the previous test would make
  // "defaults to the document" pass for the wrong reason.
  beforeEach(() => {
    sessionStorage.clear();
  });

  test("defaults to the document", () => {
    const { result } = renderHook(() => useWorkshopLayout());
    expect(result.current.incomingView).toBe("document");
  });

  test("the operator can switch to the field list and back", () => {
    const { result } = renderHook(() => useWorkshopLayout());
    act(() => result.current.setIncomingView("fields"));
    expect(result.current.incomingView).toBe("fields");
    act(() => result.current.setIncomingView("document"));
    expect(result.current.incomingView).toBe("document");
  });

  test("selecting Mapping focus forces the field list — it is the wiring drag-source", () => {
    const { result } = renderHook(() => useWorkshopLayout());
    expect(result.current.incomingView).toBe("document");
    act(() => result.current.setFocus("mapping"));
    expect(result.current.incomingView).toBe("fields");
    // And the left zone really is the one being mapped from.
    expect(result.current.grid.left).toBe("auto");
  });

  test("the other focuses leave the choice alone", () => {
    const { result } = renderHook(() => useWorkshopLayout());
    act(() => result.current.setFocus("all"));
    expect(result.current.incomingView).toBe("document");
    act(() => result.current.setFocus("output"));
    expect(result.current.incomingView).toBe("document");

    act(() => result.current.setIncomingView("fields"));
    act(() => result.current.setFocus("all"));
    expect(result.current.incomingView).toBe("fields");
  });

  test("persists across a remount, like the rest of the layout", () => {
    const { result, unmount } = renderHook(() => useWorkshopLayout());
    act(() => result.current.setIncomingView("fields"));
    unmount();
    const { result: again } = renderHook(() => useWorkshopLayout());
    expect(again.current.incomingView).toBe("fields");
  });

  test("a corrupt persisted view falls back to the default rather than an empty pane", () => {
    sessionStorage.setItem(
      "plk-workshop-layout",
      JSON.stringify({ focus: "all", leftCollapsed: false, rightCollapsed: false, incomingView: "sideways" }),
    );
    const { result } = renderHook(() => useWorkshopLayout());
    expect(result.current.incomingView).toBe("document");
  });

  test("a layout persisted before this field existed still rehydrates", () => {
    sessionStorage.setItem(
      "plk-workshop-layout",
      JSON.stringify({ focus: "output", leftCollapsed: true, rightCollapsed: false }),
    );
    const { result } = renderHook(() => useWorkshopLayout());
    expect(result.current.focus).toBe("output");
    expect(result.current.incomingView).toBe("document");
  });
});
