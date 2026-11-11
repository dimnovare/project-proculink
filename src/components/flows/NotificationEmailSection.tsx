"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getNotificationSettings, saveNotificationSettings, type NotificationSettings } from "@/lib/api/documents";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import { useDocumentEngine } from "@/hooks/useDocumentEngine";

const KEY = ["notification-settings"];

/** Renders only on a successful response that names an email; loading, any error and a null email are all blank. */
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
    <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
      <input type="checkbox" checked={checked} disabled={save.isPending} onChange={(e) => toggle({ [key]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <section className="mb-6 flex flex-col gap-2">
      <h2 className="text-[14px] font-semibold text-ink">Email me</h2>
      <p className="text-[12px] text-ink-muted">Emails go to {data.email}, at most one every 15 minutes.</p>
      {row("When documents are waiting for review", data.onReview, "onReview")}
      {row("When a document can't be read or sent", data.onFailure, "onFailure")}
      {save.isSuccess && <p className="text-[12px] text-ink-muted">Saved</p>}
      {save.isError && <p role="alert" className="text-[12px] text-danger">{documentRefusalMessage(save.error)}</p>}
    </section>
  );
}
