import { describe, expect, test } from "vitest";
import type { ActivityEvent } from "@/lib/api/documents";
import { auditActionLabel } from "@/lib/auditActionManifest";
import { serverReasonOrNull } from "@/lib/serverText";
import { activityAddress, activityView, activityWho, memberNames, plainSentence, readActivityAddress } from "./activityRows";

const ev = (over: Partial<ActivityEvent>): ActivityEvent => ({
  id: "evt-1", ts: "2026-06-01T08:00:00Z", action: "document.received", documentId: "doc-1", flowId: "flow-1",
  documentName: "invoice-1003.csv", flowName: "Supplier invoices", source: "upload", actorId: null, startedAt: null, poNumber: null,
  payload: null, ...over,
});
const members = memberNames([
  { publicUserData: { userId: "user_member_a", firstName: "Alex", lastName: "Example", identifier: "alex@example.test" } },
  { publicUserData: { userId: "user_member_b", firstName: null, lastName: null, identifier: "sam@example.test" } },
]);
const view = (e: ActivityEvent) => activityView(e, { who: activityWho(e, members), destinationName: () => null });

describe("activityRows", () => {
  test("who: every actor case", () => {
    const cases: [ActivityEvent, ReadonlyMap<string, string>, string][] = [
      [ev({ action: "document.value_edited", actorId: "user_member_a" }), members, "Alex Example"],
      [ev({ action: "document.value_edited", actorId: "user_member_b" }), members, "sam@example.test"],
      [ev({ action: "document.value_edited", actorId: "user_unknown" }), members, "A workspace member"],
      [ev({ action: "document.value_edited", actorId: "user_member_a" }), new Map(), "A workspace member"],
      [ev({ action: "document.received", source: "upload", actorId: null }), members, "A workspace member"],
      [ev({ action: "document.sent", actorId: null }), members, "Automatic"],
      [ev({ action: "document.delivered", documentId: null, documentName: null, source: null }), members, "Not recorded"],
      [ev({ action: "document.delivery_failed", actorId: null, startedAt: null }), members, "Not recorded"],
      [ev({ action: "admin.org.limits_changed", documentId: null, flowId: null, documentName: null, source: null }), members, "System"],
    ];
    for (const [e, m, who] of cases) expect(activityWho(e, m), e.action).toBe(who);
    expect(activityWho(ev({ action: "inbound_email.rejected_orders_retired", documentId: null, source: null }), members)).not.toBe("Extraction engine");

    const read = (x: string) => readActivityAddress(new URLSearchParams(x));
    expect(read("show=failed&page=2")).toEqual({ tab: "failed", page: 2 });
    for (const x of ["show=nope", "show=sent&show=failed"]) expect(read(x).tab, x).toBe("all");
    for (const x of ["page=0", "page=1.5", "page=1000000000", "page=2&page=3"]) expect(read(x).page, x).toBe(1);
    expect(activityAddress("all")).toBe("/operations/log");
    expect(activityAddress("sent", 1)).toBe("/operations/log?show=sent");
    expect(activityAddress("failed", 2)).toBe("/operations/log?show=failed&page=2");
  });

  test("old and repaired deliveries leave unknown facts out", () => {
    const old = view(ev({ action: "document.delivered", payload: { output: "Invoice CSV", protocol: "email" } }));
    expect(plainSentence(old.sentence)).toBe("invoice-1003.csv was sent");
    for (const f of old.facts) expect(f.value).not.toMatch(/undefined|null|\b0\b/);
    expect(old.facts.map((f) => f.term)).not.toContain("Attempts");
    expect(old.facts.map((f) => f.term)).not.toContain("Destination");

    const error = "The send stopped before it finished. Send it again.";
    const repair = view(ev({ action: "document.delivery_failed", payload: { output: null, protocol: null, attempts: null, destinationId: null, error } }));
    expect(repair.why).toBe(serverReasonOrNull(error));
    expect(repair.canFix).toBe(false);
    expect(repair.canSendAgain).toBe(true);

    const last = new Date(2026, 5, 1, 9, 12).toISOString();
    const full = view(ev({
      action: "document.delivery_failed", ts: last, actorId: "user_member_a", startedAt: last,
      payload: { destination: "Accounting inbox", destinationId: "dest-1", protocol: "email", error: "The mailbox refused the message.", responseCode: 550, attempts: 3, output: "Invoice CSV", file: "invoice-1003.csv", version: 2 },
    }));
    expect(full.facts).toContainEqual({ term: "Attempts", value: "3, the last at 09:12. We stopped there." });
    expect(full.facts).toContainEqual({ term: "Destination", value: "Accounting inbox, Email" });
    expect(full.facts).toContainEqual({ term: "Where it stopped", value: "At Send, stage 5 of 5", stopped: 4 });
    expect(full.tag).toEqual({ label: "Couldn't send", tone: "danger" });
    expect(full.why).toBe("The mailbox refused the message. Fix the destination, then send it again.");
    expect(full.canFix).toBe(true);

    const edit = (target: string, old: string | null, now: string | null) => view(ev({ action: "document.value_edited", payload: { target, old, new: now } }));
    const changed = edit("field:invoice_number", "INV-1", "INV-2");
    expect(plainSentence(changed.sentence)).toBe("A value on invoice-1003.csv was changed");
    expect(changed.facts).toContainEqual({ term: "Value", value: "invoice number" });
    expect(edit("cell:lines[2].unit_price", "4.50", "4.75").facts).toContainEqual({ term: "Value", value: "unit price, line 3" });
    const added = edit("row:lines[2]", null, "row");
    expect(plainSentence(added.sentence)).toBe("A line on invoice-1003.csv was added");
    expect(added.facts).toEqual([]);
    expect(view(ev({ action: "document.value_taught", payload: { key: "invoice_number" } })).facts).toContainEqual({ term: "Value", value: "invoice number" });
  });

  test("server text is sanitised, and unknown is never green", () => {
    const html = view(ev({ action: "document.delivery_failed", payload: { error: "<html><body>502 Bad Gateway</body></html>" } }));
    expect(html.why ?? "").not.toContain("<");
    const unknown = view(ev({ action: "something.new", documentId: null, documentName: null }));
    expect(unknown.tag.tone).not.toBe("green");
    expect(plainSentence(unknown.sentence)).toBe(auditActionLabel("something.new"));
  });

  test("tells the sorting history in words", () => {
    const at = (action: string, payload: object | null) => view(ev({ action, documentName: "invoice-2292.pdf", payload }));
    const said = (action: string, payload: object | null) => plainSentence(at(action, payload).sentence);
    expect(said("document.sorted", { flow: "Delivery notes", certain: false })).toBe("invoice-2292.pdf was put with Delivery notes");
    expect(at("document.sorted", { flow: "Delivery notes", certain: false }).why).toBe("We weren't sure, so it waits for you to check.");
    expect(at("document.sorted", { flow: "Supplier invoices", certain: true }).why).toBeNull();
    expect(at("document.sorted", { flow: "Supplier invoices", certain: true, duplicateFile: true }).why).toBe("The flow already had this file, so it waits for you.");
    expect([said("document.sorted", null), at("document.sorted", null).tag, at("document.sorted", null).why]).toEqual(["invoice-2292.pdf was put with a flow", { label: "Put with a flow", tone: "blue" }, null]);
    expect([said("document.moved", { flow: "Supplier invoices" }), at("document.moved", {}).tag]).toEqual(["invoice-2292.pdf was moved to Supplier invoices", { label: "Moved", tone: "neutral" }]);
    expect(said("document.moved", { flow: "Invoices", newFlow: true })).toBe("invoice-2292.pdf was put with the new flow Invoices");
    expect(said("document.moved", { newFlow: true })).toBe("invoice-2292.pdf was moved");
    const down = at("document.downloaded", { format: "xlsx" });
    expect([plainSentence(down.sentence), down.tag, down.facts]).toEqual(["What we read from invoice-2292.pdf was downloaded", { label: "Downloaded", tone: "green" }, [{ term: "Format", value: "Excel" }]]);
    expect([at("document.downloaded", { format: "csv" }).facts, at("document.downloaded", null).facts]).toEqual([[{ term: "Format", value: "CSV" }], []]);
  });
});
