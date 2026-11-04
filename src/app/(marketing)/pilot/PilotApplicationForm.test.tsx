import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, within, waitFor } from "@testing-library/react";

// The pilot application submits through the SAME mechanism as /book-demo —
// apiClient.submitSupportRequest → POST /api/support/contact — and that endpoint has
// no structured fields. So the pins here are: it calls that one method (no new
// endpoint), every answer reaches the free-text message, and the supplier's name is
// never asked for.

const submitSupportRequest = vi.fn();

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    submitSupportRequest: (...a: unknown[]) => submitSupportRequest(...a),
  },
}));

import { PilotApplicationForm, composePilotApplication } from "./PilotApplicationForm";

beforeEach(() => {
  submitSupportRequest.mockReset();
  submitSupportRequest.mockResolvedValue({ ok: true, delivered: true, contactEmail: "support@proculink.eu" });
});

afterEach(cleanup);

function setup() {
  const { container } = render(<PilotApplicationForm />);
  const form = within(container).getByRole("form", { name: /apply for a free supported pilot/i });
  return { container, f: within(form) };
}

describe("supported-pilot application form", () => {
  it("stays disabled until name, work email and company are filled", () => {
    const { f } = setup();
    const submit = f.getByRole("button", { name: /apply for a free supported pilot/i });
    expect(submit).toBeDisabled();
    fireEvent.change(f.getByLabelText(/^Name/), { target: { value: "A Person" } });
    fireEvent.change(f.getByLabelText(/^Work email/), { target: { value: "a@example.com" } });
    expect(submit).toBeDisabled();
    fireEvent.change(f.getByLabelText(/^Company/), { target: { value: "Example OÜ" } });
    expect(submit).toBeEnabled();
  });

  it("asks every question on the application, and not for the supplier's name", () => {
    const { container } = setup();
    const prompts = Array.from(container.querySelectorAll("label, legend")).map((l) => l.textContent ?? "");
    const all = prompts.join(" | ");
    for (const q of [
      /^Name/m, /Work email/, /^Company/m, /Country/, /Role/,
      /order physical products from the same suppliers/,
      /item or part numbers differ/,
      /normally use for purchase orders/,
      /How often does this kind of repeat order happen/,
      /main manual step/,
      /Anything else/,
    ]) {
      expect(prompts.some((p) => q.test(p)), String(q)).toBe(true);
    }
    expect(all).not.toMatch(/supplier(?:'s|’s)? name|which supplier|name of (?:the|your) supplier/i);
  });

  it("submits through submitSupportRequest with every answer folded into the message", async () => {
    const { container, f } = setup();
    fireEvent.change(f.getByLabelText(/^Name/), { target: { value: "A Person" } });
    fireEvent.change(f.getByLabelText(/^Work email/), { target: { value: "a@example.com" } });
    fireEvent.change(f.getByLabelText(/^Company/), { target: { value: "Example OÜ" } });
    fireEvent.change(f.getByLabelText(/^Country/), { target: { value: "Estonia" } });
    fireEvent.change(f.getByLabelText(/^Role/), { target: { value: "Purchasing manager" } });
    fireEvent.click(f.getByRole("radio", { name: "Yes" }));
    fireEvent.click(f.getByRole("radio", { name: "Often" }));
    // Click order deliberately differs from list order.
    fireEvent.click(f.getByRole("checkbox", { name: "CSV" }));
    fireEvent.click(f.getByRole("checkbox", { name: "PDF" }));
    fireEvent.click(f.getByRole("radio", { name: "Weekly" }));
    fireEvent.click(f.getByRole("radio", { name: "Item-code lookup" }));
    fireEvent.change(f.getByLabelText(/Anything else/), { target: { value: "Two suppliers in mind." } });

    fireEvent.click(f.getByRole("button", { name: /apply for a free supported pilot/i }));

    await waitFor(() => expect(submitSupportRequest).toHaveBeenCalledTimes(1));
    const payload = submitSupportRequest.mock.calls[0][0];
    expect(payload).toMatchObject({
      category: "demo",
      subject: "Pilot application — Example OÜ",
      userEmail: "a@example.com",
      route: "/pilot",
    });
    const message: string = payload.message;
    for (const line of [
      "Name:                 A Person",
      "Company:              Example OÜ",
      "Country:              Estonia",
      "Role:                 Purchasing manager",
      "Repeat purchasing:    Yes",
      "Item codes differ:    Often",
      "PO files used:        PDF, CSV",
      "Repeat frequency:     Weekly",
      "Main manual step:     Item-code lookup",
      "Two suppliers in mind.",
    ]) {
      expect(message).toContain(line);
    }

    // Success replaces the form and announces itself.
    await waitFor(() => expect(within(container).getByRole("status").textContent).toMatch(/Application received/));
  });

  it("does not claim the application arrived when the server could not send it", async () => {
    submitSupportRequest.mockResolvedValueOnce({ ok: true, delivered: false, contactEmail: "support@proculink.eu" });
    const { container, f } = setup();
    fireEvent.change(f.getByLabelText(/^Name/), { target: { value: "A Person" } });
    fireEvent.change(f.getByLabelText(/^Work email/), { target: { value: "a@example.com" } });
    fireEvent.change(f.getByLabelText(/^Company/), { target: { value: "Example OÜ" } });
    fireEvent.click(f.getByRole("button", { name: /apply for a free supported pilot/i }));

    await waitFor(() => expect(within(container).getByRole("alert").textContent).toMatch(/support@proculink\.eu/));
    expect(container.textContent ?? "").not.toMatch(/Application received/);
  });

  it("marks unanswered optional questions instead of dropping them", () => {
    const body = composePilotApplication({
      name: "A", company: "B", country: "", role: "", repeat: "", itemCodes: "",
      files: [], frequency: "", manualStep: "", note: "",
    });
    expect(body).toContain("Country:              (not answered)");
    expect(body).toContain("PO files used:        (not answered)");
    expect(body).not.toContain("Note:");
  });
});
