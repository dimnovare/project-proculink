"use client";

import { Suspense, useEffect, useRef, useState } from "react";
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
  // async, so latch it so we create the workspace at most once. On failure we
  // release the latch and fall back to the manual CreateOrganization form.
  const creatingRef = useRef(false);
  const [createError, setCreateError] = useState(false);

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
    if (action.kind === "activate" && setActive && !activatingRef.current) {
      activatingRef.current = true;
      void setActive({ organization: action.orgId }).then(() => {
        router.replace(appendOrgSetFlag(dest));
      });
    }
    // Zero-org user: auto-create a workspace with a friendly derived name (no
    // create-org form). createOrganization resolves to an OrganizationResource;
    // activate it, mark it auto-named (so the rename nudge can surface), then
    // forward into the app. On failure, release the latch and set createError
    // so the render falls back to the manual CreateOrganization form — never a
    // dead end.
    if (
      action.kind === "create" &&
      createOrganization &&
      setActive &&
      !creatingRef.current &&
      !createError
    ) {
      creatingRef.current = true;
      const name = deriveWorkspaceName(user?.firstName, user?.primaryEmailAddress?.emailAddress);
      void createOrganization({ name })
        .then((org) =>
          setActive({ organization: org.id }).then(() => {
            try { localStorage.setItem("ws-autonamed", org.id); } catch { /* storage may be blocked */ }
            router.replace(appendOrgSetFlag(dest));
          }),
        )
        .catch(() => {
          creatingRef.current = false;
          setCreateError(true);
        });
    }
  }, [bypass, authLoaded, isSignedIn, action, dest, router, setActive, createOrganization, createError, user]);

  // WP-32 follow-up (F3). This used to be a hand-rolled
  // `setTimeout(() => setTimedOut(true), 12_000)` rendering "Still setting
  // things up… / Retry". Three things were wrong with it: 12s is OVER the 10s
  // ceiling the rest of the app is held to; nothing is being set up when the
  // real cause is a dead sign-in script, so the copy was false on the page
  // every successful sign-in lands on; and "Retry" is the word the shared
  // pattern deliberately avoided. `loading` and `activate` are exactly the two
  // states that were treated as a stall, so "settled" is their negation.
  const settled = action.kind !== "loading" && action.kind !== "activate";

  return (
    <SignInServiceGate ready={settled} armed={!bypass}>
      <OrgGateContent action={action} createError={createError} dest={dest} />
    </SignInServiceGate>
  );
}

function OrgGateContent({
  action,
  createError,
  dest,
}: {
  action: ReturnType<typeof decideOrgGate>;
  createError: boolean;
  dest: string;
}) {
  if (action.kind === "create") {
    // Happy path: we auto-create the workspace in the effect above, so render
    // the spinner (NOT the form) while that runs. Only if creation FAILED do we
    // fall back to the manual CreateOrganization form so the user is never stuck.
    if (createError) {
      return (
        <Shell>
          <CreateOrganization afterCreateOrganizationUrl={appendOrgSetFlag(dest)} skipInvitationScreen />
        </Shell>
      );
    }
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

function appendOrgSetFlag(dest: string): string {
  const sep = dest.includes("?") ? "&" : "?";
  return `${dest}${sep}org_set=1`;
}
