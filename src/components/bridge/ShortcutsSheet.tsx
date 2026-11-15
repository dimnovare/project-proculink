"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useApple } from "@/hooks/useShortcut";
import { SHORTCUTS, keyWord, setSingleKeys, singleKeysOn } from "@/lib/shortcuts";

/** The keyboard shortcuts list (R14): non-modal, bottom-right, every row from SHORTCUTS, and the ? key's switch (R13). */
export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const apple = useApple();
  const [single, setSingle] = useState(singleKeysOn);
  useDialogA11y({ open: true, onClose, panelRef, modal: false });

  return (
    <section
      ref={panelRef}
      aria-labelledby="shortcuts-title"
      className="fixed bottom-[calc(var(--plk-tabbar-h)+16px)] left-4 right-4 z-popover rounded-card-lg border border-border-strong bg-surface text-ink shadow-lg sm:bottom-[calc(var(--plk-tabbar-h)+24px)] sm:left-auto sm:right-6 sm:w-[320px]"
    >
      <div className="flex items-center pl-4 pr-1.5 pt-1.5">
        <h2 id="shortcuts-title" className="flex-1 text-[14.5px] font-semibold">Keyboard shortcuts</h2>
        <button
          type="button"
          aria-label="Close keyboard shortcuts"
          onClick={onClose}
          className="flex size-10 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={16} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
      <dl className="flex flex-col px-4 pb-1">
        {SHORTCUTS.map((s) => (
          <div key={s.id} className="flex min-h-9 items-center gap-3 border-t border-border">
            <dt className="flex flex-[0_0_96px] gap-1">
              {s.keys.map((k) => (
                <kbd key={k} className="inline-flex h-6 min-w-6 items-center justify-center whitespace-nowrap rounded-[5px] border border-b-2 border-border-strong bg-surface px-1.5 font-mono text-[12.5px] text-ink">
                  {keyWord(k, apple)}
                </kbd>
              ))}
            </dt>
            <dd className="text-[13.5px]">{s.words}</dd>
          </div>
        ))}
      </dl>
      <label className="flex min-h-11 items-center gap-2 border-t border-border px-4 pb-1 text-[13.5px] text-ink-muted">
        <input
          type="checkbox"
          className="size-4"
          checked={single}
          onChange={(e) => { setSingleKeys(e.target.checked); setSingle(e.target.checked); }}
        />
        Open this list with the ? key
      </label>
    </section>
  );
}
