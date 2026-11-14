// mapperCommands — the decoupled bridge between the Command Palette (Cmd+K) and the
// mounted ThreePaneMapper. The palette has no handle on the mapper's React tree, so power
// commands ("Jump to field", "Jump to a field's transform") are delivered as a
// window-dispatched CustomEvent("plk:mapper"). The mapper, wherever it is mounted (since 2026-11-13 only the
// flow's Advanced view), listens for that event and acts on the field it currently has
// selected/hovered. Keeping the command list here (pure, dispatch-injected) means it is
// unit-testable without a DOM and the palette stays a thin caller.

/** The single window event channel the palette dispatches and the mapper listens for. */
export const MAPPER_EVENT = "plk:mapper" as const;

/** The kinds of action a palette command asks the mapper to perform. */
export type MapperCommandKind =
  | "jump-to-field"          // focus the source-field search so the user can jump to any field
  | "add-transform";          // open the manipulator dropdown on the focused output field

export interface MapperCommandEvent {
  kind: MapperCommandKind;
}

/** A palette command shaped for CommandPalette.buildIndex (id/group/label/icon + run). */
export interface MapperCommand {
  id: string;
  group: "Mapper";
  label: string;
  sub: string;
  icon: string;
  color: string;
  run: () => void;
}

/**
 * Build the mapper power commands. `dispatch` is injected so this is pure + testable; the live
 * caller passes a thin wrapper that emits a window CustomEvent (see dispatchMapper). ids
 * a13..a14 continue the CommandPalette's hardcoded action numbering (a1..a12). (The old
 * "Add a custom field" command was dropped with the 2-column rebuild — the value-less
 * canonical spine column it targeted no longer exists; output fields are added from the
 * Outgoing pane's "+ Add output field" in the connection editor.)
 */
export function buildMapperCommands(dispatch: (e: MapperCommandEvent) => void): MapperCommand[] {
  const cmd = (
    id: string,
    label: string,
    sub: string,
    icon: string,
    kind: MapperCommandKind,
  ): MapperCommand => ({
    id,
    group: "Mapper",
    label,
    sub,
    icon,
    color: "#6F4FCE",
    run: () => dispatch({ kind }),
  });

  return [
    cmd("a13", "Jump to field",            "Search and focus a field in the mapper",   "⌖", "jump-to-field"),
    cmd("a14", "Jump to a field's transform", "Scroll to the focused output field",    "ƒ", "add-transform"),
    // a15 "Switch output format" went 2026-11-14: the flow preview ignores the format, so
    // cycling it changed nothing.
    // a16 "Edit output as a template" went 2026-11-13 with the order review's template
    // editor, which was its only handler.
  ];
}

/** Emit a mapper command on the window event bus (no-op outside the browser). */
export function dispatchMapper(e: MapperCommandEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MapperCommandEvent>(MAPPER_EVENT, { detail: e }));
}
