"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useAuth,
  useOrganization,
  useOrganizationList,
  CreateOrganization,
  OrganizationList,
} from "@clerk/nextjs";
import { isApiMockMode, isQaBypass } from "@/lib/api-client";
import { decideOrgGate } from "@/components/onboarding/orgGate";

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
  const { organization } = useOrganization();
  // useOrganizationList returns a DISCRIMINATED UNION: in the not-loaded branch
  // `setActive` is undefined and `userMemberships.data` is undefined. The
  // `!setActive` / `?? []` / `data !== undefined` guards below are LOAD-BEARING —
  // do not "simplify" them away (mirrors the shipped AutoActivateOrg precedent).
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 12_000);
    return () => clearTimeout(t);
  }, []);

  // setActive is async; the effect below can re-run (re-render) before the org
  // becomes active, which would fire setActive again. Latch it so the activate
  // path invokes setActive at most once.
  const activatingRef = useRef(false);

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
  }, [bypass, authLoaded, isSignedIn, action, dest, router, setActive]);

  if (timedOut && (action.kind === "loading" || action.kind === "activate")) {
    return (
      <Shell>
        <div className="text-center text-sm" style={{ color: "var(--ink-muted)" }}>
          <p>Still setting things up…</p>
          <button type="button" onClick={() => router.refresh()} className="mt-3 underline">Retry</button>
        </div>
      </Shell>
    );
  }

  if (action.kind === "create") {
    return (
      <Shell>
        <CreateOrganization afterCreateOrganizationUrl={appendOrgSetFlag(dest)} skipInvitationScreen />
      </Shell>
    );
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
