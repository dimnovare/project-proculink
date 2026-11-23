"use client";

import { useState } from "react";
import { scrollRegionProps } from "@/components/bridge/document/scrollRegion";
import { useSideScroll } from "@/components/marketing/TableScroller";

// A help article's code block: a Copy button, and a right-edge fade while a long line runs on.
// The MDX `pre` mapping renders it (src/mdx-components.tsx).

export function CodeBlock({ children }: { children?: React.ReactNode }) {
  const { ref, scrolls, onScroll, fade } = useSideScroll<HTMLPreElement>();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(ref.current?.innerText ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="relative my-5">
      <button
        type="button"
        onClick={copy}
        className="absolute right-1.5 top-1.5 z-10 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[8px] border border-border bg-surface px-3 text-[14px] font-semibold text-ink hover:border-ink"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {/* `help-scroll` keeps a slim scrollbar visible (globals.css). The code inside keeps the
          block's 14px instead of shrinking to inline code's 0.86em. */}
      <pre
        ref={ref}
        onScroll={onScroll}
        style={fade}
        {...scrollRegionProps("Code sample", scrolls)}
        className="help-scroll overflow-x-auto rounded-[8px] border border-border bg-bg py-3.5 pl-4 pr-24 font-mono text-[14px] leading-[1.6] text-ink [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[1em]"
      >
        {children}
      </pre>
    </div>
  );
}
