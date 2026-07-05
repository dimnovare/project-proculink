// Server-Component boundary around the client `HelpArticleShell` chrome.
//
// WHY THIS EXISTS — the help-article <title> SEO fix.
//
// Every /help/<slug> page is a `page.mdx` that does `export const metadata =
// { title, description }`. @next/mdx compiles that export correctly (it is
// present in the built page module), but Next.js only wires a page.mdx's
// `metadata` into the route's rendered <title>/<meta> when the MDX `wrapper`
// (set in src/mdx-components.tsx) is NOT itself a Client Component.
//
// `HelpArticleShell` is `"use client"` (it uses usePathname + useState). When
// it was set directly as the MDX `wrapper`, the page module's default export
// became a client boundary, Next's metadata collection skipped the segment,
// and every article fell through to the generic root-layout title
// ("ProcuLink"). Interposing this thin *server* component as the wrapper keeps
// the page module a server module — so `metadata` is collected and each
// article emits its own <title> + description — while the client chrome still
// renders normally as this component's child.
//
// Keep this a Server Component (no "use client"): that is the entire fix.
import HelpArticleShell from "./HelpArticleShell";

export default function HelpArticleShellServer({
  children,
}: {
  children: React.ReactNode;
}) {
  return <HelpArticleShell>{children}</HelpArticleShell>;
}
