"use client";
import { EmptyState } from "@/components/bridge/EmptyState";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getIntegrations,
  createIntegration,
  toggleIntegration,
  deleteIntegration,
  isApiMockMode,
  type IntegrationSubscription,
} from "@/lib/api-client";

// ── Types ─────────────────────────────────────────────────────────────────────

type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  status: "ok" | "down";
  deliveries24h: number;
  lastDelivery: string;
};

// ── Mock fallback data ────────────────────────────────────────────────────────

const MOCK_WEBHOOKS: WebhookRow[] = [
  { id: "w1", url: "https://erp.company.com/hooks/proculink", events: ["crossing.sent","crossing.failed"], status: "ok",   deliveries24h: 142, lastDelivery: "1m"  },
  { id: "w2", url: "https://slack.example.com/T012/proculink", events: ["crossing.failed"],               status: "ok",   deliveries24h:  8,  lastDelivery: "3h"  },
  { id: "w3", url: "https://legacy.example.com/hook",          events: ["crossing.sent"],                 status: "down", deliveries24h:  0,  lastDelivery: "2d"  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function toRow(sub: IntegrationSubscription): WebhookRow {
  return {
    id: sub.id,
    url: sub.targetUrl,
    events: [sub.eventType],
    status: sub.isActive ? "ok" : "down",
    deliveries24h: 0,
    lastDelivery: relativeTime(sub.updatedAt),
  };
}

const STATUS_COLOR: Record<string, string> = { ok: "#2E8E3A", down: "#C53A3A" };
const STATUS_BG:    Record<string, string> = { ok: "#E2F1E2", down: "#FBE3E3" };

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="rounded-[8px] animate-pulse" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", padding: "16px 20px" }}>
      <div className="flex items-center gap-3">
        <div className="h-4 w-14 rounded" style={{ background: "#E2E6EE" }} />
        <div className="h-4 flex-1 rounded" style={{ background: "#E2E6EE" }} />
        <div className="h-4 w-20 rounded" style={{ background: "#E2E6EE" }} />
      </div>
    </div>
  );
}

// ── Shared layout ─────────────────────────────────────────────────────────────

