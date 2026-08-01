import { describe, it, expect } from "vitest";
import {
  PRACTICE_DELIVERY_STATES,
  practiceDeliveryFrom,
  practiceDeliveryNote,
  type PracticeDeliveryState,
} from "./practiceDelivery";

// WP-39 §4.5 — the practice order's own account of what pressing "send" will do.
//
// The screen used to have two things to say and three situations to say them in. The
// backend's `deliveryConfigured: false` meant "I did not set up the practice mailbox",
// and the review screen rendered it as:
//
//   Email sending isn't configured on this ProcuLink deployment yet, so this run will
//   stop at "no delivery is set up".
//
// which is a promise, not a description. When the sample supplier already carried a
// delivery target the seeder could not replace, the run did not stop — pressing send
// dispatched through that target. In the QA pass that was an expired request bin (the
// 404 §4.5 recorded); on another organisation it is a practice order reaching a real
// supplier, right after the screen said nothing would.

describe("practice delivery — what send will actually do", () => {
  it("has copy for every state the backend can send", () => {
    // Bound to the state list, not to a copy of it here. A fourth state added to
    // PracticeDeliveryState in ProcuLink.Core needs a decision about what this screen
    // says — this fails until someone makes it, rather than falling through to a default.
    expect(PRACTICE_DELIVERY_STATES.length).toBeGreaterThan(0);

    for (const state of PRACTICE_DELIVERY_STATES) {
      const note = practiceDeliveryNote(state, "supplier");
      expect(note, `no copy for "${state}"`).toBeTruthy();
      expect(note.length, `copy for "${state}" is too short to be a sentence`).toBeGreaterThan(20);
    }
  });

  it("promises the mailbox only when the mailbox is set up", () => {
    expect(practiceDeliveryNote("emailed_to_you", "supplier")).toBe(
      "The finished file is emailed to you, never to a supplier.",
    );
  });

  it("says the run stops only when it really will", () => {
    expect(practiceDeliveryNote("not_set_up", "supplier")).toMatch(/stop/i);
  });

  it("warns, and does not claim a stop, when a delivery target is already set up", () => {
    const note = practiceDeliveryNote("existing_target", "supplier");

    expect(note).not.toMatch(/will stop/i);
    expect(note).not.toMatch(/isn.t configured/i);
    // The two things the operator has to know before pressing send: something IS set up,
    // and it is not the practice mailbox.
    expect(note).toMatch(/already has a delivery target/i);
    expect(note).toMatch(/not the practice mailbox|sent through it/i);
  });

  it("promises nothing when this session did not start the run", () => {
    // A bookmark opened later, or a fresh session. `null` must not be read as any of the
    // three states — it downgrades to what is true either way.
    const note = practiceDeliveryNote(null, "supplier");

    expect(note).toBe("Nothing reaches a real supplier.");
  });

  it("uses the caller's word for the counterparty", () => {
    expect(practiceDeliveryNote("emailed_to_you", "buyer")).toContain("buyer");
    expect(practiceDeliveryNote(null, "buyer")).toContain("buyer");
  });
});

describe("reading the API's answer", () => {
  it("takes practiceDelivery when the backend sends it", () => {
    for (const state of PRACTICE_DELIVERY_STATES) {
      expect(practiceDeliveryFrom({ practiceDelivery: state, deliveryConfigured: false })).toBe(state);
    }
  });

  it("falls back to deliveryConfigured on an API too old to send the state", () => {
    // Frontend and backend deploy separately. The old bool carried strictly less
    // information, so the fallback is the old behaviour — never a guess at the new state.
    expect(practiceDeliveryFrom({ deliveryConfigured: true })).toBe("emailed_to_you");
    expect(practiceDeliveryFrom({ deliveryConfigured: false })).toBe("not_set_up");
  });

  it("refuses a state it does not recognise rather than rendering it", () => {
    // A newer backend, an older frontend. `null` reads as "we don't know", which is the
    // one answer that is safe in both directions.
    expect(practiceDeliveryFrom({ practiceDelivery: "teleported", deliveryConfigured: false })).toBeNull();
  });

  it("answers null when the response carries neither field", () => {
    expect(practiceDeliveryFrom({})).toBeNull();
  });
});

describe("the state list mirrors the backend", () => {
  it("is exactly the three states ProcuLink.Core.Constants.PracticeDeliveryState declares", () => {
    // The frontend cannot import C#. What it can do is keep ONE copy and pin it, so the
    // mirror is checkable rather than merely annotated — the same reason
    // src/lib/orderStatusManifest.ts exists.
    const expected: PracticeDeliveryState[] = ["emailed_to_you", "not_set_up", "existing_target"];
    expect([...PRACTICE_DELIVERY_STATES].sort()).toEqual([...expected].sort());
  });
});
