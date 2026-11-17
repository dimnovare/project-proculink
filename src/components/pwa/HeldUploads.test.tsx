import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { INBOX_TARGET, type UploadItem } from "@/components/flows/UploadQueue";
import type { Flow } from "@/lib/api/documents";
import { HeldRefusal } from "@/lib/pwa/heldUploads";
import { HeldUploads, SharedWaiting, sharedLine } from "./HeldUploads";

const nav = vi.hoisted(() => ({ path: "/documents" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

const { remove, retry, addShared, discardShared, queue, returningFlow } = vi.hoisted(() => ({
  remove: vi.fn(), retry: vi.fn(), addShared: vi.fn(), discardShared: vi.fn(),
  queue: { shared: null as readonly { key: string; name: string }[] | null },
  returningFlow: { id: "f1", name: "Supplier invoices", fieldsConfirmed: true, documentCount: 3, scansOn: true, formatsOn: false } as unknown as Flow,
}));
const item = (key: string, name: string, over: Partial<UploadItem>): UploadItem => ({
  key, file: new File(["x"], name), flowId: "f1", state: "held", ...over,
});
const items: UploadItem[] = [
  item("k-held", "delivery-note-78.jpg", { state: "held", wasHeld: true }),
  item("k-limit", "eleventh.pdf", { state: "refused", wasHeld: true, error: new HeldRefusal("held_limit") }),
  item("k-done", "done.pdf", { state: "done", wasHeld: true }),
  item("k-plain", "plain.pdf", { state: "waiting" }),
];
vi.mock("@/components/flows/UploadQueue", async (actual) => ({
  ...(await actual<typeof import("@/components/flows/UploadQueue")>()),
  useUploadQueue: () => ({ items, add: vi.fn(), retry, remove, shared: queue.shared, addShared, discardShared }),
}));
vi.mock("@/lib/api/documents", () => ({ listFlows: async () => [returningFlow] }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

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

it("names the shared files waiting on this phone on every app screen, Upload included, and offers Add them or Discard", async () => {
  nav.path = "/upload"; queue.shared = ["a.pdf", "b.jpg", "c.pdf", "d.pdf", "e.pdf"].map((name, i) => ({ key: `s${i}`, name }));
  render(<SharedWaiting />, { wrapper });
  expect(await screen.findByText("5 shared files are waiting on this phone: a.pdf, b.jpg, c.pdf and 2 more.")).toBeInTheDocument();
  const shown = ["s0", "s1", "s2", "s3", "s4"];                // the buttons act on exactly the files this render names
  fireEvent.click(screen.getByRole("button", { name: "Add them" }));
  expect(addShared).toHaveBeenCalledWith(INBOX_TARGET(returningFlow), shown);
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(discardShared).toHaveBeenCalledWith(shown);
  expect(sharedLine(["a.pdf"])).toBe("1 shared file is waiting on this phone: a.pdf.");
  expect(sharedLine(["a.pdf", "b.jpg"])).toBe("2 shared files are waiting on this phone: a.pdf and b.jpg.");
  expect(sharedLine(["a.pdf", "b.jpg", "c.pdf"])).toBe("3 shared files are waiting on this phone: a.pdf, b.jpg and c.pdf.");
});
