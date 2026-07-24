"use client";

import Link from "next/link";
import { useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Supplier } from "@/types/procurement";

/**
 * SupplierPicker — the searchable supplier combobox.
 *
 * Lifted out of UploadWorkbench so the assign-supplier banner on an unrouted order
 * uses the SAME picker the upload route bar does, rather than a second control with
 * its own filtering and its own idea of what an empty search looks like.
 *
 * Built from the primitives the app already ships for the Command Palette (Radix
 * Popover + cmdk Command — no new dependency): the trigger ellipsizes long names and
 * carries `title` with the full name, and the panel lists suppliers alphabetically
 * with type-to-filter search. Rows show the name only: the suppliers list endpoint
 * returns id + name, and inventing a channel/format subtitle from data we don't have
 * loaded would violate offer⇔works.
 */
export function SupplierPicker({
  suppliers,
  value,
  onChange,
  counterpartyNoun,
  counterpartyPlural,
  triggerId = "upload-supplier",
}: {
  suppliers: Supplier[];
  value: string;
  onChange: (id: string) => void;
  counterpartyNoun: string;
  counterpartyPlural: string;
  /** DOM id of the trigger, so a caller's <label htmlFor> points at this control. */
  triggerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = suppliers.find((s) => s.id === value) ?? null;
  // Alphabetical, locale-aware — stable and scannable however the API orders them.
  const sorted = [...suppliers].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={triggerId}
          role="combobox"
          aria-haspopup="listbox"
          title={selected?.name}
          className="flex w-full items-center gap-2 rounded-[9px] pl-3 pr-2.5 text-left text-[13px] transition-colors min-h-[36px]"
          style={{
            border: `1px solid ${selected ? "#1E6D29" : "#CBD0DA"}`,
            background: "#FFFFFF",
            color: selected ? "#1E6D29" : "#0B1A2F",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <span className="min-w-0 flex-1 truncate">
            {selected ? selected.name : `Choose a ${counterpartyNoun}…`}
          </span>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M4 6l4 4 4-4" stroke="#5E6779" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="p-0"
        style={{
          width: "var(--radix-popover-trigger-width)",
          minWidth: 260,
          borderColor: "#E5E8EE",
          boxShadow: "0 8px 24px rgba(11,26,47,0.14)",
        }}
      >
        <Command
          loop
          // Item values are supplier GUIDs (names may collide), so filter on
          // the NAME (passed via keywords) with a plain substring match —
          // fuzzy-scoring GUIDs would surface junk results.
          filter={(_itemValue, search, keywords) => {
            const name = (keywords ?? []).join(" ").toLowerCase();
            return name.includes(search.trim().toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={`Search ${counterpartyPlural.toLowerCase()}…`} className="h-10 text-[13px]" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-[12.5px]" style={{ color: "#5E6779" }}>
              No {counterpartyPlural.toLowerCase()} match that search.
            </CommandEmpty>
            <CommandGroup>
              {sorted.map((s) => {
                const isSelected = s.id === value;
                return (
                  <CommandItem
                    key={s.id}
                    value={s.id}
                    keywords={[s.name]}
                    title={s.name}
                    onSelect={() => {
                      onChange(s.id);
                      setOpen(false);
                    }}
                    className="cursor-pointer gap-2 rounded-[6px] px-2.5 py-2 text-[13px]"
                    style={{ color: isSelected ? "#1E6D29" : "#0B1A2F", fontWeight: isSelected ? 600 : 400 }}
                  >
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                        <path d="M2.5 6.2l2.2 2.2 4.8-5" stroke="#1E6D29" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {/* Quiet escape hatch to manage the list — mirrors the empty-state CTA. */}
          <div className="px-2.5 py-2" style={{ borderTop: "1px solid #EEF0F4" }}>
            <Link
              href="/library/suppliers"
              className="text-[12px] font-semibold"
              style={{ color: "#1E6D29" }}
              onClick={() => setOpen(false)}
            >
              Add a {counterpartyNoun} →
            </Link>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default SupplierPicker;
