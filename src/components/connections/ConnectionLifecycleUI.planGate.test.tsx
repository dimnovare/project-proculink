import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// WP-11 follow-through — the versioned (connection revision) path.
//
// Creating a draft or publishing a revision whose bundle selects a gated DeliveryProtocol or
// OutputFormat is refused with the same three codes as the supplier-level editor. Those
// mutations funnel through useConnectionRevisions.onMutationError, which puts the server's
// message straight into this banner — so without a shape check the customer read
// `{"error":"cxml_output_requires_operations","upgradeUrl":"/settings"}` in a red box.

import { ConnectionNotice } from "./ConnectionLifecycleUI";

afterEach(cleanup);

describe("ConnectionNotice — plan-gated lifecycle actions", () => {
  it("renders a plan-gate refusal as a sentence with an upgrade link", () => {
    render(
      <ConnectionNotice
        notice={{
          kind: "err",
          text: JSON.stringify({ error: "cxml_output_requires_operations", upgradeUrl: "/settings" }),
        }}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(/Operations/);
    expect(notice.textContent ?? "").not.toMatch(/_requires_|upgradeUrl/);
    expect(screen.getByRole("link", { name: /plans/i })).toHaveAttribute("href", "/settings");
  });

  it("leaves the backend's own message alone when the refusal is not a plan gate", () => {
    render(
      <ConnectionNotice notice={{ kind: "err", text: "Run tests on this revision before publishing." }} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Run tests on this revision before publishing.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("leaves success notices alone", () => {
    render(<ConnectionNotice notice={{ kind: "ok", text: "Draft discarded." }} />);

    expect(screen.getByRole("status")).toHaveTextContent("Draft discarded.");
  });
});
