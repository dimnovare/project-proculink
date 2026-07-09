import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";
import Link from "next/link";
// The MDX `wrapper` must be a Server Component so each page.mdx's
// `export const metadata` reaches the rendered <title>/<meta>. This server
// shell renders the client `HelpArticleShell` chrome inside it. See
// HelpArticleShellServer.tsx for the full rationale (the help SEO fix).
import HelpArticleShell from "@/components/help/HelpArticleShellServer";

/**
 * MDX renderer for the Help center articles (the only `.mdx` pages in the app).
 *
 * Previously this returned `{ ...components }` with no overrides, so every MDX
 * element rendered as a bare tag. Combined with Tailwind's Preflight base reset
 * — which strips heading font-size/weight/margins — articles collapsed to flat,
 * flush-left, single-size text. Mapping each element to a Bridge Layer–styled
 * component restores real typography; `wrapper` adds the article chrome.
 *
 * Tokens are inlined (rather than relying on @tailwindcss/typography, which is
 * not registered as a Tailwind plugin) so styling stays self-contained and
 * matches the locked navy/blue/green + Bricolage/Inter system exactly.
 */

const INK = "#0B1A2F";
const BODY = "#3C4860";
const DISPLAY = "'Bricolage Grotesque', Inter, sans-serif";

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
  "font-medium underline underline-offset-2 transition-colors text-[#1E6D29] hover:text-[#2E8E3A] rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#28C55E] focus-visible:ring-offset-2";

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

    h1: ({ children }) => (
      <h1
        style={{
          fontFamily: DISPLAY,
          fontSize: "clamp(28px, 4.5vw, 36px)",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          lineHeight: 1.15,
          color: INK,
          margin: "0 0 16px",
          scrollMarginTop: 80,
        }}
      >
        {children}
      </h1>
    ),

    h2: ({ children }) => (
      <h2
        id={slugify(children)}
        style={{
          fontFamily: DISPLAY,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          lineHeight: 1.3,
          color: INK,
          margin: "36px 0 10px",
          scrollMarginTop: 80,
        }}
      >
        {children}
      </h2>
    ),

    h3: ({ children }) => (
      <h3
        id={slugify(children)}
        style={{
          fontFamily: DISPLAY,
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          lineHeight: 1.35,
          color: INK,
          margin: "28px 0 8px",
          scrollMarginTop: 80,
        }}
      >
        {children}
      </h3>
    ),

    h4: ({ children }) => (
      <h4
        style={{
          fontFamily: DISPLAY,
          fontSize: 15,
          fontWeight: 600,
          color: INK,
          margin: "22px 0 6px",
        }}
      >
        {children}
      </h4>
    ),

    p: ({ children }) => (
      <p style={{ fontSize: 15, lineHeight: 1.72, color: BODY, margin: "14px 0" }}>
        {children}
      </p>
    ),

    a: MdxLink,

    ul: ({ children }) => (
      <ul
        className="marker:text-[#28C55E]"
        style={{
          margin: "14px 0",
          paddingLeft: 22,
          listStyleType: "disc",
          fontSize: 15,
          lineHeight: 1.72,
          color: BODY,
        }}
      >
        {children}
      </ul>
    ),

    ol: ({ children }) => (
      <ol
        className="marker:text-[#28C55E] marker:font-semibold"
        style={{
          margin: "14px 0",
          paddingLeft: 22,
          listStyleType: "decimal",
          fontSize: 15,
          lineHeight: 1.72,
          color: BODY,
        }}
      >
        {children}
      </ol>
    ),

    li: ({ children }) => <li style={{ margin: "6px 0" }}>{children}</li>,

    code: ({ children }) => (
      <code
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: "0.86em",
          fontWeight: 500,
          background: "#EFF2F7",
          color: "#0F4FA8",
          padding: "2px 6px",
          borderRadius: 5,
          border: "1px solid #E4E8F0",
        }}
      >
        {children}
      </code>
    ),

    pre: ({ children }) => (
      // `help-scroll` gives the horizontally-scrollable code block a persistent
      // slim scrollbar (globals.css) so a clipped-but-scrollable sample reads as
      // "scroll for more" rather than "cut off" — the wide format samples (EDI/
      // XML/JSON) overflow 390px on mobile and touch scrollbars otherwise hide.
      <pre
        className="help-scroll"
        style={{
          background: "#F6F8FB",
          border: "1px solid #E2E6EE",
          borderRadius: 8,
          padding: "14px 16px",
          overflowX: "auto",
          margin: "18px 0",
          fontSize: 13,
          lineHeight: 1.6,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          color: INK,
        }}
      >
        {children}
      </pre>
    ),

    blockquote: ({ children }) => (
      <blockquote
        style={{
          margin: "18px 0",
          padding: "12px 16px",
          background: "#DCFCE7",
          borderLeft: "3px solid #28C55E",
          borderRadius: "0 8px 8px 0",
          color: "#2E3B52",
          fontSize: 14,
        }}
      >
        {children}
      </blockquote>
    ),

    strong: ({ children }) => (
      <strong style={{ fontWeight: 600, color: INK }}>{children}</strong>
    ),

    em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,

    hr: () => (
      <hr style={{ border: "none", height: 1, background: "#E2E6EE", margin: "32px 0" }} />
    ),

    table: ({ children }) => (
      <div style={{ overflowX: "auto", margin: "18px 0" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          {children}
        </table>
      </div>
    ),

    th: ({ children }) => (
      <th
        style={{
          textAlign: "left",
          padding: "8px 12px",
          background: "#F6F7FA",
          borderBottom: "1px solid #E2E6EE",
          color: INK,
          fontWeight: 600,
        }}
      >
        {children}
      </th>
    ),

    td: ({ children }) => (
      <td style={{ padding: "8px 12px", borderBottom: "1px solid #EEF0F4", color: BODY }}>
        {children}
      </td>
    ),

    img: (props) => (
      <img
        {...props}
        alt={props.alt ?? ""}
        style={{
          maxWidth: "100%",
          height: "auto",
          borderRadius: 8,
          border: "1px solid #E2E6EE",
          margin: "18px 0",
        }}
      />
    ),
  };
}
