// src/components/onboarding/workspaceName.ts

/**
 * Pure derivation of a friendly default workspace name for the auto-create
 * onboarding path. Holds NO React/Clerk imports so it can be unit-tested in
 * isolation (mirrors the pure-derivation pattern in orgGate.ts).
 *
 * Precedence: first name → email local-part → generic fallback.
 */
export function deriveWorkspaceName(firstName?: string | null, email?: string | null): string {
  const f = firstName?.trim();
  if (f) return `${f}'s workspace`;
  const local = email?.split("@")[0]?.trim();
  if (local) return `${local}'s workspace`;
  return "My workspace";
}
