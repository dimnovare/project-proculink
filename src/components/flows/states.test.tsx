import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Checks, Failed, Loading, LoadingPanel, ReadProblem } from "./states";
import { COPY, outputFailedMessage } from "@/lib/documentRefusals";
import { flowAddress } from "@/lib/flowSteps";
import { ApiHttpError } from "@/lib/api/core";
import { EmptyState } from "@/components/bridge/EmptyState";
import { buttonClass } from "@/components/bridge/DSPrimitives";

/** ReadProblem reads the screen's cached document detail, so it renders inside a client; `detail` seeds that cache. */
const withClient = (ui: React.ReactElement, detail?: unknown) => {
  const qc = new QueryClient();
  if (detail) qc.setQueryData(["document", "d"], detail);
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe("ReadProblem", () => {
  it("says why a held document is waiting when no output matches", () => {
    const summary = { id: "d", status: "needs_review", statusReason: "no_output_matches" };
    const { container } = withClient(<ReadProblem summary={summary as never} retry={{} as never} uploadHref="/flows/f?tab=documents" />);
    expect(within(container).getByText(COPY.no_output_matches)).toBeTruthy();
  });

  it("a file that couldn't be made is named with its reason and opens that file, or says to open the flow's files", () => {
    const summary = { id: "d", flowId: "f1", status: "needs_review", statusReason: "output_invalid" };
    const held = { output: "KSeF invoice", detail: "This standard needs Receiver VAT ID.", outputId: "o1" };
    const ui = <ReadProblem summary={summary as never} retry={{} as never} uploadHref="/flows/f1?tab=documents" />;
    const named = within(withClient(ui, { summary, heldOutput: held }).container);
    expect(named.getByText(outputFailedMessage(held.output, held.detail))).toBeTruthy();
    expect(named.getByRole("link", { name: "Change the file" }).getAttribute("href")).toBe(flowAddress("f1", "send", { output: "o1" }));
    const unknown = within(withClient(ui).container);
    expect(unknown.getByText(outputFailedMessage(null, null))).toBeTruthy();
    expect(unknown.getByRole("link", { name: "Change the file" }).getAttribute("href")).toBe(flowAddress("f1", "send"));
  });

  it("a file left out of a send is said once, with the others made and the way to add the values it lacks", () => {
    const summary = { id: "d", flowId: "f1", status: "sent", statusReason: "output_invalid" };
    const held = { output: "ZUGFeRD", detail: "This standard needs Sender country.", missing: ["sender_country"], outputId: "o1" };
    const ui = <ReadProblem summary={summary as never} retry={{} as never} uploadHref="/flows/f1?tab=documents" />;
    const notice = within(withClient(ui, { summary, heldOutput: held, read: { fields: [] } }).container);
    // The way on is where a meaning is set (a read value's More), not an "add" that We read does not have (N-01).
    expect(notice.getByText(`${outputFailedMessage(held.output, held.detail)} The other files were made. To fix it, open We read, choose More on the value that holds it, and set its Meaning.`)).toBeTruthy();
    expect(notice.getByRole("link", { name: "Open We read" }).getAttribute("href")).toBe(flowAddress("f1", "read"));
  });
});

describe("Checks", () => {
  it("a repeated number says when the earlier copy came and opens it, with no link when that copy was removed", () => {
    const checks = [{ code: "duplicate", passed: false, fieldKey: null, message: "A document with this number was already received." }];
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { container, rerender } = render(<Checks checks={checks} flowId="f1" duplicateOf={{ id: "d0", receivedAt: at, number: "INV-1001" }} />);
    expect(within(container).getByText(/^INV-1001 was already received on /)).toBeTruthy();
    expect(within(container).getByRole("link", { name: "Open the earlier one" }).getAttribute("href")).toBe("/flows/f1/documents/d0");
    rerender(<Checks checks={checks} flowId="f1" duplicateOf={{ id: null, receivedAt: at, number: "INV-1001" }} />);
    expect(within(container).queryByRole("link")).toBeNull();
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

describe("Loading and a document we couldn't read", () => {
  it("loading shows the moving mark, which a screen reader skips for the words", () => {
    const { container } = render(<><LoadingPanel label="Loading the page" /><Loading>Loading flows…</Loading></>);
    const page = within(container).getByRole("status", { name: "Loading the page" });
    const line = within(container).getByText("Loading flows…");
    for (const status of [page, line]) {
      const mark = status.querySelector("svg.logo-loader");
      expect(mark?.getAttribute("aria-hidden")).toBe("true");
      // Each mark carries its own gradient: one in a hidden tree would blank the others.
      expect(mark?.querySelector(".ll-wire")?.getAttribute("stroke")).toBe(`url(#${mark?.querySelector("linearGradient")?.id})`);
    }
    expect(line.getAttribute("role")).toBe("status");
    expect(page.querySelector("linearGradient")?.id).not.toBe(line.querySelector("linearGradient")?.id);
  });

  it("a document we couldn't read says it was not sent or counted, and offers another copy as the filled button", () => {
    const summary = { id: "d", status: "read_failed", statusReason: "unreadable_file" };
    const { container } = withClient(<ReadProblem summary={summary as never} retry={{ isPending: false, isError: false, mutate() {} } as never} uploadHref="/flows/f?tab=documents" />);
    expect(within(container).getByText(COPY.unreadable_file)).toBeTruthy();
    expect(within(container).getByText("It hasn't been sent anywhere, and it doesn't count as a document on your plan.")).toBeTruthy();
    const link = within(container).getByRole("link", { name: "Upload another copy" });
    expect(link.getAttribute("href")).toBe("/flows/f?tab=documents");
    expect(link.className).toBe(buttonClass("primary", "md")); // the way on is the filled button (A-09)
  });
});
