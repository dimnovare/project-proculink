import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { alertsState, turnOffAlerts, turnOnAlerts } from "@/lib/pwa/push";
import { PhoneAlerts } from "./PhoneAlerts";

vi.mock("@/lib/pwa/push", () => ({ VAPID_PUBLIC_KEY: "", alertsState: vi.fn(), turnOnAlerts: vi.fn(), turnOffAlerts: vi.fn(async () => {}) }));

const PHONE = /On an iPhone, add ProcuLink to your home screen first/;
const turnOn = () => screen.findByRole("button", { name: "Turn on phone alerts" });

beforeEach(() => vi.clearAllMocks());

it("renders nothing without a key, and never asks for permission on load", async () => {
  expect(render(<PhoneAlerts publicKey="" />).container.innerHTML).toBe("");
  vi.mocked(alertsState).mockResolvedValue("off");
  const { unmount } = render(<PhoneAlerts publicKey="BAAA" />);
  expect(await turnOn()).toBeInTheDocument();
  expect(turnOnAlerts).not.toHaveBeenCalled();
  expect(screen.getByText(PHONE)).toBeInTheDocument();
  unmount();
  vi.mocked(alertsState).mockResolvedValue("unavailable");
  render(<PhoneAlerts publicKey="BAAA" />);
  await waitFor(() => expect(alertsState).toHaveBeenCalledWith("BAAA"));
  await act(async () => {});                         // let the resolved state render before looking for a button
  expect(screen.getByText(PHONE)).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
});

it("the button turns alerts on and off and says what happened", async () => {
  vi.mocked(alertsState).mockResolvedValue("off");
  vi.mocked(turnOnAlerts).mockRejectedValueOnce(new Error("refused")).mockResolvedValueOnce("on").mockResolvedValueOnce("blocked");
  render(<PhoneAlerts publicKey="BAAA" />);
  fireEvent.click(await turnOn());
  expect(await screen.findByText("Couldn't turn on phone alerts. Try again.")).toBeInTheDocument();
  fireEvent.click(await turnOn());
  expect(await screen.findByText("Phone alerts are on for this device.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Turn off phone alerts" }));
  fireEvent.click(await turnOn());
  expect(turnOffAlerts).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Alerts are blocked for ProcuLink in this browser/)).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
});
