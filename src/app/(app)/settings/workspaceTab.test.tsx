import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, within, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Org = { name: string; membersCount: number; update: ReturnType<typeof vi.fn> };
const clerk = vi.hoisted(() => ({ org: undefined as Org | undefined, open: vi.fn() }));
const staff = vi.hoisted(() => ({ on: true, answered: 0 }));
const MEMBERS = [
  { id: "m1", role: "org:admin", publicUserData: { userId: "user_a", firstName: "Alex", lastName: "Example", identifier: "alex@example.test" } },
  { id: "m2", role: "org:member", publicUserData: { userId: "user_s", firstName: "Sam", lastName: "Sample", identifier: "sam@example.test" } },
];
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=org"),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/settings",
}));
vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({
    organization: clerk.org,
    memberships: clerk.org ? { data: MEMBERS, count: 2, isLoading: false, isError: false } : undefined,
  }),
  useUser: () => ({ user: { id: "user_a" } }),
  useClerk: () => ({ openOrganizationProfile: clerk.open }),
}));
vi.mock("@clerk/nextjs/errors", () => ({ isClerkAPIResponseError: (e: unknown) => typeof (e as { status?: unknown })?.status === "number" }));
vi.mock("@/components/flows/NotificationEmailSection", () => ({ NotificationEmailSection: () => null }));
vi.mock("@/components/settings/ConnectedAccounts", () => ({ ConnectedAccounts: () => null }));
vi.mock("@/lib/api-client", async (o) => ({
  ...(await o<typeof import("@/lib/api-client")>()),
  getBillingStatus: vi.fn().mockResolvedValue({ plan: "starter", accountStatus: "active" }),
  checkAdminAccess: () => { staff.answered++; return Promise.resolve(staff.on); },
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

import SettingsPage from "./page";
import { PLAN_BY_ID } from "@/lib/plans";

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <SettingsPage />
    </QueryClientProvider>,
  );

afterEach(() => { cleanup(); clerk.org = undefined; staff.on = true; vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe("Settings › Workspace", () => {
  it("the name saves once when the box is left with a new name, and a refusal keeps what was typed", async () => {
    let finish!: () => void;
    const update = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }))
      .mockRejectedValueOnce({ status: 403 });
    clerk.org = { name: "Supplier desk", membersCount: 2, update };
    mount();
    const box = screen.getByRole("textbox", { name: "Workspace name" });
    fireEvent.blur(box);
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.blur(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("Give the workspace a name.");
    fireEvent.change(box, { target: { value: "  Accounting desk " } });
    fireEvent.blur(box);
    fireEvent.blur(box);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ name: "Accounting desk" });
    finish();
    expect(await within(screen.getByRole("region", { name: "Workspace name" })).findByText("Saved")).toBeTruthy();
    fireEvent.change(box, { target: { value: "Desk two" } });
    fireEvent.blur(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("Only a workspace admin can change this.");
    expect(box).toHaveValue("Desk two");
  });

  it("People lists who has access from Clerk, and nothing about people is said while the workspace is unknown", async () => {
    mount();
    expect(screen.queryByRole("region", { name: "People" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Workspace name" })).toBeNull();
    expect(screen.queryByText(/have access|has access|Loading/)).toBeNull();
    cleanup();
    clerk.org = { name: "Supplier desk", membersCount: 2, update: vi.fn() };
    mount();
    const people = screen.getByRole("region", { name: "People" });
    expect(people).toHaveTextContent("2 people have access to this workspace.");
    const [alex, sam] = within(people).getAllByRole("listitem");
    expect(alex).toHaveTextContent(/Alex Example\s*\(you\)/);
    expect(alex).toHaveTextContent(/alex@example\.test/);
    expect(within(alex).getByText("Administrator")).toBeTruthy();
    expect(sam).not.toHaveTextContent("(you)");
    expect(within(sam).getByText("Member")).toBeTruthy();
    fireEvent.click(within(people).getByRole("button", { name: "Invite or manage people" }));
    expect(clerk.open).toHaveBeenCalledTimes(1);
    const about = screen.getByRole("complementary", { name: "About this workspace" });
    expect(await within(about).findByText(PLAN_BY_ID.starter.name)).toBeTruthy();
    expect(within(about).getByRole("link", { name: "See plan and billing" })).toHaveAttribute("href", "/settings?tab=billing");
    expect(within(about).getByRole("link", { name: "EU-region" })).toHaveAttribute("href", "/security");
  });

  it("on a phone Settings holds the account menu, and Admin for staff", async () => {
    // The runner sets a placeholder Clerk key and a laptop usually has none: pin the chip to one of its two forms.
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    staff.answered = 0;
    mount();
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    const admin = await screen.findByRole("link", { name: "Admin" });
    expect(admin).toHaveAttribute("href", "/admin");
    expect(admin.parentElement).toContainElement(screen.getByTitle("Clerk is not configured"));
    // A light header: the chip's initials are at the house minimum (a class: jsdom has no Tailwind).
    expect(within(screen.getByTitle("Clerk is not configured")).getByText("MK")).toHaveClass("text-[12.5px]");
    expect(admin.parentElement).toHaveClass("md:hidden");
    cleanup();
    staff.on = false;
    mount();
    await waitFor(() => expect(staff.answered).toBe(2));
    await act(async () => {}); // the "no" answer is applied before the check
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    expect(screen.getByTitle("Clerk is not configured")).toBeTruthy();
  });
});
