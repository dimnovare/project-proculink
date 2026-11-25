import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OUTPUT_ROWS, READ_ROWS, WAYS_IN_ROWS, WAYS_OUT_ROWS } from "@/components/marketing/formatsRows";
import { MAX_UPLOAD_BYTES } from "@/lib/fileKinds";
import { DOCUMENT_UNIT_SENTENCE } from "@/lib/plans";
import FormatsPage from "./page";

describe("/formats", () => {
  it("lists every row in five sections the jump links reach, the limits from the code, the released standards, and nothing about a held-back e-invoice standard or where data is", () => {
    const { container } = render(<FormatsPage />);
    const page = within(container);
    expect(container.querySelector("main"), "the layout supplies <main>").toBeNull();
    const jump = page.getByRole("navigation", { name: "On this page" });
    const targets = within(jump).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(targets).toEqual(["#read", "#outputs", "#ways-in", "#ways-out", "#limits"]);
    for (const t of targets) expect(container.querySelector(t!), t!).not.toBeNull();
    for (const [id, rows] of [["read", READ_ROWS], ["outputs", OUTPUT_ROWS], ["ways-in", WAYS_IN_ROWS], ["ways-out", WAYS_OUT_ROWS]] as const) {
      const section = container.querySelector(`#${id}`)!;
      expect(Array.from(section.querySelectorAll("dt")).map((d) => d.textContent), id).toEqual(rows.map((r) => r.name));
      expect(Array.from(section.querySelectorAll("dd")).map((d) => d.textContent), id).toEqual(rows.map((r) => r.note));
    }
    const limits = container.querySelector("#limits")!.textContent!;
    expect(limits).toContain(`Up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB a file.`);
    expect(limits).toContain(DOCUMENT_UNIT_SENTENCE);
    expect(container.textContent).toContain("Microsoft SharePoint: on request");
    expect(page.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "/how-it-works");
    for (const name of ["cXML", "UBL Order", "EDIFACT ORDERS", "ANSI X12 850", "ZUGFeRD / Factur-X invoice"]) expect(container.querySelector("#outputs")!.textContent, name).toContain(name);
    expect(container.textContent).not.toMatch(/peppol|xrechnung|en\s?16931|EU-region|residen|Capabilities/i);
  });
});
