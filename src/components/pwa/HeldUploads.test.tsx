import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { UploadItem } from "@/components/flows/UploadQueue";
import { HeldRefusal } from "@/lib/pwa/heldUploads";
import { HeldUploads } from "./HeldUploads";

const nav = vi.hoisted(() => ({ path: "/documents" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

const { remove, retry } = vi.hoisted(() => ({ remove: vi.fn(), retry: vi.fn() }));
const item = (key: string, name: string, over: Partial<UploadItem>): UploadItem => ({
  key, file: new File(["x"], name), flowId: "f1", flowName: "Delivery notes", state: "held", ...over,
});
const items: UploadItem[] = [
  item("k-held", "delivery-note-78.jpg", { state: "held", wasHeld: true }),
  item("k-limit", "eleventh.pdf", { state: "refused", wasHeld: true, error: new HeldRefusal("held_limit") }),
  item("k-done", "done.pdf", { state: "done", wasHeld: true }),
  item("k-plain", "plain.pdf", { state: "waiting" }),
];
vi.mock("@/components/flows/UploadQueue", async (actual) => ({
  ...(await actual<typeof import("@/components/flows/UploadQueue")>()),
  useUploadQueue: () => ({ items, add: vi.fn(), retry, remove }),
}));

it("lists files waiting for the connection on any app screen except Upload, with a way to remove each", () => {
  const first = render(<HeldUploads />);
  const strip = within(screen.getByTestId("held-uploads"));
  expect(strip.getAllByRole("button", { name: /^Remove / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Remove delivery-note-78.jpg", "Remove eleventh.pdf"]);
  expect(strip.getByText("Waiting for connection")).toBeInTheDocument();
  expect(strip.getByText("It uploads when you're back online.")).toBeInTheDocument();
  expect(strip.getByText("This device can keep up to 10 files, 50 MB in all, until you're back online. Add this one again once those have gone up.")).toBeInTheDocument();
  expect(strip.queryByText("done.pdf")).toBeNull();
  expect(strip.queryByText("plain.pdf")).toBeNull();
  fireEvent.click(strip.getByRole("button", { name: "Remove delivery-note-78.jpg" }));
  expect(remove).toHaveBeenCalledWith("k-held");
  first.unmount();
  nav.path = "/upload";
  render(<HeldUploads />);
  expect(screen.queryByTestId("held-uploads")).toBeNull();
});
