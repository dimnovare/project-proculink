/**
 * Guide authoring kit — the components a `.mdx` guide imports.
 *
 * Usage in a guide (client or admin):
 *
 *   import { Step, Prereqs, IfThisFails, Outcome, GuideShot } from "@/components/help/guide";
 *
 * The layout itself is not imported by guides: the MDX wrapper picks it up from
 * the guide registry (see src/lib/guides.ts + src/mdx-components.tsx).
 */
export { Step, IfThisFails, Prereqs, Outcome } from "./Step";
export { GuideShot } from "./GuideShot";
export { useGuide } from "./GuideContext";
export { default as GuideLayout } from "./GuideLayout";
