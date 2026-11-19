import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";
import Link from "next/link";
// The MDX `wrapper` must be a Server Component so each page.mdx's
// `export const metadata` reaches the rendered <title>/<meta>. This server
// shell renders the client `HelpArticleShell` chrome inside it. See
// HelpArticleShellServer.tsx for the full rationale (the help SEO fix).
import HelpArticleShell from "@/components/help/HelpArticleShellServer";

/**
 * MDX renderer for the Help centre articles (the only `.mdx` pages in the app).
 *
 * Tailwind's Preflight strips heading sizes and margins, so each MDX element is
 * mapped to a styled tag; `wrapper` adds the article chrome. Colours are token
 * classes only: ink text, blue links, neutral borders. Body text inherits its size.
 */

// Derive a stable text from heading children for anchor ids / deep links.
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function slugify(node: ReactNode): string {
  return textOf(node)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const linkClass =
  "font-medium text-brand-blue-deep underline underline-offset-2 hover:text-ink rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2";

// No size here: public pages get 17px from SITE_PAGE, the in-app help panel and admin runbooks keep their own.
const BODY_TEXT = "leading-[1.65] text-ink";
const HEADING = "font-display font-semibold text-ink scroll-mt-20";

function MdxLink({
  href = "",
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={linkClass}>
        {children}
      </Link>
    );
  }
  const external = /^https?:/.test(href);
  return (
    <a
      href={href}
      className={linkClass}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,

    wrapper: HelpArticleShell,

    // A help article's body opens with `# Title`, the registry title. The page already prints that title as
    // its one H1 (HelpArticleShell), so here it renders nothing; the in-app help panel shows it through its own `h1`.
    h1: () => null,

    h2: ({ children }) => (
      <h2 id={slugify(children)} className={`${HEADING} mb-3 mt-10 text-[26px] leading-[1.2] tracking-[-0.02em]`}>
        {children}
      </h2>
    ),

    h3: ({ children }) => (
      <h3 id={slugify(children)} className={`${HEADING} mb-2 mt-7 text-[20px] leading-[1.3]`}>
        {children}
      </h3>
    ),

    h4: ({ children }) => <h4 className={`${HEADING} mb-1.5 mt-5 text-[17px]`}>{children}</h4>,

    p: ({ children }) => <p className={`${BODY_TEXT} my-4`}>{children}</p>,

    a: MdxLink,

    ul: ({ children }) => <ul className={`${BODY_TEXT} my-4 list-disc pl-6 marker:text-ink-muted`}>{children}</ul>,

    ol: ({ children }) => (
      <ol className={`${BODY_TEXT} my-4 list-decimal pl-6 marker:font-semibold marker:text-ink-muted`}>{children}</ol>
    ),

    li: ({ children }) => <li className="my-1.5">{children}</li>,

    code: ({ children }) => (
      <code className="rounded-[5px] border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[0.86em] font-medium text-ink">
        {children}
      </code>
    ),

    pre: ({ children }) => (
      // `help-scroll` gives the horizontally-scrollable code block a persistent
      // slim scrollbar (globals.css) so a clipped-but-scrollable sample reads as
      // "scroll for more" rather than "cut off" — the wide format samples (EDI/
      // XML/JSON) overflow 390px on mobile and touch scrollbars otherwise hide.
      // tabIndex: a box that scrolls must be reachable by keyboard (axe scrollable-region-focusable);
      // the code inside keeps the block's 14px instead of shrinking to inline code's 0.86em.
      <pre tabIndex={0} className="help-scroll my-5 overflow-x-auto rounded-[8px] border border-border bg-bg px-4 py-3.5 font-mono text-[14px] leading-[1.6] text-ink [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[1em]">
        {children}
      </pre>
    ),

    blockquote: ({ children }) => (
      <blockquote className="my-5 border-l-2 border-border-strong py-1 pl-4 text-ink-muted">{children}</blockquote>
    ),

    strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,

    em: ({ children }) => <em className="italic">{children}</em>,

    hr: () => <hr className="my-8 h-px border-0 bg-border" />,

    table: ({ children }) => (
      <div tabIndex={0} className="my-5 overflow-x-auto">
        <table className="w-full border-collapse text-[15.5px] leading-[1.45]">{children}</table>
      </div>
    ),

    th: ({ children }) => (
      <th className="border-b border-border bg-bg px-3 py-2 text-left font-semibold text-ink">{children}</th>
    ),

    td: ({ children }) => <td className="border-b border-border px-3 py-2 align-top text-ink">{children}</td>,

    img: (props) => (
      <img {...props} alt={props.alt ?? ""} className="my-5 h-auto max-w-full rounded-[8px] border border-border" />
    ),
  };
}
