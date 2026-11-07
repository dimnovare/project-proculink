import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FlowIntake } from "@/lib/api/documents";
import { PickupForm } from "./PickupForm";

const api = vi.hoisted(() => ({ createIntake: vi.fn(), updateIntake: vi.fn(), testIntake: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const wrap = (intake?: FlowIntake) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PickupForm flowId="f1" intake={intake} onDone={() => {}} />
    </QueryClientProvider>,
  );

const saved: FlowIntake = {
  id: "i1", kind: "sftp", hasCredentials: true, isEnabled: true, address: null, lastRunAt: null, lastStatus: null, lastMessage: null,
  config: { host: "sftp.example.test", port: 22, username: "ops", directory: "/in", hostKeyFingerprints: ["SHA256:abc"] },
};

describe("PickupForm", () => {
  it("creates an SFTP pickup with the password as credentials", async () => {
    api.createIntake.mockResolvedValue({ ...saved });
    wrap();
    fireEvent.change(screen.getByLabelText("Server"), { target: { value: "sftp.example.test" } });
    fireEvent.change(screen.getByLabelText("User name"), { target: { value: "ops" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createIntake).toHaveBeenCalled());
    expect(api.createIntake.mock.calls[0][1]).toMatchObject({
      kind: "sftp", credentials: { password: "pw" }, config: { host: "sftp.example.test", username: "ops", port: 22 },
    });
  });

  it("keeps the saved password and fingerprint when the password is left blank", async () => {
    api.updateIntake.mockResolvedValue(saved);
    wrap(saved);
    expect(screen.getByLabelText("Password").getAttribute("placeholder")).toBe("Leave blank to keep the saved one");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateIntake).toHaveBeenCalled());
    const [, id, req] = api.updateIntake.mock.calls[0];
    expect(id).toBe("i1");
    expect(req.credentials).toBeNull();
    expect(req.config).not.toHaveProperty("hostKeyFingerprints");
  });

  it("warns that FTP is unencrypted", () => {
    wrap();
    expect(screen.queryByText(/sends your password unencrypted/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "ftp" } });
    expect(screen.getByText(/FTP sends your password unencrypted/)).toBeTruthy();
  });
});
