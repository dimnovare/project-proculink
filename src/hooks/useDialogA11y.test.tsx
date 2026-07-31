// The dialog behaviour contract, proven once.
//
// Every modal dialog in the app routes through useDialogA11y (enforced by
// src/test/dialog-a11y.test.tsx), so this file is where the BEHAVIOUR is pinned:
// focus-in, Tab cycle, Shift+Tab cycle, Escape, focus-restore, and the two things
// a blanket "trap everything" sweep gets wrong — non-modal layers and stacking.
//
// jsdom caveat that shapes these tests: jsdom has NO layout, so `offsetParent` is
// always null and `getBoundingClientRect()` always returns zeros. The first is why
// `focusablesWithin` cannot use the `offsetParent !== null` test all six original
// traps used (it filtered out every element and the trap degraded to a no-op — the
// exact vacuity this file exists to prevent). The second is why tap targets are
// measured in Playwright and not here.
//
// RTL's fireEvent.click does not move focus the way a real click does, so triggers
// are focused explicitly before being clicked — otherwise "restore focus to the
// trigger" would assert against document.body and pass for the wrong reason.
//
// The second caveat: jsdom does NOT move focus on a Tab keypress. Only the trap's
// own `preventDefault()` + `.focus()` moves it. That is precisely what is under
// test — at the ring boundaries the trap must act, and in the middle it must not.

import { useRef, useState } from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useDialogA11y, focusablesWithin, __openLayerCount } from "./useDialogA11y";

/** A minimal dialog with three tab stops, plus a trigger outside it. */
function Harness({
  onClose,
  modal = true,
  autoFocus = true,
  restoreFocus = true,
  closeOnEscape = true,
  startOpen = false,
}: {
  onClose?: () => void;
  modal?: boolean;
  autoFocus?: boolean;
  restoreFocus?: boolean;
  closeOnEscape?: boolean;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  useDialogA11y({ open, onClose: close, panelRef, modal, autoFocus, restoreFocus, closeOnEscape });
  return (
    <div>
      <button onClick={() => setOpen(true)}>open dialog</button>
      <button>outside after</button>
      {open && (
        <div ref={panelRef} role="dialog" aria-modal={modal ? "true" : undefined} aria-label="Test dialog" tabIndex={-1}>
          <button>first</button>
          <input aria-label="middle" />
          <button>last</button>
        </div>
      )}
    </div>
  );
}

const rafFlush = async () => {
  // useDialogA11y focuses inside a requestAnimationFrame.
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
};

describe("focusablesWithin", () => {
  it("returns focusable descendants in DOM order and skips disabled ones", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<a href="/x">a</a><button>b</button><button disabled>c</button>' +
      '<input /><span tabindex="-1">d</span><span tabindex="0">e</span>';
    document.body.appendChild(root);
    const tags = focusablesWithin(root).map((el) => el.tagName.toLowerCase());
    expect(tags).toEqual(["a", "button", "input", "span"]);
    root.remove();
  });

  it("returns [] for a null root rather than throwing", () => {
    expect(focusablesWithin(null)).toEqual([]);
  });
});

