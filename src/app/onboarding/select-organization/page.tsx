"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SignInServiceGate } from "@/components/bridge/ClerkAvailabilityGate";
import {
  useAuth,
  useUser,
  useOrganization,
  useOrganizationList,
  CreateOrganization,
  OrganizationList,
} from "@clerk/nextjs";
import { Card } from "@/components/bridge/layout/Card";
import { Button } from "@/components/bridge/DSPrimitives";
import { captureException } from "@/lib/sentry-context";
import { isApiMockMode, isQaBypass } from "@/lib/api-client";
import { decideOrgGate } from "@/components/onboarding/orgGate";
import { deriveWorkspaceName } from "@/components/onboarding/workspaceName";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6" style={{ background: "#F6F7FA" }}>
      {children}
    </div>
  );
}

function GateSpinner() {
  return (
    <div role="status" aria-live="polite" className="text-sm" style={{ color: "var(--ink-muted)" }}>
      Setting up your workspace…
    </div>
  );
}

/**
 * Which HALF of the two-step auto-create failed. They are not the same event
 * and must never render the same screen:
 *
 *   • "create"   — createOrganization rejected. Nothing was created, so the
 *                  manual create form really is the next step.
 *   • "activate" — createOrganization RESOLVED and setActive rejected. A
 *                  workspace EXISTS. Rendering the create form here invites a
 *                  second one, which is the defect this type exists to make
 *                  unrepresentable.
 *
 * The two used to share one `.catch(() => setCreateError(true))` — no error
 * parameter, no capture, and no way for the render to tell them apart.
 */
type AutoCreateFailure =
  | { step: "create" }
  | { step: "activate"; orgId: string; orgName: string };

/**
 * useSearchParams() MUST be inside a Suspense boundary or `next build` fails. The
 * default export provides the boundary; all logic lives in the Inner component.
 */
export default function SelectOrganizationPage() {
  return (
    <Suspense fallback={<Shell><GateSpinner /></Shell>}>
      <SelectOrganizationInner />
    </Suspense>
  );
}

