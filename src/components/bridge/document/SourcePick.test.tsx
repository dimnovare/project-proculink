import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RegionPicker } from "./RegionPicker";
import { SourceDocumentBody } from "./SourceDocumentBody";

afterEach(cleanup);
beforeAll(() => {
  // jsdom has no layout, no pointer capture and no PointerEvent (so no clientX on pointer events).
  window.PointerEvent ??= class extends MouseEvent {} as typeof PointerEvent;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 }) as DOMRect;
});

const at = (x: number, y: number) => ({ clientX: x, clientY: y });
function picker() {
  const onBox = vi.fn();
  render(<RegionPicker page={2} onBox={onBox} />);
  return { onBox, area: screen.getByLabelText("Draw a box on page 2") };
}

describe("pointing at the original", () => {
  it("dragging a box backwards picks the normalised box", () => {
    const { onBox, area } = picker();
    fireEvent.pointerDown(area, at(120, 60));
    fireEvent.pointerUp(area, at(20, 10));
    expect(onBox).toHaveBeenLastCalledWith({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    fireEvent.pointerDown(area, at(20, 10));
    fireEvent.pointerUp(area, at(260, 60));
    expect(onBox).toHaveBeenLastCalledWith({ x: 0.1, y: 0.1, width: 0.9, height: 0.5 });
  });

  it("two clicks make a box and one click alone picks nothing", () => {
    const { onBox, area } = picker();
    fireEvent.pointerDown(area, at(20, 10));
    fireEvent.pointerUp(area, at(20, 10));
    expect(onBox).not.toHaveBeenCalled();
    fireEvent.pointerDown(area, at(120, 60));
    fireEvent.pointerUp(area, at(120, 60));
    expect(onBox).toHaveBeenCalledWith({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
  });

  it("the keyboard moves, resizes and uses a box", () => {
    const { onBox, area } = picker();
    fireEvent.keyDown(area, { key: "Enter" });
    expect(onBox).not.toHaveBeenCalled();
    fireEvent.keyDown(area, { key: "ArrowRight" });
    fireEvent.keyDown(area, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(area, { key: "Enter" });
    expect(onBox).toHaveBeenCalledWith({ x: 0.40625, y: 0.4375, width: 0.25, height: 0.15625 });
  });

  it("picking a cell and selected words", async () => {
    const onPick = vi.fn();
    const show = (name: string, type: string, text: string) => {
      const blob = new Blob([text], { type });
      blob.arrayBuffer = async () => new TextEncoder().encode(text).buffer as ArrayBuffer; // jsdom Blob lacks arrayBuffer
      return (
        <QueryClientProvider client={new QueryClient()}>
          <SourceDocumentBody cacheKey={name} bounded={false} onPick={onPick} document={{ blob, contentType: type, filename: name }} />
        </QueryClientProvider>
      );
    };
    render(show("sheet", "text/csv", "Item,Total\nBolt,5"));
    fireEvent.click(await screen.findByLabelText("Use cell B2"));
    expect(onPick).toHaveBeenCalledWith({ address: "cell:r2c2", value: "5" });
    cleanup();

    render(show("text", "text/plain", "a\nTotal 5\nb"));
    const line = (await screen.findByText("Total 5")).closest("li")!;
    const words = line.querySelector("span:last-child")!.firstChild!;
    const select = (from: Node, to: Node, a: number, b: number) => {
      const range = document.createRange();
      range.setStart(from, a);
      range.setEnd(to, b);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    };
    select(words, words, 6, 7);
    fireEvent.click(screen.getByText("Use selected words"));
    expect(onPick).toHaveBeenLastCalledWith({ address: "line:2", value: "5" });

    onPick.mockClear();
    select(screen.getByText("a").firstChild!, words, 0, 7);
    fireEvent.click(screen.getByText("Use selected words"));
    expect(onPick).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Select words on one line first.")).toBeTruthy());
  });
});
