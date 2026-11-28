"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/bridge/DSPrimitives";

export function CopyButton({ text, label = "Copy email address", size = "md" }: { text: string; label?: string; size?: "sm" | "md" }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      // Clipboard blocked: say so; the text stays selectable by hand.
      setState("failed");
    }
  };

  return (
    <>
      <Button variant="secondary" size={size} onClick={copy} aria-label={label} className="sm:flex-none">
        <Copy size={13} />
        {state === "copied" ? "Copied" : "Copy"}
      </Button>
      {state === "failed" && <span role="alert" className="text-[12px] text-ink-muted">Couldn&rsquo;t copy. Select the text and copy it.</span>}
    </>
  );
}
