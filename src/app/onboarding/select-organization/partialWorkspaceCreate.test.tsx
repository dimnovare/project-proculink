// The two-step workspace auto-create, and the half of it that used to vanish.
//
// THE DEFECT THIS PINS. /onboarding/select-organization creates the workspace
// for a zero-org user in two steps:
//
//   1. createOrganization({ name })    — the Clerk workspace really is created
//   2. setActive({ organization: id }) — without it the session token carries
//                                        no org_id claim and every API call
//                                        answers "Organisation not resolved"
//                                        (src/app/(app)/layout.tsx:20-23)
//
// Both used to land in ONE handler:
//
//     .catch(() => { creatingRef.current = false; setCreateError(true); })
//
// It took no error parameter, logged nothing, and called no captureException
// (this repo does use it — OnboardingWizard.tsx:141, useSampleOrder.ts:115).
// Two consequences, both pinned below:
//
//   • "the workspace was never created" and "the workspace was created but
//     could not be activated" collapsed into ONE indistinguishable UI state.
//   • That state rendered Clerk's <CreateOrganization/> — the
//     create-a-workspace form — with nothing on screen saying a workspace
//     already existed. So after a failure that had already created one, the
//     reader's obvious next action was to create a SECOND one.
//
// Same defect class as PR 128 (a partial success rendering as a clean slate),
// with one difference that changes the fix: retrying `setActive` alone IS a
// legitimate remedy here. PR 128 rejected retry because a 403 never changes
// its mind; this is a single re-runnable call whose earlier step succeeded.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

const replaceSpy = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceSpy, refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const setActiveSpy = vi.fn();
const createOrganizationSpy = vi.fn();
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: { firstName: "Ada", primaryEmailAddress: { emailAddress: "a@b.co" } } }),
  useOrganization: () => ({ organization: null }),
  useOrganizationList: () => ({
    // Resolved with zero memberships — decideOrgGate's "create" branch, the
    // only path that runs the two-step auto-create.
    userMemberships: { data: [] },
    setActive: setActiveSpy,
    createOrganization: createOrganizationSpy,
  }),
  // The marker for "the bare create-a-workspace form", i.e. the defect.
  CreateOrganization: () => <div>create org form</div>,
  OrganizationList: () => <div>org list</div>,
}));

const captureExceptionSpy = vi.fn();
vi.mock("@/lib/sentry-context", () => ({
  captureException: (...args: unknown[]) => captureExceptionSpy(...args),
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  get isApiMockMode() {
    return false;
  },
  get isQaBypass() {
    return false;
  },
}));

vi.mock("@/lib/navigationClock", () => ({ msSinceNavigationStart: () => 0 }));
vi.mock("@/lib/reload", () => ({ reloadPage: vi.fn() }));

import SelectOrganizationPage from "./page";

const ORG_ID = "org_created_but_not_active";
/** deriveWorkspaceName("Ada", …) — the name the auto-create really uses. */
const WORKSPACE_NAME = "Ada's workspace";
const FORM_MARKER = "create org form";
const DEST = "/bridge?org_set=1";
const CREATE_ERROR = "createOrganization exploded";
const ACTIVATE_ERROR = "setActive exploded";

/**
 * The three outcomes of the two-step create. This table IS the sweep, so the
 * floor test below counts it: an outcome silently dropped must fail loudly
 * rather than quietly shrinking what this file checks.
 *
 * `showsCreateForm` and `saysWorkspaceExists` are mutually exclusive on
 * purpose — the create form is only honest when step one is what failed.
 */
const OUTCOMES = [
  {
    key: "activate_failed",
    createOk: true,
    activateOk: false,
    showsCreateForm: false,
    saysWorkspaceExists: true,
    routesThrough: false,
    failedStep: "activate",
    errorMessage: ACTIVATE_ERROR,
  },
  {
    key: "create_failed",
    createOk: false,
    activateOk: false,
    showsCreateForm: true,
    saysWorkspaceExists: false,
    routesThrough: false,
    failedStep: "create",
    errorMessage: CREATE_ERROR,
  },
  {
    key: "both_ok",
    createOk: true,
    activateOk: true,
    showsCreateForm: false,
    saysWorkspaceExists: false,
    routesThrough: true,
    failedStep: null,
    errorMessage: null,
  },
] as const;

type Outcome = (typeof OUTCOMES)[number];

async function mountAutoCreate({ createOk, activateOk }: { createOk: boolean; activateOk: boolean }) {
  createOrganizationSpy.mockImplementation(({ name }: { name: string }) =>
    createOk ? Promise.resolve({ id: ORG_ID, name }) : Promise.reject(new Error(CREATE_ERROR)),
  );
  setActiveSpy.mockImplementation(() =>
    activateOk ? Promise.resolve(undefined) : Promise.reject(new Error(ACTIVATE_ERROR)),
  );
  render(<SelectOrganizationPage />);
  await waitFor(() => {
    expect(createOrganizationSpy).toHaveBeenCalled();
  });
}