function SelectOrganizationInner() {
  const router = useRouter();
  const params = useSearchParams();
  const dest = params.get("redirect_url") || "/bridge";

  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { organization } = useOrganization();
  // useOrganizationList returns a DISCRIMINATED UNION: in the not-loaded branch
  // `setActive`/`createOrganization` are undefined and `userMemberships.data` is
  // undefined. The `!setActive` / `?? []` / `data !== undefined` guards below are
  // LOAD-BEARING — do not "simplify" them away (mirrors the shipped
  // AutoActivateOrg precedent).
  const { userMemberships, setActive, createOrganization } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  // setActive is async; the effect below can re-run (re-render) before the org
  // becomes active, which would fire setActive again. Latch it so the activate
  // path invokes setActive at most once.
  const activatingRef = useRef(false);

  // Same one-shot rationale for the auto-create path: createOrganization is
  // async, so latch it so we create the workspace at most once. The latch is
  // NEVER released — not even on failure. Releasing it was pointless (the
  // failure state blocked the branch anyway) and actively dangerous on the
  // activate failure, where a second run would create a second workspace.
  const creatingRef = useRef(false);
  const [failure, setFailure] = useState<AutoCreateFailure | null>(null);
  // The "open the workspace that already exists" recovery — see
  // openExistingWorkspace below.
  const [opening, setOpening] = useState(false);
  const [openFailedAgain, setOpenFailedAgain] = useState(false);

  const bypass = isApiMockMode || isQaBypass;

  const action = decideOrgGate({
    bypass,
    membershipsLoaded: userMemberships.data !== undefined,
    membershipOrgIds: (userMemberships.data ?? []).map((m) => m.organization.id),
    activeOrgId: organization?.id ?? null,
  });

  useEffect(() => {
    if (bypass) {
      router.replace(dest);
      return;
    }
    if (authLoaded && !isSignedIn) {
      router.replace(`/sign-in?redirect_url=${encodeURIComponent(dest)}`);
      return;
    }
    if (action.kind === "ready") {
      router.replace(appendOrgSetFlag(dest));
      return;
    }
    // Once a failure is latched this page is driven by the user, not by this
    // effect. Critically, the activate failure must not fall through to the
    // create branch below: the workspace already exists.
    if (failure) return;

    if (action.kind === "activate" && setActive && !activatingRef.current) {
      activatingRef.current = true;
      void setActive({ organization: action.orgId }).then(() => {
        router.replace(appendOrgSetFlag(dest));
      });
    }
    // Zero-org user: auto-create a workspace with a friendly derived name (no
    // create-org form). createOrganization resolves to an OrganizationResource;
    // activate it, mark it auto-named (so the rename nudge can surface), then
    // forward into the app.
    //
    // The two steps get two SEPARATE catches. A single combined one cannot say
    // which half failed, and the difference decides what the user should do
    // next: create a workspace, or open the one they already have.
    if (action.kind === "create" && createOrganization && setActive && !creatingRef.current) {
      creatingRef.current = true;
      const create = createOrganization;
      const activate = setActive;
      const name = deriveWorkspaceName(user?.firstName, user?.primaryEmailAddress?.emailAddress);
      void (async () => {
        let org: Awaited<ReturnType<typeof create>>;
        try {
          org = await create({ name });
        } catch (err) {
          // STEP ONE failed. Nothing exists, so the manual form is honest.
          captureException(err, {
            tags: { ui_surface: "org_gate_auto_create", failed_step: "create" },
          });
          setFailure({ step: "create" });
          return;
        }
        try {
          await activate({ organization: org.id });
        } catch (err) {
          // STEP TWO failed. The workspace EXISTS but the session token has no
          // org_id claim, so the app would answer "Organisation not resolved"
          // on every call. Do not delete it, and do not offer a create form.
          captureException(err, {
            tags: { ui_surface: "org_gate_auto_create", failed_step: "activate" },
            extra: { org_id: org.id },
          });
          setFailure({ step: "activate", orgId: org.id, orgName: org.name || name });
          return;
        }
        try { localStorage.setItem("ws-autonamed", org.id); } catch { /* storage may be blocked */ }
        router.replace(appendOrgSetFlag(dest));
      })();
    }
  }, [bypass, authLoaded, isSignedIn, action, dest, router, setActive, createOrganization, failure, user]);

  /**
   * Re-run ONLY the activation. Unlike the 403s in PR 128, retrying is a real
   * fix here: step one already succeeded and setActive is a single re-runnable
   * call, so nothing is created twice and no authorization decision is being
   * asked to change its mind.
   */
  const openExistingWorkspace = useCallback(async () => {
    if (!setActive || failure?.step !== "activate" || opening) return;
    const { orgId } = failure;
    setOpening(true);
    setOpenFailedAgain(false);
    try {
      await setActive({ organization: orgId });
    } catch (err) {
      captureException(err, {
        tags: { ui_surface: "org_gate_auto_create", failed_step: "activate_retry" },
        extra: { org_id: orgId },
      });
      setOpening(false);
      setOpenFailedAgain(true);
      return;
    }
    try { localStorage.setItem("ws-autonamed", orgId); } catch { /* storage may be blocked */ }
    // Deliberately stays busy: the navigation is what ends this state.
    router.replace(appendOrgSetFlag(dest));
  }, [setActive, failure, opening, router, dest]);

  // WP-32 follow-up (F3). This used to be a hand-rolled
  // `setTimeout(() => setTimedOut(true), 12_000)` rendering "Still setting
  // things up… / Retry". Three things were wrong with it: 12s is OVER the 10s
  // ceiling the rest of the app is held to; nothing is being set up when the
  // real cause is a dead sign-in script, so the copy was false on the page
  // every successful sign-in lands on; and "Retry" is the word the shared
  // pattern deliberately avoided. `loading` and `activate` are exactly the two
  // states that were treated as a stall, so "settled" is their negation.
  //
  // A latched failure is itself a settled outcome — the card below is what this
  // page has to say — so the sign-in-service deadline must not arm on top of it.
  const settled = failure !== null || (action.kind !== "loading" && action.kind !== "activate");

  return (
    <SignInServiceGate ready={settled} armed={!bypass}>
      <OrgGateContent
        action={action}
        failure={failure}
        dest={dest}
        opening={opening}
        openFailedAgain={openFailedAgain}
        onOpenExisting={() => { void openExistingWorkspace(); }}
      />
    </SignInServiceGate>
  );
}

