import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import HelpIndex from "./page";
import { START_HERE, getGuideBySlug, liveClientGuides } from "@/lib/guides";
import { DOCUMENT_STATUSES } from "@/lib/documentStatusManifest";

describe("the help home", () => {
  it("searches articles and guides together and says how many it found", () => {
    render(<HelpIndex />);
    const g = getGuideBySlug(START_HERE[0])!;
    const box = screen.getByLabelText("Search articles and guides");
    fireEvent.change(box, { target: { value: g.title } });
    const results = screen.getByRole("region", { name: "Search results" });
    expect(within(results).getByRole("link", { name: new RegExp(g.title) })).toHaveAttribute("href", g.href);
    expect(within(results).getByText(/^\d+ results?$/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "xqzv" } });
    expect(within(screen.getByRole("region", { name: "Search results" })).getByText("No matching articles or guides")).toBeInTheDocument();
  });

  it("names the app's own statuses and the three Start here guides", () => {
    render(<HelpIndex />);
    const stuck = screen.getByRole("region", { name: "Is a document stuck?" });
    for (const k of ["needs_review", "read_failed", "send_failed"] as const) {
      expect(within(stuck).getByText(DOCUMENT_STATUSES[k].label)).toBeInTheDocument();
    }
    const start = screen.getByRole("region", { name: "Start here" });
    expect(within(start).getAllByRole("link").slice(0, 3).map((a) => a.getAttribute("href"))).toEqual(
      START_HERE.map((s) => getGuideBySlug(s)!.href),
    );
    expect(screen.getByRole("link", { name: `All ${liveClientGuides().length} step-by-step guides` })).toHaveAttribute("href", "/help/guides");
    expect(screen.queryByText(/business day|every message/)).toBeNull();
  });
});
