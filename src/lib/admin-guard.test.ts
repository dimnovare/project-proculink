import { describe, it, expect, vi, beforeEach } from "vitest";

// notFound() signals by throwing in Next.js; mirror that so a guard that fails
// to stop rendering is a test failure rather than a silent pass.
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const getToken = vi.fn<() => Promise<string | null>>();
const auth = vi.fn(async () => ({ getToken }));

vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));

const { requireAdminOrNotFound } = await import("./admin-guard");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// The guard bounds the access check with AbortSignal.timeout(). That exists on
// the Node server this code actually runs on, but not in jsdom — without the
// stub, the call throws, the guard fails closed, and the happy-path test looks
// like a gate bug instead of a missing browser API.
if (typeof AbortSignal.timeout !== "function") {
  vi.stubGlobal("AbortSignal", {
    ...AbortSignal,
    timeout: () => new AbortController().signal,
  });
}

beforeEach(() => {
  notFound.mockClear();
  getToken.mockReset();
  fetchMock.mockReset();
});

describe("requireAdminOrNotFound", () => {
  it("returns quietly when the API confirms the caller is an admin", async () => {
    getToken.mockResolvedValue("jwt");
    fetchMock.mockResolvedValue({ ok: true });

    await expect(requireAdminOrNotFound()).resolves.toBeUndefined();

    expect(notFound).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/admin\/access$/);
    expect(init.headers).toEqual({ Authorization: "Bearer jwt" });
    expect(init.cache).toBe("no-store");
  });

  it("404s a signed-in user who is not on the allowlist", async () => {
    getToken.mockResolvedValue("jwt");
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    await expect(requireAdminOrNotFound()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("404s when there is no session token at all", async () => {
    getToken.mockResolvedValue(null);

    await expect(requireAdminOrNotFound()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s when Clerk itself throws", async () => {
    getToken.mockRejectedValue(new Error("clerk down"));

    await expect(requireAdminOrNotFound()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the API is unreachable", async () => {
    getToken.mockResolvedValue("jwt");
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(requireAdminOrNotFound()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
