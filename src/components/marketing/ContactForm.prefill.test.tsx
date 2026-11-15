import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

// WP-24 — /support?order=&problem=.
//
// A stuck order's panel offers "Get help with this order", linking to
// `/support?order={po}&problem={status}`. The support page ignored both params, so the
// form opened blank and the operator retyped what the product already knew.
// `grep -rn 'get("order")' src/` and the same for `problem` returned zero hits.
//
// The status is a KEY, not copy. It must never reach a customer as
// `delivery_dead_letter`, and an unrecognised one must degrade to today's blank form
// rather than rendering "Order undefined —".

const submitSupportRequest = vi.fn();

// Read at call time, not at factory time (vi.mock is hoisted above this `let`).
let searchParams = new URLSearchParams();

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    submitSupportRequest: (...a: unknown[]) => submitSupportRequest(...a),
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/support",
  useSearchParams: () => searchParams,
}));

import { ContactFormFromAddress } from "./ContactForm";
import { PROBLEM_COPY } from "@/components/bridge/problem/problemCopy";

function subjectField() {
  return screen.getByRole("textbox", { name: /Subject/i }) as HTMLInputElement;
}

beforeEach(() => {
  submitSupportRequest.mockReset();
  searchParams = new URLSearchParams();
});

afterEach(cleanup);

describe("ContactForm — prefilled from ?order= and ?problem=", () => {
  it("names the order and describes the problem in plain words", () => {
    searchParams = new URLSearchParams("order=PO-4711&problem=failed");

    render(<ContactFormFromAddress />);

    // The badge is READ from PROBLEM_COPY, not retyped. A parallel packet renamed
    // it ("Couldn't read the file" → "Couldn't read file") and this test was the
    // only thing that broke — the component had already followed the rename,
    // because it reads the same source. Hard-coding the words here would make a
    // future rename look like a product regression instead of a copy edit.
    expect(subjectField().value).toBe(`Order PO-4711 — ${PROBLEM_COPY.failed.badge}`);
  });

  it("never puts the raw status key in front of the customer", () => {
    searchParams = new URLSearchParams("order=PO-4711&problem=delivery_dead_letter");

    render(<ContactFormFromAddress />);

    expect(subjectField().value).toBe("Order PO-4711 — Out of retries");
    expect(subjectField().value).not.toMatch(/delivery_dead_letter|_/);
  });

  it("leaves every prefilled field editable", () => {
    searchParams = new URLSearchParams("order=PO-4711&problem=failed");

    render(<ContactFormFromAddress />);

    // The state round-trip alone is not proof: fireEvent.change dispatches straight
    // at the element and happily "types" into a readOnly input, so a readOnly subject
    // passes it. @testing-library/user-event (which does respect readOnly) is not a
    // dependency here, so assert the property a real user would actually hit.
    expect(subjectField().readOnly).toBe(false);
    expect(subjectField().disabled).toBe(false);

    fireEvent.change(subjectField(), { target: { value: "My own words" } });
    expect(subjectField().value).toBe("My own words");
  });

  it("does not prefill the message, so the form still refuses to send empty", () => {
    searchParams = new URLSearchParams("order=PO-4711&problem=failed");

    render(<ContactFormFromAddress />);

    expect((screen.getByRole("textbox", { name: /Message/i }) as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("button", { name: /Send message/i })).toBeDisabled();
  });
});

describe("ContactForm — missing or unrecognised params fall back to a blank form", () => {
  it("renders an empty subject when there are no params at all", () => {
    render(<ContactFormFromAddress />);

    expect(subjectField().value).toBe("");
  });

  it("drops a status it does not recognise instead of echoing it", () => {
    searchParams = new URLSearchParams("order=PO-4711&problem=banana");

    render(<ContactFormFromAddress />);

    expect(subjectField().value).toBe("Order PO-4711");
    expect(subjectField().value).not.toMatch(/banana/i);
  });

  it("never writes 'Order undefined' when the order is missing", () => {
    searchParams = new URLSearchParams("problem=failed");

    render(<ContactFormFromAddress />);

    expect(subjectField().value).toBe(PROBLEM_COPY.failed.badge);
    expect(subjectField().value).not.toMatch(/undefined|Order Order/i);
  });

  it("treats the bare word 'Order' (an order with no PO number) as no PO number", () => {
    // poTitleFrom() renders a blank PO number as "Order", and the link carries it
    // verbatim — "Order Order — …" is not a subject anyone should have to edit.
    searchParams = new URLSearchParams("order=Order&problem=failed");

    render(<ContactFormFromAddress />);

    expect(subjectField().value).toBe(PROBLEM_COPY.failed.badge);
  });
});

describe("ContactForm — sending", () => {
  function fill() {
    fireEvent.change(screen.getByRole("textbox", { name: /Message/i }), { target: { value: "The export stopped" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Your email/i }), { target: { value: "sam@example.test" } });
    return screen.getByRole("form", { name: "Contact support" });
  }

  it("sends one request however often Send is pressed, and says where to write when it fails", async () => {
    submitSupportRequest.mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(<ContactFormFromAddress />);
    const form = fill();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(submitSupportRequest).toHaveBeenCalledTimes(1);
    const busy = within(form).getByRole("button", { name: "Sending…" });
    expect(busy).toBeDisabled();
    unmount();

    submitSupportRequest.mockRejectedValueOnce(new Error("submitSupportRequest failed: 500"));
    render(<ContactFormFromAddress />);
    const again = fill();
    fireEvent.submit(again);
    expect(await within(again).findByRole("alert")).toHaveTextContent("support@proculink.eu");
  });

  it("refuses to send without an address", () => {
    render(<ContactFormFromAddress />);
    fireEvent.change(screen.getByRole("textbox", { name: /Message/i }), { target: { value: "The export stopped" } });
    expect(screen.getByRole("button", { name: /Send message/i })).toBeDisabled();
  });
});