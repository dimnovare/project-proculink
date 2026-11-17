import { describe, it, expect, vi } from "vitest";
import { render, within, fireEvent } from "@testing-library/react";
import { ApiHttpError, type AdminOrganisation } from "@/lib/api-client";

// Erasing a workspace is irreversible: the button must stay disarmed until the exact
// slug is typed back, and the server's 409 (a live paid subscription) must say what to
// do about it rather than render as a generic failure.

const eraseOrganisation = vi.fn();
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  eraseOrganisation: (...a: unknown[]) => eraseOrganisation(...a),
}));

import { EraseWorkspacePanel } from "./EraseWorkspacePanel";

const ORG = { id: "org-test-1", name: "Example Trading", slug: "example-trading-7f3a" } as AdminOrganisation;

describe("EraseWorkspacePanel", () => {
  it("arms only on the exact slug, and names the paid-subscription refusal", { timeout: 20_000 }, async () => {
    eraseOrganisation.mockRejectedValue(
      new ApiHttpError("admin/organisations/erase: paid_subscription", 409, { error: "paid_subscription" }),
    );
    const { container } = render(<EraseWorkspacePanel org={ORG} onClose={() => {}} />);
    const panel = within(container);
    const button = panel.getByRole("button", { name: "Erase permanently" });
    const input = panel.getByRole("textbox");

    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: ORG.slug.slice(0, -1) } });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: ORG.slug } });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    expect(
      await panel.findByText("This workspace has paid. Erase it only after the agreement has ended — tick the box above to confirm it has."),
    ).toBeInTheDocument();
    expect(eraseOrganisation).toHaveBeenCalledWith(ORG.id, ORG.slug, false);

    // A failure that is not a refusal may have landed mid-erase: never claim nothing happened.
    eraseOrganisation.mockRejectedValue(new Error("network"));
    fireEvent.click(button);
    expect(await panel.findByText("The erase did not confirm. Run it again — if it already ran, the earlier receipt comes back.")).toBeInTheDocument();
  });

  it("sends the agreement flag and names a running subscription", { timeout: 20_000 }, async () => {
    eraseOrganisation.mockRejectedValue(
      new ApiHttpError("admin/organisations/erase: subscription_running", 409, { error: "subscription_running" }),
    );
    const { container } = render(<EraseWorkspacePanel org={ORG} onClose={() => {}} />);
    const panel = within(container);
    const checkbox = panel.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    // The tick alone never arms the button: only the slug typed back does.
    expect(panel.getByRole("button", { name: "Erase permanently" })).toBeDisabled();
    fireEvent.change(panel.getByRole("textbox"), { target: { value: ORG.slug } });
    fireEvent.click(panel.getByRole("button", { name: "Erase permanently" }));
    expect(
      await panel.findByText("Stripe still shows a running subscription for this workspace — cancel it in Stripe first."),
    ).toBeInTheDocument();
    expect(eraseOrganisation).toHaveBeenCalledWith(ORG.id, ORG.slug, true);
  });
});