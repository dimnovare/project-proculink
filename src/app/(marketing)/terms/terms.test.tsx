import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TermsPage from "./page";
import { DOCUMENT_PLANS, LEGACY_PAID_PLANS, PLAN_BY_ID } from "@/lib/plans";

// Section 5 is contractual: every number is derived from plans.ts, never typed here.
describe("Terms section 5", () => {
  it("states the Trial allowance in documents and flows and each document plan's own rate", () => {
    const { container } = render(<TermsPage />);
    const lines = Array.from(container.querySelectorAll("li")).map((li) => li.textContent ?? "");
    const line = (name: string) => lines.find((l) => l.startsWith(`${name}:`)) ?? "";

    const trial = PLAN_BY_ID.pilot;
    expect(line(trial.name)).toContain(`${trial.orderLimit} documents total, ${trial.flowLimit} flows`);
    for (const p of DOCUMENT_PLANS) expect(line(p.name)).toContain(`then €${p.overageEur?.toFixed(2)} per extra document`);
    for (const p of LEGACY_PAID_PLANS) expect(line(p.name)).not.toContain("per extra document");
  });
});
