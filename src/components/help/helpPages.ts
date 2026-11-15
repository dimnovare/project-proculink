import type * as React from "react";
import { HELP_ARTICLES } from "@/lib/help-articles";
import { GUIDES } from "@/lib/guides";

type HelpPageModule = { default: React.ComponentType<{ components?: Record<string, unknown> }> };

const HELP_PAGE = /^\/help\/(guides\/)?[a-z0-9-]+$/;

/** A help page's MDX module, loaded only when it is opened. Rejects for anything that is not an article or guide address. */
export function loadHelpPage(href: string): Promise<HelpPageModule> {
  if (!HELP_PAGE.test(href)) return Promise.reject(new Error(`Not a help page: ${href}`));
  return import(`@/app/(marketing)/help/${href.slice(6)}/page.mdx`);
}

/** The help pages the panel can open: every article and every live client guide. */
export function helpPageHrefs(): string[] {
  return [
    ...HELP_ARTICLES.map((a) => `/help/${a.slug}`),
    ...GUIDES.filter((g) => g.audience === "client" && g.status === "live").map((g) => g.href),
  ];
}
