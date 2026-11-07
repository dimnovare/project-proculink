"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/bridge/DSPrimitives";

export function CopyButton({ text, label = "Copy email address" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked; the text stays selectable by hand.
    }
  };

  return (
    <Button variant="secondary" size="md" onClick={copy} aria-label={label} className="sm:flex-none">
      <Copy size={13} />
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}
