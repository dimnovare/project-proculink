import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

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

import { ContactForm } from "./ContactForm";

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

    render(<ContactForm />);

    expect(subjectField().value).toBe("Order PO-4711 — Couldn't read the file");
  });

  it("never puts the raw status key in front of the customer", () => {
    searchParams = new URLSearchParams("order=PO-4711&problem=delivery_dead_letter");

    render(<ContactForm />);

    expect(subjectField().value).toBe("Order PO-4711 — Out of retries");
    expect(subjectField().value).not.toMatch(/delivery_dead_letter|_/);
  });

  it("leaves every prefilled field editable", () => {
    searchParams = new URLSearchParams("order=PO-4711&problem=failed");

    render(<ContactForm />);

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

    render(<ContactForm />);

    expect((screen.getByRole("textbox", { name: /Message/i }) as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("button", { name: /Send message/i })).toBeDisabled();
  });
});

describe("ContactForm — missing or unrecognised params fall back to a blank form", () => {
  it("renders an empty subject when there are no params at all", () => {
    render(<ContactForm />);

    expect(subjectField().value).toBe("");
  });

  it("drops a status it does not recognise instead of echoing it", () => {
    searchParams = new URLSearchParams("order=PO-4711&problem=banana");

    render(<ContactForm />);

    expect(subjectField().value).toBe("Order PO-4711");
    expect(subjectField().value).not.toMatch(/banana/i);
  });

  it("never writes 'Order undefined' when the order is missing", () => {
    searchParams = new URLSearchParams("problem=failed");

    render(<ContactForm />);

    expect(subjectField().value).toBe("Couldn't read the file");
    expect(subjectField().value).not.toMatch(/undefined|Order Order/i);
  });

  it("treats the bare word 'Order' (an order with no PO number) as no PO number", () => {
    // poTitleFrom() renders a blank PO number as "Order", and the link carries it
    // verbatim — "Order Order — …" is not a subject anyone should have to edit.
    searchParams = new URLSearchParams("order=Order&problem=failed");

    render(<ContactForm />);

    expect(subjectField().value).toBe("Couldn't read the file");
  });
});
