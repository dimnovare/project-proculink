// sidebar-auto-collapse — a tiny window-event channel that lets a screen ask
// the desktop BridgeSidebar to collapse to its 66px icon rail WITHOUT touching
// the user's persisted preference (localStorage "pl-side" stays untouched).
//
// Used by the Review screen's Full-document sub-mode at <1440px (batch 9
// Phase C): the triptych needs ~1120px, so the expanded 220px sidebar would
// force horizontal scrolling. The requester MUST restore (false) on exit —
// SpineReview does so from the same effect's cleanup.

export const SIDEBAR_AUTO_COLLAPSE_EVENT = "pl:sidebar-auto-collapse";

export function setSidebarAutoCollapse(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<boolean>(SIDEBAR_AUTO_COLLAPSE_EVENT, { detail: collapsed }));
}
