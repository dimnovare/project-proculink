import { useOrganization } from "@clerk/nextjs";
import { isApiMockMode } from "@/lib/api/core";

/** `known` is false until Clerk has loaded; callers treat "not known" as "not admin". */
export function useIsOrgAdmin() {
  const { membership, isLoaded } = useOrganization();
  return { known: isApiMockMode || isLoaded, isAdmin: isApiMockMode || membership?.role === "org:admin" };
}