function OrgGateContent({
  action,
  failure,
  dest,
  opening,
  openFailedAgain,
  onOpenExisting,
}: {
  action: ReturnType<typeof decideOrgGate>;
  failure: AutoCreateFailure | null;
  dest: string;
  opening: boolean;
  openFailedAgain: boolean;
  onOpenExisting: () => void;
}) {
  // Checked BEFORE `action`, not inside its "create" arm. Once the workspace
  // exists, Clerk's membership list can refresh underneath us and flip `action`
  // to "activate" — which falls through to the spinner and would hide the fact
  // that anything failed at all.
  if (failure?.step === "activate") {
    return (
      <WorkspaceCreatedNotOpened
        orgName={failure.orgName}
        opening={opening}
        failedAgain={openFailedAgain}
        onOpen={onOpenExisting}
      />
    );
  }
  if (failure?.step === "create") {
    // Nothing was created, so the form really is the next step — but say why it
    // is on screen instead of presenting it as a fresh start.
    return (
      <Shell>
        <div className="w-full" style={{ maxWidth: 520 }}>
          <p role="alert" className="mb-4 text-[14px] leading-[1.65] text-ink-muted">
            We couldn&rsquo;t set up your workspace automatically, and no workspace was created.
            Create one below to continue.
          </p>
          <CreateOrganization afterCreateOrganizationUrl={appendOrgSetFlag(dest)} skipInvitationScreen />
        </div>
      </Shell>
    );
  }
  if (action.kind === "create") {
    // Happy path: we auto-create the workspace in the effect above, so render
    // the spinner (NOT the form) while that runs.
    return <Shell><GateSpinner /></Shell>;
  }
  if (action.kind === "select") {
    return (
      <Shell>
        <OrganizationList hidePersonal afterSelectOrganizationUrl={appendOrgSetFlag(dest)} afterCreateOrganizationUrl={appendOrgSetFlag(dest)} />
      </Shell>
    );
  }

  return <Shell><GateSpinner /></Shell>;
}

/**
 * Step one succeeded and step two did not: the workspace exists, and only
 * opening it failed.
 *
 * Every line here exists to stop the one action that would make things worse —
 * creating a SECOND workspace — so the card names the one that already exists
 * and offers to open it. It deliberately does NOT delete the workspace to make
 * the failure look clean (PR 128 rejected that rollback for the same reason: it
 * destroys something the user asked for in order to hide a failure from them).
 *
 * Amber, not red, and it borrows DependencyUnavailable's shape rather than
 * that component itself, whose heading is fixed to "Can't reach the …" — the
 * workspace is reachable; activating it is what failed.
 */
function WorkspaceCreatedNotOpened({
  orgName,
  opening,
  failedAgain,
  onOpen,
}: {
  orgName: string;
  opening: boolean;
  failedAgain: boolean;
  onOpen: () => void;
}) {
  return (
    <Shell>
      <div role="alert" className="w-full" style={{ maxWidth: 520 }}>
        {/* edge="none": a role="alert" panel. The amber strip it carried was tone,
            not orientation — see the edge rule in layout/Card.tsx. */}
        <Card pad={16} radius={8}>
          <h1 className="m-0 font-display text-[21px] font-semibold tracking-[-0.02em] text-ink">
            Your workspace is ready &mdash; we couldn&rsquo;t open it
          </h1>

          <div className="mt-2.5 text-[14px] leading-[1.65] text-ink-muted">
            <p className="m-0">
              <strong className="text-ink">{orgName}</strong> already exists, so there is no need to
              create another one. The only step that failed was opening it, and that is usually
              temporary.
            </p>
            {failedAgain && (
              <p className="mb-0 mt-2.5 text-danger">
                Still couldn&rsquo;t open {orgName}. Wait a moment and try again, or get help
                &mdash; your workspace is safe either way.
              </p>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" onClick={onOpen} loading={opening}>
              {opening ? "Opening…" : "Open my workspace"}
            </Button>
            {/* A plain anchor, not next/link: /support is a marketing route that
                imports nothing from Clerk, so it still works when the session
                has no active workspace. */}
            <a
              href="/support"
              className="inline-flex min-h-[44px] items-center rounded text-[13px] font-semibold text-brand-blue underline"
            >
              Get help
            </a>
          </div>
        </Card>
      </div>
    </Shell>
  );
}

function appendOrgSetFlag(dest: string): string {
  const sep = dest.includes("?") ? "&" : "?";
  return `${dest}${sep}org_set=1`;
}