describe("useDialogA11y — the modal contract", () => {
  it("moves focus INTO the dialog on open", async () => {
    render(<Harness />);
    screen.getByText("open dialog").focus();
    fireEvent.click(screen.getByText("open dialog"));
    await rafFlush();
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("Tab from the LAST tab stop cycles back to the first", async () => {
    render(<Harness />);
    screen.getByText("open dialog").focus();
    fireEvent.click(screen.getByText("open dialog"));
    await rafFlush();

    screen.getByText("last").focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("Shift+Tab from the FIRST tab stop cycles back to the last", async () => {
    render(<Harness />);
    screen.getByText("open dialog").focus();
    fireEvent.click(screen.getByText("open dialog"));
    await rafFlush();

    screen.getByText("first").focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("pulls focus back in when it has escaped to the page behind", async () => {
    render(<Harness />);
    screen.getByText("open dialog").focus();
    fireEvent.click(screen.getByText("open dialog"));
    await rafFlush();

    // Simulate focus having landed outside the dialog (a click on the page, an
    // async widget stealing it). The next Tab must return it to the dialog.
    screen.getByText("outside after").focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("does NOT intercept Tab in the middle of the ring", async () => {
    render(<Harness />);
    screen.getByText("open dialog").focus();
    fireEvent.click(screen.getByText("open dialog"));
    await rafFlush();

    // The middle input is neither first nor last, so the trap must leave the
    // browser's own sequential navigation alone. jsdom does not move focus on
    // Tab, so "untouched" is observable as "focus did not jump to an edge".
    screen.getByLabelText("middle").focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("middle"));
  });

  it("Escape closes", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    screen.getByText("open dialog").focus();
    fireEvent.click(screen.getByText("open dialog"));
    await rafFlush();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape does nothing when closeOnEscape is false", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} closeOnEscape={false} />);
    screen.getByText("open dialog").focus();
    fireEvent.click(screen.getByText("open dialog"));
    await rafFlush();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("restores focus to the trigger on close", async () => {
    render(<Harness />);
    const trigger = screen.getByText("open dialog");
    trigger.focus();
    fireEvent.click(trigger);
    await rafFlush();
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it("locks and restores body scroll", async () => {
    document.body.style.overflow = "visible";
    render(<Harness />);
    screen.getByText("open dialog").focus();
    fireEvent.click(screen.getByText("open dialog"));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(document.body.style.overflow).toBe("visible");
  });
});

describe("useDialogA11y — non-modal layers must NOT be trapped", () => {
  it("does not trap Tab when modal is false", async () => {
    render(<Harness modal={false} />);
    screen.getByText("open dialog").focus();
    fireEvent.click(screen.getByText("open dialog"));
    await rafFlush();

    // At the last tab stop a MODAL layer would jump focus back to "first".
    // A popover must let focus continue out to the page behind it.
    screen.getByText("last").focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("still closes on Escape and still restores focus when modal is false", async () => {
    const trigger = "open dialog";
    render(<Harness modal={false} />);
    screen.getByText(trigger).focus();
    fireEvent.click(screen.getByText(trigger));
    await rafFlush();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByText(trigger));
  });

  it("does not lock body scroll when modal is false", async () => {
    document.body.style.overflow = "visible";
    render(<Harness modal={false} />);
    screen.getByText("open dialog").focus();
    fireEvent.click(screen.getByText("open dialog"));
    expect(document.body.style.overflow).toBe("visible");
  });
});

describe("useDialogA11y — stacking", () => {
  function Stacked({ onOuter, onInner }: { onOuter: () => void; onInner: () => void }) {
    const outerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const [innerOpen, setInnerOpen] = useState(false);
    useDialogA11y({ open: true, onClose: onOuter, panelRef: outerRef });
    useDialogA11y({ open: innerOpen, onClose: onInner, panelRef: innerRef });
    return (
      <div ref={outerRef} role="dialog" aria-modal="true" aria-label="outer">
        <button onClick={() => setInnerOpen(true)}>open inner</button>
        {innerOpen && (
          <div ref={innerRef} role="dialog" aria-modal="true" aria-label="inner">
            <button>inner button</button>
          </div>
        )}
      </div>
    );
  }

  it("only the TOP-MOST dialog answers Escape", async () => {
    const onOuter = vi.fn();
    const onInner = vi.fn();
    render(<Stacked onOuter={onOuter} onInner={onInner} />);
    await rafFlush();

    fireEvent.click(screen.getByText("open inner"));
    await rafFlush();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    // Without the layer stack BOTH handlers fire and one Escape closes the whole
    // stack — the OutputMappingEditor / OutputStructureDesigner case.
    expect(onInner).toHaveBeenCalledTimes(1);
    expect(onOuter).not.toHaveBeenCalled();
  });

  it("unwinds the layer stack when dialogs unmount", async () => {
    const before = __openLayerCount();
    const { unmount } = render(<Harness startOpen />);
    await rafFlush();
    expect(__openLayerCount()).toBe(before + 1);
    unmount();
    expect(__openLayerCount()).toBe(before);
  });
});

describe("useDialogA11y — foreign layers", () => {
  it("ignores Escape raised inside another dialog element", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} startOpen />);
    await rafFlush();

    // A Radix <AlertDialog> portals its content to <body>, so it is never inside
    // our panel and the layer stack does not know about it. Focus lives inside
    // it; our handler must stand down rather than close two things at once.
    const foreign = document.createElement("div");
    foreign.setAttribute("role", "alertdialog");
    foreign.innerHTML = "<button>confirm discard</button>";
    document.body.appendChild(foreign);
    (foreign.firstElementChild as HTMLElement).focus();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    foreign.remove();
  });
});