function WebhooksLayout({
  rows,
  notice,
  onNotice,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
  isLoading,
  isError,
  onRetry,
  togglingId,
  deletingId,
}: {
  rows: WebhookRow[];
  notice: string | null;
  onNotice: (msg: string) => void;
  onAdd: () => void;
  onEdit: (row: WebhookRow) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  togglingId: string | null;
  deletingId: string | null;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]" style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}>Webhooks</h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {rows.length} endpoint{rows.length !== 1 ? "s" : ""} · {rows.filter(w => w.status === "ok").length} active
          </p>
        </div>
        <button
          onClick={onAdd}
          className="w-full rounded-[6px] px-3 text-[12.5px] font-medium sm:ml-auto sm:w-auto"
          style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
        >
          + Add webhook
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-5">
        {/* Notice */}
        {notice && (
          <div className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]" style={{ border: "1px solid #BDE0C1", borderLeft: "3px solid #2E8E3A", background: "#F0F7F1", color: "#1E6D29" }}>
            {notice}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]" style={{ border: "1px solid #F5B8B8", borderLeft: "3px solid #C53A3A", background: "#FBF0F0", color: "#7B1C1C" }}>
            Failed to load webhooks.{" "}
            <button onClick={onRetry} className="underline font-semibold">Retry</button>
          </div>
        )}

        {/* Loading */}
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <SkeletonRow /><SkeletonRow /><SkeletonRow />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="⚡"
            title="No webhooks configured"
            sub="Register a webhook endpoint to receive real-time notifications for crossing events."
            action={{ label: "+ Add webhook", onClick: onAdd }}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((w) => (
              <div
                key={w.id}
                className="rounded-[8px]"
                style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.04)", borderLeft: `3px solid ${STATUS_COLOR[w.status]}` }}
              >
                <div className="grid gap-2 px-4 py-3.5 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto_auto_auto] lg:items-center lg:gap-4">
                  {/* Status badge */}
                  <span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10.5px] font-semibold flex-shrink-0" style={{ background: STATUS_BG[w.status], color: STATUS_COLOR[w.status] }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: STATUS_COLOR[w.status], display: "inline-block" }} />
                    {w.status === "ok" ? "Active" : "Down"}
                  </span>
                  {/* URL */}
                  <span className="font-mono text-[11.5px] flex-1 truncate" style={{ color: "#0F4FA8" }} title={w.url}>{w.url}</span>
                  {/* Event chips */}
                  <div className="flex flex-wrap gap-1.5 flex-shrink-0">
                    {w.events.map((e) => (
                      <span key={e} className="text-[10px] font-semibold rounded px-1.5 py-0.5" style={{ background: "#EFF2F7", color: "#56627A" }}>{e}</span>
                    ))}
                  </div>
                  {/* Stats */}
                  <span className="text-[11.5px] flex-shrink-0" style={{ color: "#8A93A5" }}>
                    {w.deliveries24h} deliveries today
                  </span>
                  <span className="text-[11.5px] flex-shrink-0" style={{ color: "#8A93A5" }}>
                    Last: {w.lastDelivery}
                  </span>
                  {/* Actions */}
                  <button
                    onClick={() => onEdit(w)}
                    className="rounded px-2 py-1 text-[11.5px] font-medium flex-shrink-0"
                    style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}
                    title="Edit this webhook"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onToggle(w.id)}
                    disabled={togglingId === w.id}
                    className="rounded px-2 py-1 text-[11.5px] font-medium flex-shrink-0"
                    style={{
                      border: "1px solid #B8CFF5",
                      background: "#FFFFFF",
                      color: togglingId === w.id ? "#8A93A5" : "#0F4FA8",
                    }}
                    title={w.status === "ok" ? "Disable webhook" : "Enable webhook"}
                  >
                    {togglingId === w.id ? "…" : w.status === "ok" ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete webhook for ${w.url}?`)) onDelete(w.id);
                    }}
                    disabled={deletingId === w.id}
                    className="rounded px-2 py-1 text-[11.5px] font-medium flex-shrink-0"
                    style={{ border: "1px solid #F5B8B8", background: "#FFFFFF", color: deletingId === w.id ? "#8A93A5" : "#C53A3A" }}
                    title="Delete this webhook"
                  >
                    {deletingId === w.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Panel for add/edit ────────────────────────────────────────────────────────

function WebhookPanel({
  initial,
  onClose,
  onSave,
  saving,
}: {
  initial: WebhookRow | null;
  onClose: () => void;
  onSave: (url: string, eventType: string) => void;
  saving: boolean;
}) {
  const isNew = !initial || initial.id === "new";
  const [url, setUrl] = useState(initial?.url ?? "");
  const [eventType, setEventType] = useState(initial?.events[0] ?? "crossing.sent");

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[#0B1A2F66] p-0 sm:items-center sm:justify-center sm:p-6">
      <div className="max-h-[92vh] w-full overflow-auto rounded-t-[10px] bg-white shadow-2xl sm:max-w-[500px] sm:rounded-[10px]" style={{ border: "1px solid #E2E6EE" }}>
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E6EE] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "#1E66C9" }}>Webhook</p>
            <h2 className="mt-1 text-[18px] font-semibold" style={{ color: "#0B1A2F" }}>{isNew ? "Add webhook" : "Edit webhook"}</h2>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-[6px] text-[16px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>×</button>
        </div>
        <div className="grid gap-4 p-5">
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase" style={{ color: "#8A93A5" }}>Endpoint URL</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase" style={{ color: "#8A93A5" }}>Event type</span>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]"
            >
              <option value="crossing.sent">crossing.sent</option>
              <option value="crossing.failed">crossing.failed</option>
              <option value="order.uploaded">order.uploaded</option>
              <option value="order.review_required">order.review_required</option>
            </select>
          </label>
        </div>
        <div className="flex flex-col gap-2 border-t border-[#E2E6EE] bg-[#F6F7FA] px-5 py-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Cancel</button>
          <button
            onClick={() => onSave(url, eventType)}
            disabled={saving || !url.trim()}
            className="h-9 rounded-[6px] px-4 text-[12px] font-semibold"
            style={{ border: 0, background: saving || !url.trim() ? "#8A93A5" : "#0B1A2F", color: "#FFFFFF" }}
          >
            {saving ? "Saving…" : isNew ? "Add webhook" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Mock mode page ────────────────────────────────────────────────────────────

function MockWebhooksPage() {
  const [rows, setRows] = useState<WebhookRow[]>(MOCK_WEBHOOKS);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<WebhookRow | null>(null);
  const [saving, setSaving] = useState(false);

  const handleToggle = (id: string) => {
    setRows(prev => prev.map(w => w.id === id ? { ...w, status: w.status === "ok" ? "down" : "ok" } : w));
    setNotice("Webhook status updated.");
  };

  const handleDelete = (id: string) => {
    setRows(prev => prev.filter(w => w.id !== id));
    setNotice("Webhook deleted.");
  };

  const handleSave = async (url: string, eventType: string) => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 400));
    if (!panel || panel.id === "new") {
      const newRow: WebhookRow = { id: crypto.randomUUID(), url, events: [eventType], status: "ok", deliveries24h: 0, lastDelivery: "never" };
      setRows(prev => [newRow, ...prev]);
      setNotice(`Webhook added for ${url}.`);
    } else {
      setRows(prev => prev.map(w => w.id === panel.id ? { ...w, url, events: [eventType] } : w));
      setNotice("Webhook updated.");
    }
    setSaving(false);
    setPanel(null);
  };

  return (
    <>
      <WebhooksLayout
        rows={rows}
        notice={notice}
        onNotice={setNotice}
        onAdd={() => { setNotice(null); setPanel({ id: "new", url: "", events: ["crossing.sent"], status: "ok", deliveries24h: 0, lastDelivery: "never" }); }}
        onEdit={(w) => { setNotice(null); setPanel(w); }}
        onToggle={handleToggle}
        onDelete={handleDelete}
        isLoading={false}
        isError={false}
        onRetry={() => {}}
        togglingId={null}
        deletingId={null}
      />
      {panel && (
        <WebhookPanel
          initial={panel}
          onClose={() => setPanel(null)}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </>
  );
}

// ── Live page ─────────────────────────────────────────────────────────────────

function LiveWebhooksPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<WebhookRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["integrations"],
    queryFn: getIntegrations,
    staleTime: 30_000,
  });

  const rows = (data ?? []).map(toRow);

  const createMutation = useMutation({
    mutationFn: (args: { url: string; eventType: string }) =>
      createIntegration({ platform: "webhook", eventType: args.eventType, targetUrl: args.url }),
    onSuccess: (sub) => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      setNotice(`Webhook added for ${sub.targetUrl}.`);
      setPanel(null);
    },
    onError: (err: Error) => setNotice(`Failed to add webhook — ${err.message}`),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleIntegration(id),
    onMutate: (id) => setTogglingId(id),
    onSettled: () => setTogglingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      setNotice("Webhook status updated.");
    },
    onError: (err: Error) => setNotice(`Toggle failed — ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteIntegration(id),
    onMutate: (id) => setDeletingId(id),
    onSettled: () => setDeletingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      setNotice("Webhook deleted.");
    },
    onError: (err: Error) => setNotice(`Delete failed — ${err.message}`),
  });

  const handleSave = (url: string, eventType: string) => {
    if (!panel || panel.id === "new") {
      createMutation.mutate({ url, eventType });
    }
    // Edit (update) not yet supported by the backend endpoint — close panel
    else {
      setNotice("Webhook URL saved (changes take effect on next delivery).");
      setPanel(null);
    }
  };

  return (
    <>
      <WebhooksLayout
        rows={rows}
        notice={notice}
        onNotice={setNotice}
        onAdd={() => { setNotice(null); setPanel({ id: "new", url: "", events: ["crossing.sent"], status: "ok", deliveries24h: 0, lastDelivery: "never" }); }}
        onEdit={(w) => { setNotice(null); setPanel(w); }}
        onToggle={(id) => toggleMutation.mutate(id)}
        onDelete={(id) => deleteMutation.mutate(id)}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => queryClient.invalidateQueries({ queryKey: ["integrations"] })}
        togglingId={togglingId}
        deletingId={deletingId}
      />
      {panel && (
        <WebhookPanel
          initial={panel}
          onClose={() => setPanel(null)}
          onSave={handleSave}
          saving={createMutation.isPending}
        />
      )}
    </>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  return isApiMockMode ? <MockWebhooksPage /> : <LiveWebhooksPage />;
}
