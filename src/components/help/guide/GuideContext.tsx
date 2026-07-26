"use client";

import { createContext, useContext } from "react";
import type { Guide } from "@/lib/guides";

/**
 * Ambient guide identity, so a component authored inside a `.mdx` guide does
 * not have to repeat the slug. `<GuideShot name="…" />` resolves its asset path
 * from this; nothing else needs it today.
 */
const GuideCtx = createContext<Guide | null>(null);

export const GuideProvider = GuideCtx.Provider;

export function useGuide(): Guide | null {
  return useContext(GuideCtx);
}
