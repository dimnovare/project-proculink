import { describe, it, expect } from "vitest";
import { render, within, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmProvider, useConfirm } from "./confirm";

function Delete() {
  const confirm = useConfirm();
  return <button type="button" onClick={() => void confirm({ title: "Delete destination", confirmLabel: "Delete", danger: true })}>Delete destination</button>;
}

describe("confirm", () => {
  it("gives focus back to the control that opened it after Escape and after Cancel", async () => {
    const { container } = render(<ConfirmProvider><Delete /></ConfirmProvider>);
    const trigger = within(container).getByRole("button", { name: "Delete destination" });
    for (const close of ["Escape", "Cancel"] as const) {
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = await within(document.body).findByRole("alertdialog");
      if (close === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
      else fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(within(document.body).queryByRole("alertdialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    }
  });
});
