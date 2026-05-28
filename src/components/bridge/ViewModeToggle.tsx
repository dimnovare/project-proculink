"use client";

import { useViewMode, type ViewMode } from "@/lib/view-mode";

/**
 * Topbar toggle that flips between Default (novice) and Expert (veteran) view
 * modes. Sticky in localStorage via useViewMode. Designed to live in
 * BridgeTopbar's right-side controls cluster.
 *
 * Visual: pill-shaped two-segment control matching the existing topbar dark
 * chrome (`#10243E` / `#1C2F49`). Active segment lifts to white-on-navy.
 */
export function ViewModeToggle() {
  const [mode, setMode] = useViewMode();

  return (
    <div
      role="group"
      aria-label="View density"
      className="hidden sm:flex items-center"
      style={{
        height: 28,
        background: "#10243E",
        border: "1px solid #1C2F49",
        borderRadius: 99,
        padding: 2,
        gap: 2,
      }}
    >
      <Segment
        label="Default"
        title="Friendly density — recommended for new users"
        active={mode === "default"}
        onSelect={() => setMode("default")}
      />
      <Segment
        label="Expert"
        title="Dense density — more columns, hotkeys enabled"
        active={mode === "expert"}
        onSelect={() => setMode("expert")}
      />
    </div>
  );
}

function Segment({
  label,
  title,
  active,
  onSelect,
}: {
  label: string;
  title: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={title}
      aria-pressed={active}
      style={{
        height: 22,
        padding: "0 10px",
        borderRadius: 99,
        border: "none",
        background: active ? "#FFFFFF" : "transparent",
        color: active ? "#0B1A2F" : "#7C8DA6",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: active ? "default" : "pointer",
        transition: "background-color 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.color = "#C5D2E4";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.color = "#7C8DA6";
      }}
    >
      {label}
    </button>
  );
}

/**
 * Helper for components that want to read the mode imperatively (e.g. inside a
 * useEffect) without subscribing.
 */
export type { ViewMode };
