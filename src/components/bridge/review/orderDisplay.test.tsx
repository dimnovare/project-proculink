import { describe, it, expect } from "vitest";
import {
  REPROCESSED_ARTIFACT_KEY_MARKER,
  deliverableArtifact,
  deliveryFormatLabel,
  orderDeliveryFormat,
  outputArtifactLabel,
} from "./orderDisplay";
import type { Artifact, Order } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// "The newest artifact" and "the artifact we will send" are different questions.
//
// GET /api/orders/{id} returns `Artifacts` as
// `e.OutboundArtifacts.OrderByDescending(a => a.CreatedAt)`, unfiltered — on
// purpose, because it answers "what does this order HOLD?".
// (OrdersController.cs:2752.) The frontend then used `artifacts[0]` to answer
// "what will we SEND?", and after a WP-35 re-process under a draft revision with
// a different output format, the newest artifact is the PREVIEW.
//
// The backend sends the right bytes either way — every send path goes through
// `OutboundArtifactSelection.Deliverable()`. What was wrong was the confirmation
// dialog for an irreversible action, which named the preview's format at the
// moment the operator consented.
//
// The discriminator is the storage namespace, not a column: a re-processed
// artifact is written under `{org}/{order}/reprocessed/{id}`, a deliverable one
// under `{org}/{order}/artifacts/{id}`. `ArtifactDto` carries `fileKey`, so the
// frontend can ask exactly the question the backend asks.
// ─────────────────────────────────────────────────────────────────────────────

const ORG = "11111111-1111-1111-1111-111111111111";
const ORDER = "22222222-2222-2222-2222-222222222222";

function artifact(over: Partial<Artifact> & Pick<Artifact, "id">): Artifact {
  return {
    format: "csv",
    fileKey: `${ORG}/${ORDER}/artifacts/${over.id}.csv`,
    createdAt: "2026-08-01T09:00:00Z",
    ...over,
  };
}

/** The shape a WP-35 re-process leaves behind: newer, different format, preview key. */
const REPROCESSED_PREVIEW = artifact({
  id: "a-preview",
  format: "json",
  fileKey: `${ORG}/${ORDER}/reprocessed/a-preview.json`,
  createdAt: "2026-08-05T17:00:00Z",
});

/** The artifact that will actually go to the supplier — older, and the real one. */
const DELIVERABLE = artifact({
  id: "a-deliverable",
  format: "csv",
  createdAt: "2026-08-02T10:00:00Z",
});

/** Newest-first, exactly as the API returns it. */
const NEWEST_IS_A_PREVIEW: Artifact[] = [REPROCESSED_PREVIEW, DELIVERABLE];

describe("the deliverable artifact is not simply the newest one", () => {
  it("skips a newer re-processed preview", () => {
    expect(deliverableArtifact(NEWEST_IS_A_PREVIEW)?.id).toBe("a-deliverable");
    // Not a tautology: the list really is newest-first, so `[0]` is the preview.
    expect(NEWEST_IS_A_PREVIEW[0].id).toBe("a-preview");
  });

  it("picks the newest DELIVERABLE when several exist, whatever order they arrive in", () => {
    const older = artifact({ id: "a-old", format: "xml", createdAt: "2026-07-01T09:00:00Z" });
    const newer = artifact({ id: "a-new", format: "cxml", createdAt: "2026-08-03T09:00:00Z" });
    expect(deliverableArtifact([older, newer, REPROCESSED_PREVIEW])?.id).toBe("a-new");
    expect(deliverableArtifact([REPROCESSED_PREVIEW, newer, older])?.id).toBe("a-new");
  });

  it("returns null rather than a preview when the order holds only previews", () => {
    expect(deliverableArtifact([REPROCESSED_PREVIEW])).toBeNull();
    expect(deliverableArtifact([])).toBeNull();
    expect(deliverableArtifact(undefined)).toBeNull();
  });

  it("matches the delimited segment, not the bare word", () => {
    // The backend matches "/reprocessed/" and not "reprocessed" for exactly this
    // reason (OutboundArtifactSelection.cs:41): an org or order id that happens
    // to contain the word is not a preview.
    expect(REPROCESSED_ARTIFACT_KEY_MARKER).toBe("/reprocessed/");
    const innocent = artifact({
      id: "a-innocent",
      fileKey: `${ORG}/reprocessed-orders-2026/artifacts/a-innocent.csv`,
    });
    expect(deliverableArtifact([innocent])?.id).toBe("a-innocent");
  });

  it("every display helper asks the same question", () => {
    expect(orderDeliveryFormat({ artifacts: NEWEST_IS_A_PREVIEW })).toBe("csv");
    expect(deliveryFormatLabel(orderDeliveryFormat({ artifacts: NEWEST_IS_A_PREVIEW }))).toBe("CSV");
    expect(outputArtifactLabel(NEWEST_IS_A_PREVIEW, "BoltWorks BV")).toBe("boltworks-bv.csv");
    // …and none of them says "json", the preview's format.
    expect(orderDeliveryFormat({ artifacts: NEWEST_IS_A_PREVIEW })).not.toBe("json");
    expect(deliveryFormatLabel(orderDeliveryFormat({ artifacts: NEWEST_IS_A_PREVIEW }))).not.toBe("JSON");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deliveryFormatLabel replaced `outputArtifactType`, whose whole body was:
//
//     const fmt = deliverableArtifact(artifacts)?.format?.toLowerCase();
//     if (!fmt)           return "XML";
//     if (fmt === "cxml") return "cXML";
//     if (fmt === "csv")  return "CSV";
//     return fmt.toUpperCase();
//
// Line 2 is the defect. Its one production consumer was the sub-lg review card, so
// on every order awaiting review — which is every order that has not been sent, since
// the transform runs BECAUSE no deliverable artifact exists — the phone displayed a
// delivery format nothing had chosen, and the wrong one for every supplier not on XML.
// ─────────────────────────────────────────────────────────────────────────────
describe("deliveryFormatLabel — null in, null out", () => {
  it("returns null for null, and never a default format", () => {
    expect(deliveryFormatLabel(null)).toBeNull();
  });

  it("labels every format the product can deliver", () => {
    expect(deliveryFormatLabel("csv")).toBe("CSV");
    expect(deliveryFormatLabel("json")).toBe("JSON");
    expect(deliveryFormatLabel("xml")).toBe("XML");
    expect(deliveryFormatLabel("cxml")).toBe("cXML");
    expect(deliveryFormatLabel("ubl")).toBe("UBL");
    expect(deliveryFormatLabel("x12")).toBe("X12");
  });

  it("an order with no deliverable artifact yields no label at all", () => {
    // The end-to-end shape of the defect, through the one normalizer.
    const noArtifacts = deliveryFormatLabel(orderDeliveryFormat({ artifacts: [] }));
    expect(noArtifacts).toBeNull();
    const previewOnly = deliveryFormatLabel(orderDeliveryFormat({ artifacts: [REPROCESSED_PREVIEW] }));
    expect(previewOnly).toBeNull();
  });
});
