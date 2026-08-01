// practiceDelivery — what pressing "send" on a practice order will actually do, and the
// one sentence the review screen says about it.
//
// WHY THIS EXISTS
//
// The backend used to answer one bool, `deliveryConfigured`, and it meant "the seeder
// wrote a delivery config just now". Every consumer read it as "this supplier has a
// delivery target". Those agree except in one situation, and WP-39 §4.5 is what that
// situation looks like: the sample supplier already carried a hand-made HTTP target, the
// seeder's guards returned early without ever looking at it, and this screen told the
// operator the run would "stop at no delivery is set up".
//
// It did not stop. Pressing send POSTed to the endpoint that was there — a dead request
// bin in that instance, and on another organisation as easily a real supplier, moments
// after the screen promised nothing would reach one.
//
// MIRROR
//
// These values are wire contract, mirrored from
// `ProcuLink.Core/Constants/PracticeDeliveryState.cs`. The frontend cannot import C#; what
// it can do is keep exactly ONE copy and pin it under test, which is the same argument
// `src/lib/orderStatusManifest.ts` makes at length for the order statuses.

/** Every state the API can send. A walk over this drives the copy table's coverage test. */
export const PRACTICE_DELIVERY_STATES = [
  /** The finished file is emailed to the operator. Nothing reaches a real supplier. */
  "emailed_to_you",
  /** No delivery target at all, so the run genuinely stops after transform. */
  "not_set_up",
  /**
   * A delivery target exists that this practice run did not set up. It is deliberately
   * left alone by the seeder, which means pressing send WILL dispatch through it.
   */
  "existing_target",
] as const;

export type PracticeDeliveryState = (typeof PRACTICE_DELIVERY_STATES)[number];

export function isPracticeDeliveryState(value: unknown): value is PracticeDeliveryState {
  return typeof value === "string" && (PRACTICE_DELIVERY_STATES as readonly string[]).includes(value);
}

/**
 * Read the state out of `POST /api/onboarding/sample-order`'s answer.
 *
 * Order matters. `practiceDelivery` is the real answer; `deliveryConfigured` is the older,
 * strictly-less-informative bool and is only consulted when the field is absent — an API
 * that predates WP-39. A value this build does not recognise answers `null` rather than
 * being rendered: "we don't know" is the one reading that is safe in both deploy
 * directions, and it downgrades the copy to what is true either way.
 */
export function practiceDeliveryFrom(
  response: { practiceDelivery?: unknown; deliveryConfigured?: boolean },
): PracticeDeliveryState | null {
  if (response.practiceDelivery !== undefined) {
    return isPracticeDeliveryState(response.practiceDelivery) ? response.practiceDelivery : null;
  }
  if (typeof response.deliveryConfigured === "boolean") {
    return response.deliveryConfigured ? "emailed_to_you" : "not_set_up";
  }
  return null;
}

/**
 * The sentence the practice-order note ends with.
 *
 * `null` — this session did not start the run (a bookmark, a fresh session), so nothing
 * about THIS run is known. It promises nothing and holds either way.
 */
export function practiceDeliveryNote(
  state: PracticeDeliveryState | null,
  counterpartyNounLower: string,
): string {
  switch (state) {
    case "emailed_to_you":
      return `The finished file is emailed to you, never to a ${counterpartyNounLower}.`;
    case "not_set_up":
      return `Email sending isn't configured on this ProcuLink deployment yet, so this run will stop at “no delivery is set up”. Nothing reaches a real ${counterpartyNounLower}.`;
    case "existing_target":
      // Deliberately not a promise in either direction. Something IS set up, it is not the
      // practice mailbox, and the operator is the only one who knows where it points.
      return `This ${counterpartyNounLower} already has a delivery target set up, and it is not the practice mailbox — if you send, the file goes through it. Check its delivery settings first.`;
    default:
      return `Nothing reaches a real ${counterpartyNounLower}.`;
  }
}
