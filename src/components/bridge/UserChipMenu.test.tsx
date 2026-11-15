import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/ui/confirm";
import { UserChipMenu } from "./UserChipMenu";

const signOut = vi.fn(async () => {});
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { id: "user_alex", fullName: "Alex Example", primaryEmailAddress: { emailAddress: "alex@example.test" } } }),
  useOrganization: () => ({ membership: null }),
  useClerk: () => ({ signOut, openUserProfile: vi.fn() }),
}));

const { heldCount, clearHeldUploads } = vi.hoisted(() => ({
  heldCount: vi.fn<(userId: string) => Promise<number>>(),
  clearHeldUploads: vi.fn(async () => {}),
}));
vi.mock("@/lib/pwa/heldUploads", () => ({ heldCount, clearHeldUploads }));

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x"));
afterEach(() => vi.unstubAllEnvs());

function pressSignOut() {
  fireEvent.click(screen.getByRole("button", { name: /Open account menu/ }));
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Sign out" }));
}

it("asks before signing out with held files, then removes them; with none it signs out at once", async () => {
  heldCount.mockResolvedValue(2);
  render(<ConfirmProvider><UserChipMenu collapsed placement="down" /></ConfirmProvider>);
  pressSignOut();
  let dialog = await screen.findByRole("alertdialog");
  expect(heldCount).toHaveBeenCalledWith("user_alex");                // only this person's files are counted
  expect(within(dialog).getByText("Sign out?")).toBeInTheDocument();
  expect(within(dialog).getByText("2 files you added while offline haven't gone up yet. Signing out removes them from this device.")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(signOut).not.toHaveBeenCalled();
  expect(clearHeldUploads).not.toHaveBeenCalled();

  pressSignOut();
  dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/" }));
  expect(clearHeldUploads.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

  heldCount.mockResolvedValue(0);
  signOut.mockClear();
  pressSignOut();
  await waitFor(() => expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
