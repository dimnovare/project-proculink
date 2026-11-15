"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SavedMark, SettingsPanel } from "@/components/settings/SettingsPrimitives";
import { getNotificationSettings, saveNotificationSettings, type NotificationSettings } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { useDocumentEngine } from "@/hooks/useDocumentEngine";

const KEY = ["notification-settings"];

/** Settings › Workspace "Tell me when". Renders only on a successful response that names an email; loading, any error and a null email are all blank. */
export function NotificationEmailSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: KEY, queryFn: getNotificationSettings, enabled: useDocumentEngine() === "on", retry: false, refetchOnWindowFocus: false,
  });
  const save = useMutation({
    mutationFn: saveNotificationSettings,
    onSuccess: (next) => qc.setQueryData<NotificationSettings>(KEY, next),
  });
  if (!data || typeof data.email !== "string") return null;

  const toggle = (patch: Partial<Pick<NotificationSettings, "onReview" | "onFailure">>) =>
    save.mutate({ onReview: data.onReview, onFailure: data.onFailure, ...patch });
  const row = (label: string, checked: boolean, key: "onReview" | "onFailure") => (
    <label className="flex min-h-10 items-start gap-3 py-[9px] text-[14.5px] text-ink max-[639px]:min-h-11">
      <input type="checkbox" className="mt-0.5 size-[18px] shrink-0 accent-brand-blue" checked={checked} disabled={save.isPending}
        onChange={(e) => toggle({ [key]: e.target.checked })} />
      <span>{label}</span>
    </label>
  );

  return (
    <SettingsPanel id="s-tell" title="Tell me when" side={save.isSuccess && <SavedMark />}>
      <div role="group" aria-labelledby="s-tell-email" className="flex flex-col gap-1">
        <h3 id="s-tell-email" className="m-0 text-[13px] font-semibold text-ink-muted">By email</h3>
        <div className="flex flex-col">
          {row("When documents are waiting for review", data.onReview, "onReview")}
          {row("When a document can't be read or sent", data.onFailure, "onFailure")}
        </div>
        <p className="m-0 text-[13px] text-ink-muted">Emails go to {data.email}, at most one every 15 minutes.</p>
      </div>
      {save.isError && <p role="alert" className="m-0 text-[13px] text-danger-text">{documentRefusalMessage(save.error)}</p>}
    </SettingsPanel>
  );
}
