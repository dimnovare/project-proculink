/** Settings' three tabs, in the board's order. API keys live under Workspace, "For developers" (`tab=api` opens it there). The ids are code; only the labels are words a person reads. */
export const SETTINGS_TABS = [
  { id: "org", label: "Workspace" },
  { id: "destinations", label: "Destinations" },
  { id: "billing", label: "Plan & billing" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

/** One value of a known id; `connectors` (the retired Notifications tab) and `api` (now under Workspace) are "org"; anything else is "org". */
export function readSettingsTab(params: { get(name: string): string | null; getAll(name: string): string[] }): SettingsTab {
  if (params.getAll("tab").length !== 1) return "org";
  const tab = params.get("tab");
  return SETTINGS_TABS.find((t) => t.id === tab)?.id ?? "org";
}

export const settingsAddress = (tab: SettingsTab) => `/settings?tab=${tab}`;