beforeEach(() => {
  replaceSpy.mockClear();
  setActiveSpy.mockReset();
  createOrganizationSpy.mockReset();
  captureExceptionSpy.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the org gate's two-step workspace auto-create", () => {
  // ANTI-VACUITY FLOOR. Runs first and throws before any negative assertion in
  // this file gets a chance to pass on an empty render.
  it("sweeps every outcome of the two-step create", () => {
    expect(OUTCOMES.length).toBeGreaterThan(0);
    expect(OUTCOMES).toHaveLength(3);
    // Exactly one arm may show the create form, and it is the one where
    // nothing was created.
    expect(OUTCOMES.filter((o) => o.showsCreateForm).map((o) => o.key)).toEqual(["create_failed"]);
    // Exactly one must say a workspace already exists.
    expect(OUTCOMES.filter((o) => o.saysWorkspaceExists).map((o) => o.key)).toEqual([
      "activate_failed",
    ]);
    // Exactly one is the TRUE-SUCCESS control. Without it this file could be
    // passed by making every render look like a failure.
    expect(OUTCOMES.filter((o) => o.routesThrough).map((o) => o.key)).toEqual(["both_ok"]);
    // The defect itself, restated as a constraint no arm may satisfy: showing
    // the create form while a workspace already exists.
    expect(OUTCOMES.filter((o) => o.showsCreateForm && o.saysWorkspaceExists)).toHaveLength(0);
  });

  it.each(OUTCOMES.map((o) => [o.key, o] as [string, Outcome]))(
    "%s: what is on screen matches what really happened",
    async (_key, outcome) => {
      await mountAutoCreate(outcome);

      if (outcome.routesThrough) {
        // POSITIVE FIRST: the happy path really completes and forwards into
        // the app, so a fix that turned every render into a failure card
        // fails here.
        await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith(DEST));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.queryByText(FORM_MARKER)).toBeNull();
        return;
      }

      // POSITIVE FIRST (the ordering trap PR 126 hit): a render that produced
      // nothing at all throws HERE rather than passing the negatives below
      // vacuously.
      const alert = await screen.findByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(replaceSpy).not.toHaveBeenCalled();

      if (outcome.saysWorkspaceExists) {
        expect(alert).toHaveTextContent(/already exists/i);
        expect(alert).toHaveTextContent(WORKSPACE_NAME);
        // THE DEFECT, VERBATIM: createOrganization succeeded and setActive
        // failed, so the bare create-a-workspace form must not be on screen.
        expect(screen.queryByText(FORM_MARKER)).toBeNull();
      } else {
        // Step one failed, so nothing exists and the form IS the next step.
        expect(await screen.findByText(FORM_MARKER)).toBeInTheDocument();
        expect(alert).not.toHaveTextContent(/already exists/i);
      }
    },
  );

  it("keeps the two failures distinguishable instead of collapsing them", async () => {
    await mountAutoCreate({ createOk: true, activateOk: false });
    const afterActivateFailure = (await screen.findByRole("alert")).textContent ?? "";
    expect(afterActivateFailure.length).toBeGreaterThan(0);

    cleanup();
    createOrganizationSpy.mockReset();
    setActiveSpy.mockReset();
    replaceSpy.mockClear();

    await mountAutoCreate({ createOk: false, activateOk: false });
    const afterCreateFailure = (await screen.findByRole("alert")).textContent ?? "";
    expect(afterCreateFailure.length).toBeGreaterThan(0);

    expect(afterActivateFailure).not.toEqual(afterCreateFailure);
  });

  it("offers to open the workspace that exists, and retries only the activation", async () => {
    await mountAutoCreate({ createOk: true, activateOk: false });
    await screen.findByRole("alert");
    expect(createOrganizationSpy).toHaveBeenCalledTimes(1);

    const open = screen.getByRole("button", { name: /open .*workspace/i });
    expect(open).toBeInTheDocument();

    setActiveSpy.mockClear();
    setActiveSpy.mockImplementation(() => Promise.resolve(undefined));
    fireEvent.click(open);

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith(DEST));
    expect(setActiveSpy).toHaveBeenCalledWith({ organization: ORG_ID });
    // Creating a SECOND workspace is the outcome this whole file exists to
    // prevent, so the recovery must never re-run step one.
    expect(createOrganizationSpy).toHaveBeenCalledTimes(1);
  });

  it("says so again when opening fails a second time, and still offers no create form", async () => {
    await mountAutoCreate({ createOk: true, activateOk: false });
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: /open .*workspace/i }));

    await waitFor(() => expect(setActiveSpy).toHaveBeenCalledTimes(2));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/still couldn’t open/i);
    expect(alert).toHaveTextContent(/already exists/i);
    expect(screen.queryByText(FORM_MARKER)).toBeNull();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it.each(
    OUTCOMES.filter((o) => o.failedStep !== null).map((o) => [o.key, o] as [string, Outcome]),
  )("%s: captures the error instead of discarding it, tagged with the step", async (_key, outcome) => {
    await mountAutoCreate(outcome);
    // POSITIVE FIRST: the capture happened at all…
    await waitFor(() => expect(captureExceptionSpy).toHaveBeenCalled());
    // …with the real error object, not a boolean…
    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: outcome.errorMessage }),
      expect.objectContaining({
        // …and with which of the two steps produced it, which is exactly what
        // the single combined catch could not know.
        tags: expect.objectContaining({ failed_step: outcome.failedStep }),
      }),
    );
  });
});
