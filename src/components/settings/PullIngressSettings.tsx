"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiClient,
  getSftpSettings,
  updateSftpSettings,
  getS3Settings,
  updateS3Settings,
} from "@/lib/api-client";

const INK = "#0B1A2F";
const MUTED = "#56627A";
const FAINT = "#8A93A5";
const LINE = "#E2E6EE";
const GREEN = "#2E8E3A";
const DANGER = "#A52E2E";

const inputStyle: React.CSSProperties = {
  height: 36,
  width: "100%",
  border: `1px solid #D5DAEA`,
  borderRadius: 6,
  padding: "0 10px",
  fontSize: 13,
  color: INK,
  outline: "none",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: FAINT }}>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px] font-medium" style={{ color: INK }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function useSuppliers() {
  return useQuery({ queryKey: ["suppliers"], queryFn: () => apiClient.getSuppliers() });
}

function SupplierSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data: suppliers } = useSuppliers();
  return (
    <Field label="Default supplier (orders from this source are attributed to it)">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ ...inputStyle, background: "#FFF" }}
      >
        <option value="">Select a supplier…</option>
        {(suppliers ?? []).map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </Field>
  );
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-[10px]" style={{ border: `1px solid ${LINE}`, background: "#FFF", overflow: "hidden" }}>
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${LINE}`, background: "#F6F7FA" }}>
        <h3 className="text-[14px] font-semibold" style={{ color: INK }}>{title}</h3>
        <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>{subtitle}</p>
      </div>
      <div className="grid gap-4 p-5">{children}</div>
    </div>
  );
}

function Notice({ msg }: { msg: { kind: "ok" | "err"; text: string } | null }) {
  if (!msg) return null;
  const ok = msg.kind === "ok";
  return (
    <div className="rounded-[6px] px-3 py-2 text-[12.5px]" style={{
      background: ok ? "#ECFDF3" : "#FCEBEB",
      border: `1px solid ${ok ? "#A6E9BE" : "#F5C5C5"}`,
      color: ok ? "#1DAF50" : DANGER,
    }}>{msg.text}</div>
  );
}

function SaveBar({ onSave, saving, hint }: { onSave: () => void; saving: boolean; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <span className="text-[11px]" style={{ color: FAINT }}>{hint}</span>
      <button
        onClick={onSave}
        disabled={saving}
        className="rounded-[7px] px-3.5 text-[12.5px] font-semibold"
        style={{ height: 36, border: "none", background: saving ? FAINT : INK, color: "#FFF", cursor: "pointer" }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

const PLAN_HINT = "Available on the Integration plan and up. Secrets are encrypted and never shown again.";

// ── SFTP pull ─────────────────────────────────────────────────────────────────

export function SftpPullSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["sftp-settings"], queryFn: getSftpSettings, staleTime: 30_000 });

  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remoteDirectory, setRemoteDirectory] = useState("");
  const [defaultSupplierId, setDefaultSupplierId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled); setHost(data.host); setPort(data.port);
    setUsername(data.username); setRemoteDirectory(data.remoteDirectory);
    setDefaultSupplierId(data.defaultSupplierId);
  }, [data]);

  const save = useMutation({
    mutationFn: () => updateSftpSettings({
      enabled, host, port, username,
      password: password ? password : null, // blank → keep saved secret
      remoteDirectory, defaultSupplierId,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sftp-settings"] });
      setPassword("");
      setNotice({ kind: "ok", text: "SFTP pull settings saved." });
    },
    onError: (e: Error) => setNotice({ kind: "err", text: e.message }),
  });

  return (
    <Shell title="SFTP pull" subtitle="Poll a supplier/buyer SFTP folder for order files every few minutes and import them automatically.">
      <Toggle checked={enabled} onChange={setEnabled} label="Poll this SFTP folder for orders" />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
        <Field label="Host"><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="sftp.supplier.example" style={inputStyle} /></Field>
        <Field label="Port"><input type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 22)} style={inputStyle} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Username"><input value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} /></Field>
        <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={data?.hasPassword ? "•••••••• (leave blank to keep)" : "Password"} style={inputStyle} /></Field>
      </div>
      <Field label="Remote directory"><input value={remoteDirectory} onChange={(e) => setRemoteDirectory(e.target.value)} placeholder="/incoming/orders" style={inputStyle} /></Field>
      <SupplierSelect value={defaultSupplierId} onChange={setDefaultSupplierId} />
      <Notice msg={notice} />
      <SaveBar onSave={() => { setNotice(null); save.mutate(); }} saving={save.isPending} hint={PLAN_HINT} />
    </Shell>
  );
}

// ── S3 / R2 pull ──────────────────────────────────────────────────────────────

export function S3PullSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["s3-settings"], queryFn: getS3Settings, staleTime: 30_000 });

  const [enabled, setEnabled] = useState(false);
  const [bucketName, setBucketName] = useState("");
  const [keyPrefix, setKeyPrefix] = useState("");
  const [region, setRegion] = useState("");
  const [serviceUrl, setServiceUrl] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [defaultSupplierId, setDefaultSupplierId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled); setBucketName(data.bucketName); setKeyPrefix(data.keyPrefix);
    setRegion(data.region); setServiceUrl(data.serviceUrl ?? ""); setAccessKeyId(data.accessKeyId);
    setDefaultSupplierId(data.defaultSupplierId);
  }, [data]);

  const save = useMutation({
    mutationFn: () => updateS3Settings({
      enabled, bucketName, keyPrefix, region, accessKeyId,
      secretKey: secretKey ? secretKey : null,
      serviceUrl: serviceUrl ? serviceUrl : null,
      defaultSupplierId,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["s3-settings"] });
      setSecretKey("");
      setNotice({ kind: "ok", text: "S3/R2 pull settings saved." });
    },
    onError: (e: Error) => setNotice({ kind: "err", text: e.message }),
  });

  return (
    <Shell title="S3 / R2 pull" subtitle="Watch an S3 or Cloudflare R2 bucket prefix for order files and import new objects automatically.">
      <Toggle checked={enabled} onChange={setEnabled} label="Watch this bucket for orders" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bucket name"><input value={bucketName} onChange={(e) => setBucketName(e.target.value)} placeholder="orders-inbound" style={inputStyle} /></Field>
        <Field label="Key prefix (optional)"><input value={keyPrefix} onChange={(e) => setKeyPrefix(e.target.value)} placeholder="incoming/" style={inputStyle} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Region (use 'auto' for R2)"><input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="eu-west-1" style={inputStyle} /></Field>
        <Field label="Access key ID"><input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} style={inputStyle} /></Field>
      </div>
      <Field label="Endpoint URL (required for Cloudflare R2 / MinIO — leave blank for AWS S3)"><input value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} placeholder="https://<account-id>.r2.cloudflarestorage.com" style={inputStyle} /></Field>
      <Field label="Secret access key"><input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={data?.hasSecretKey ? "•••••••• (leave blank to keep)" : "Secret access key"} style={inputStyle} /></Field>
      <SupplierSelect value={defaultSupplierId} onChange={setDefaultSupplierId} />
      <Notice msg={notice} />
      <SaveBar onSave={() => { setNotice(null); save.mutate(); }} saving={save.isPending} hint={PLAN_HINT} />
    </Shell>
  );
}
