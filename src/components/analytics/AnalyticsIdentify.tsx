"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { identifyUser, setGroup } from "@/lib/analytics";

/** Identify + group on sign-in. Lives inside AppClerkProvider, so the public pages never load Clerk for it. */
export function AnalyticsIdentify() {
  const { user, isLoaded } = useUser();
  useEffect(() => {
    if (!isLoaded || !user) return;
    identifyUser(user.id, {
      email_domain: (user.primaryEmailAddress?.emailAddress ?? "").split("@")[1] ?? "",
    });
    const orgId = user.publicMetadata?.organisationId as string | undefined;
    if (orgId) setGroup(orgId, {});
  }, [isLoaded, user]);
  return null;
}
