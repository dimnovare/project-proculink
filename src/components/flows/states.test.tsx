import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { Failed, LoadingRows, ReadProblem } from "./states";
import { COPY } from "@/lib/documentRefusals";
import { ApiHttpError } from "@/lib/api/core";
import { EmptyState } from "@/components/bridge/EmptyState";
import { buttonClass } from "@/components/bridge/DSPrimitives";

describe("ReadProblem", () => {
  it("says why a held document is waiting when no output matches", () => {
    const summary = { id: "d", status: "needs_review", statusReason: "no_output_matches" };
    const { container } = render(<ReadProblem summary={summary as never} retry={{} as never} uploadHref="/flows/f?tab=documents" />);
    expect(within(container).getByText(COPY.no_output_matches)).toBeTruthy();
  });
});

describe("Failed and EmptyState", () => {
  it("Failed says the server's reason when it gave one, and asks to check the connection only when nothing answered", () => {
    const box = (error: unknown) => {
      const { container, unmount } = render(<Failed error={error} retry={() => {}} />);
      const text = within(container).getByRole("alert").textContent;
      const button = within(container).getByRole("button", { name: "Try again" });
      unmount();
      return { text, button: !!button };
    };
    expect(box(new ApiHttpError("x", 404, { error: "document_not_found" })).text).toBe(COPY.document_not_found + "Try again");
    expect(box(new ApiHttpError("x", 429, { error: "pilot_expired" })).text).toBe(COPY.pilot_expired + "Try again");
    expect(box(new ApiHttpError("x", 503, { error: "processing_paused" })).text).toBe(COPY.processing_paused + "Try again");
    expect(box(new TypeError("Failed to fetch")).text).toBe("We couldn't load this. Nothing is lost. Check your connection and try again.Try again");
    expect(box(new ApiHttpError("x", 502, null)).text).toBe("We couldn't load this. Nothing is lost. Check your connection and try again.Try again");
    expect(box(new ApiHttpError("x", 400, { error: "a_token_we_have_no_words_for" })).text).toBe("We couldn't load this. Something went wrong. Try again.Try again");
    const { container } = render(<Failed error={new TypeError("x")} retry={() => {}} what="your documents" />);
    const panel = within(container).getByRole("alert");
    expect(within(panel).getByRole("heading", { level: 2 }).textContent).toBe("We couldn't load your documents.");
    expect(within(panel).getByText("Nothing is lost. Check your connection and try again.")).toBeTruthy();
  });

  it("an empty state has one heading, one line and at most one action, in the colour its caller chose", () => {
    const onClick = vi.fn();
    const { container } = render(<EmptyState title="No lookups yet" sub="Make one from a table." action={{ label: "New lookup", onClick }} />);
    const empty = within(container).getByTestId("empty-state");
    expect(within(empty).getByRole("heading", { level: 2, name: "No lookups yet" })).toBeTruthy();
    const button = within(empty).getByRole("button", { name: "New lookup" });
    expect(button.className).toContain("bg-navy"); // the Button class string, not a computed colour
    expect(within(empty).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(empty.querySelector("svg")).toBeNull(); // the brand mark is gone
  });
});

describe("LoadingRows and a document we couldn't read", () => {
  it("loading is a still list of rows a screen reader hears as one status", () => {
    const { container } = render(<LoadingRows label="Loading documents" columns={["Document", "Flow", "What's needed"]} />);
    const status = within(container).getByRole("status", { name: "Loading documents" });
    expect(within(status).getByText("What's needed")).toBeTruthy();
    expect(status.querySelectorAll("[aria-hidden='true']").length).toBeGreaterThanOrEqual(3);
    expect(status.outerHTML).not.toMatch(/animate-/);
  });

  it("a document we couldn't read says it was not sent or counted, and offers a clearer copy", () => {
    const summary = { id: "d", status: "read_failed", statusReason: "unreadable_file" };
    const { container } = render(<ReadProblem summary={summary as never} retry={{ isPending: false, isError: false, mutate() {} } as never} uploadHref="/flows/f?tab=documents" />);
    expect(within(container).getByText(COPY.unreadable_file)).toBeTruthy();
    expect(within(container).getByText("It hasn't been sent anywhere, and it doesn't count as a document on your plan.")).toBeTruthy();
    const link = within(container).getByRole("link", { name: "Upload a clearer copy" });
    expect(link.getAttribute("href")).toBe("/flows/f?tab=documents");
    expect(link.className).toBe(buttonClass("secondary", "md")); // outlined (R14)
  });
});
