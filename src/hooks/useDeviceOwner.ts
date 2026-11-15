import { useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { isApiMockMode } from "@/lib/api/core";

export interface DeviceOwner { userId: string; orgId: string }

const MOCK_OWNER: DeviceOwner = { userId: "mock-user", orgId: "mock-org" };

function useClerkOwner(): DeviceOwner | null {
  const { isLoaded, userId, orgId } = useAuth();
  return useMemo(() => (isLoaded && userId && orgId ? { userId, orgId } : null), [isLoaded, userId, orgId]);
}

const useMockOwner = (): DeviceOwner | null => MOCK_OWNER;

/**
 * Who held files belong to: the signed-in person and their active workspace. Null until
 * Clerk has loaded, and null without a person or an active workspace. Mock mode has one
 * fixed owner. The choice is made once, on a build-time constant.
 */
export const useDeviceOwner: () => DeviceOwner | null = isApiMockMode ? useMockOwner : useClerkOwner;
