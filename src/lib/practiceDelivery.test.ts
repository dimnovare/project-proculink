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
//
// The same promise came back one function further down. `practiceDeliveryFrom` answers
// `null` for a run it cannot account for — a bookmark, a fresh tab, a state this build
// does not recognise — and that `null` fell through `practiceDeliveryNote`'s `default:`
// onto the strongest reassurance the screen can make. A bookmarked `existing_target` run
// reaches that branch with no backend change at all.

/**
 * The sentence the screen must not say about a run it cannot account for.
 *
 * Asserted in BOTH directions below: absent from the unknown note, and present in the one
 * state where it is actually true. Without that second half a regex that had quietly
 * stopped matching anything — a reworded sentence, a mangled pattern — would satisfy every
 * `not.toMatch` here for free and let the defect walk straight back in.
 */
const SAFETY_PROMISE = /nothing reaches a real/i;

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
    // A bookmark opened later, a new tab, an inbox row. `null` must not be read as any of
    // the three states — least of all as the reassurance, because an `existing_target` run
    // opened from a bookmark arrives here and pressing send DOES dispatch through the
    // target that is already set up.
    const note = practiceDeliveryNote(null, "supplier");

    expect(note).not.toMatch(SAFETY_PROMISE);
    expect(note).not.toMatch(/emailed to you/i);
    expect(note).not.toMatch(/will stop/i);
  });

  it("says it cannot tell, and where the answer is, for a run it cannot account for", () => {
    // Silence would also promise nothing, but the operator is about to press send. The one
    // place that answers the question is the same place `existing_target` points at.
    const note = practiceDeliveryNote(null, "supplier");

    expect(note).toMatch(/can.t tell/i);
    expect(note).toMatch(/delivery settings/i);
  });

  it("keeps the safety promise on the one state where it is true", () => {
    // Anti-vacuity floor for SAFETY_PROMISE. `not_set_up` means no delivery target at all,
    // so the run really does stop and the sentence really is earned. If this stops finding
    // it, the pattern has gone dead and its `not.toMatch` guards are worthless.
    const carrying = PRACTICE_DELIVERY_STATES.filter((state) =>
      SAFETY_PROMISE.test(practiceDeliveryNote(state, "supplier")),
    );

    expect(carrying).toEqual(["not_set_up"]);
  });

  it("answers each state distinctly, and none of them with the unknown line", () => {
    // Stops the opposite over-correction: returning "we can't tell" for everything would
    // satisfy every guard above while throwing away three answers we actually have.
    const notes = PRACTICE_DELIVERY_STATES.map((state) => practiceDeliveryNote(state, "supplier"));

    expect(new Set(notes).size).toBe(PRACTICE_DELIVERY_STATES.length);
    expect(notes).not.toContain(practiceDeliveryNote(null, "supplier"));
  });

  it("does not fall through to a promise for a state this build does not know", () => {
    // A fifth backend state, or a renamed key. `practiceDeliveryFrom` already screens those
    // to `null`, so this pins the switch itself: handed a value the type system says is
    // impossible, it must still refuse to reassure.
    const note = practiceDeliveryNote("beamed_up" as unknown as PracticeDeliveryState, "supplier");

    expect(note).not.toMatch(SAFETY_PROMISE);
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

  it("carries that refusal all the way to the copy, instead of reassuring", () => {
    // The two halves joined up, which is where the defect lived: the read refused the value
    // correctly, and then the copy handed back the strongest promise on the screen anyway.
    const unknown = practiceDeliveryFrom({ practiceDelivery: "teleported", deliveryConfigured: false });
    const stale = practiceDeliveryFrom({});

    expect(practiceDeliveryNote(unknown, "supplier")).not.toMatch(SAFETY_PROMISE);
    expect(practiceDeliveryNote(stale, "supplier")).not.toMatch(SAFETY_PROMISE);
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
