// THE KEYBOARD CONNECT PATH WAS SILENT BETWEEN "CONNECT MODE" AND "MAPPED X TO Y".
//
// Arrow keys cycle `kbTarget`, and the only thing that DREW the new selection was a dashed
// bezier inside an `<svg aria-hidden>`. The live region spoke exactly twice — on mode entry and
// on commit — so a screen-reader operator heard "Connect mode. Arrow keys choose the output
// field…", then nothing at all through every press, then "Mapped PoNumber to Currency" for a
// field they were never told they had moved onto. The keyboard path was navigable and blind.
//
// The hook is driven directly: the announcer element lives inside the returned `svg` fragment,
// so rendering that fragment plus one port handle is the whole surface under test.

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { useMapperWireLayer } from "./MapperWireLayer";
import type { TargetField } from "./types";

afterEach(cleanup);

const TARGETS: TargetField[] = [
  { outputPath: "PoNumber", label: "PO number", scope: "header" },
  { outputPath: "Currency", label: "Currency", scope: "header" },
  { outputPath: "Quantity", label: "Quantity", scope: "line" },
];

const onConnect = vi.fn();

function Harness() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const sourceEls = useRef<Record<string, HTMLElement | null>>({});
  const targetEls = useRef<Record<string, HTMLElement | null>>({});
  const wire = useMapperWireLayer({
    canvasRef,
    sourceEls,
    targetEls,
    sourceIds: ["poNumberRaw"],
    targetFields: TARGETS,
    outputConnections: {},
    knownSourceIds: new Set(["poNumberRaw"]),
    onConnect,
    onDisconnect: vi.fn(),
    signature: "sig",
  });
  return (
    <div ref={canvasRef}>
      <span data-testid="handle" {...wire.sourcePortProps("poNumberRaw")} />
      {wire.svg}
    </div>
  );
}

/** The polite live region the hook renders beside the (aria-hidden) SVG. */
function liveRegion(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[aria-live="polite"]');
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

function enterConnectMode(handle: HTMLElement) {
  fireEvent.keyDown(handle, { key: "Enter" });
}

describe("MapperWireLayer — arrow-key target cycling is spoken", () => {
  it("names the output the arrow key moved onto", async () => {
    const { container, getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");
    const region = liveRegion(container);

    enterConnectMode(handle);
    await waitFor(() => expect(region.textContent).toContain("Connect mode"));

    fireEvent.keyDown(handle, { key: "ArrowDown" });

    // Index 1 of 3 — the announcement the operator had no way to get before.
    await waitFor(() => expect(region.textContent).toContain("Currency"));
    expect(region.textContent).toContain("output 2 of 3");
  });

  it("names it again on every subsequent move, not only the first", async () => {
    const { container, getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");
    const region = liveRegion(container);

    enterConnectMode(handle);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    await waitFor(() => expect(region.textContent).toContain("Currency"));

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    await waitFor(() => expect(region.textContent).toContain("Quantity"));
    expect(region.textContent).toContain("output 3 of 3");
  });

  it("wraps backwards and says where it landed", async () => {
    const { container, getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");
    const region = liveRegion(container);

    enterConnectMode(handle);
    fireEvent.keyDown(handle, { key: "ArrowUp" });

    await waitFor(() => expect(region.textContent).toContain("Quantity"));
    expect(region.textContent).toContain("output 3 of 3");
  });

  it("names the first target on entering connect mode, in ONE announcement", async () => {
    // `announce` blanks the region and rewrites it on the next frame, so two calls in a single
    // keypress would leave only the second — the mode-entry sentence would be lost. One message.
    const { container, getByTestId } = render(<Harness />);
    const region = liveRegion(container);

    enterConnectMode(getByTestId("handle"));

    await waitFor(() => expect(region.textContent).toContain("PoNumber"));
    expect(region.textContent).toContain("Connect mode");
    expect(region.textContent).toContain("output 1 of 3");
  });
});

describe("MapperWireLayer — anti-vacuity", () => {
  it("says nothing about a target before connect mode is entered", async () => {
    // A region that always contained every output name would pass every assertion above.
    const { container, getByTestId } = render(<Harness />);
    const region = liveRegion(container);

    fireEvent.keyDown(getByTestId("handle"), { key: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 20));

    expect(region.textContent).toBe("");
  });

  it("still commits the mapping the arrow keys selected", async () => {
    // The announcement must not have replaced the behaviour it describes.
    onConnect.mockClear();
    const { getByTestId } = render(<Harness />);
    const handle = getByTestId("handle");

    enterConnectMode(handle);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "Enter" });

    expect(onConnect).toHaveBeenCalledWith("poNumberRaw", "Currency");
  });
});
