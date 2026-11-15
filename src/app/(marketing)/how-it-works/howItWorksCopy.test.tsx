import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { STAGES } from "@/components/bridge/StatusJourney";
import { AUTOMATIC_DELIVERY_LABEL, REVIEW_BEFORE_DELIVERY_LABEL } from "@/lib/deliveryMode";
import HowItWorksPage from "./page";

describe("How it works", () => {
  it("walks the four steps, the second document and the five stages in order, in today's words", () => {
    const { container } = render(<HowItWorksPage />);
    const page = within(container);
    expect(page.getByRole("heading", { level: 1 }).textContent).toBe("Read it. Check it. Transform it. Send it.");
    const jumps = within(page.getByRole("list", { name: "The four steps" })).getAllByRole("link");
    expect(jumps.map((a) => a.getAttribute("href"))).toEqual(["#step-1", "#step-2", "#step-3", "#step-4"]);
    expect(page.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Send it", "We read it", "You check it", "We send it",
      "The second document is easier.", "For technical readers: the pipeline.", "Try it on your own documents",
    ]);
    const pipeline = page.getByRole("region", { name: "The pipeline, for technical readers" });
    expect(pipeline.id).toBe("pipeline");
    expect(within(pipeline).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([...STAGES]);
    const second = page.getByRole("region", { name: "What happens with the second document" });
    expect(second.textContent).toContain(`Every flow starts in ${REVIEW_BEFORE_DELIVERY_LABEL}.`);
    expect(second.textContent).toContain(`switch that flow to ${AUTOMATIC_DELIVERY_LABEL}.`);
    expect(container.textContent).toContain("the response code");
    expect(container.textContent).not.toMatch(/the last response|cXML|UBL|Peppol|X12/);
    expect(container.querySelectorAll("style")).toHaveLength(0); // no moving picture on this page
  });
});
