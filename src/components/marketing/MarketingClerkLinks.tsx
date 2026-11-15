"use client";

// The marketing header's sign-in probe. It is the ONLY marketing module that
// imports Clerk, and MarketingNav loads it with next/dynamic (ssr: false), so
// the ~140 kB Clerk chunk stays out of the public pages' first-load JS and the
// pages stay static: the server never knows who is visiting.
//
// It renders nothing. It only reports whether a session is signed in, and
// MarketingNav changes the words of its existing links in place, so no node is
// swapped and a keyboard user's focus is never dropped.

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";

export function MarketingClerkLinks({
  onSignedInChange,
}: {
  onSignedInChange: (signedIn: boolean) => void;
}): null {
  const { isLoaded, isSignedIn } = useUser();
  const signedIn = Boolean(isLoaded && isSignedIn);

  // Reports a state to the parent; it does not fetch anything.
  useEffect(() => {
    onSignedInChange(signedIn);
  }, [signedIn, onSignedInChange]);

  return null;
}
