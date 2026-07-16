"use client";

/**
 * ConnectorRequirementsPanel — Group V7
 *
 * Shows the manifest-driven field requirements for the currently selected
 * delivery protocol and provides an advisory "Check configuration" action
 * that calls POST /api/connector-manifests/{key}/validate-config.
 *
 * Rules:
 *  - ADDITIVE ONLY — does not touch the DeliveryConfigEditor save path.
 *  - Advisory only — never blocks or alters save/test-fire.
 *  - Never renders secret VALUES; only field name strings are shown.
 *  - Gate on isApiMockMode || clerkReady; disabled-undefined = loading.
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Info } from "lucide-react";
import { isApiMockMode } from "@/lib/api-client";
import {
  getConnectorManifest,
  validateConnectorConfig,
} from "@/lib/api/connectors";
import type { ValidateConnectorConfigResult } from "@/lib/api/types";
import type { DeliveryProtocol } from "@/lib/api/types";
import { Card } from "@/components/bridge/layout/Card";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a shallow copy of `obj` with keys whose value is null, undefined, or
 * an empty/whitespace-only string removed.
 *
 * This is applied before POSTing to validate-config so that fields left blank
 * in the UI (e.g. url:"") are correctly reported as missing by the backend,
 * rather than silently passing validation with an empty string value.
 *
 * It is a pure function with no side effects and does not touch the save path.
 */
export function stripEmptyValues(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => {
      if (v === null || v === undefined) return false;
      if (typeof v === "string" && v.trim() === "") return false;
      return true;
    }),
  );
}

function useClerkReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (isApiMockMode) { setReady(true); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clerk = (window as any).Clerk;
    if (clerk?.loaded) { setReady(true); return; }
    const handle = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).Clerk?.loaded) { setReady(true); clearInterval(handle); }
    }, 100);
    return () => clearInterval(handle);
  }, []);
  return ready;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ConnectorRequirementsPanelProps {
  /** Not used for data fetching in V7 — kept for future revisions that may need it. */
  supplierId: string;
  /** Current delivery protocol — drives the manifest fetch. */
  protocol: DeliveryProtocol;
  /**
   * Callback that returns the current (non-secret) config object.
   * This is buildConfigObject() from DeliveryConfigEditor.
   * Called lazily only when the user clicks "Check configuration".
   * Secret values are never passed; they live in buildCredentialsJson().
   */
  buildConfig: () => Record<string, unknown>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ConnectorRequirementsPanel({
  protocol,
  buildConfig,
}: ConnectorRequirementsPanelProps) {
  const clerkReady = useClerkReady();
  const enabled = isApiMockMode || clerkReady;

  // Collapsed state — details section is initially closed
  const [expanded, setExpanded] = useState(false);

  // Validate result state (advisory — never blocks save)
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<ValidateConnectorConfigResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Fetch the manifest for the current protocol
  const { data: manifest, isLoading, isError } = useQuery({
    queryKey: ["connector-manifest", protocol],
    queryFn: () => getConnectorManifest(protocol),
    enabled,
    staleTime: 5 * 60 * 1000, // manifests rarely change
    retry: 1,
  });

  // Reset check result when protocol changes
  const [lastCheckedProtocol, setLastCheckedProtocol] = useState<DeliveryProtocol | null>(null);
  if (lastCheckedProtocol !== protocol) {
    if (checkResult !== null || checkError !== null) {
      setCheckResult(null);
      setCheckError(null);
    }
    setLastCheckedProtocol(protocol);
  }

  async function handleCheck() {
    if (!manifest) return;
    setChecking(true);
    setCheckResult(null);
    setCheckError(null);
    try {
      const result = await validateConnectorConfig(protocol, stripEmptyValues(buildConfig()));
      setCheckResult(result);
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Validation request failed.");
    } finally {
      setChecking(false);
    }
  }

  // Derive field groups
  const requiredFields = manifest?.fields.filter((f) => f.required) ?? [];
  const secretFields = manifest?.fields.filter((f) => f.secret) ?? [];
  const optionalFields = manifest?.fields.filter((f) => !f.required && !f.secret) ?? [];

  if (!enabled || (isLoading && !manifest)) {
    return (
      <div
        className="rounded-[7px] px-3 py-2.5"
        style={{ border: "1px solid #E5E8EE", background: "#FBFCFE" }}
      >
        <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          Loading connector requirements...
        </p>
      </div>
    );
  }

  if (isError || !manifest) {
    // Silent degradation — the save path continues to work even when the manifest
    // endpoint is unavailable.
    return null;
  }

  return (
    <Card dense className="text-[12px]">
      {/* ── Header row ──────────────────────────────────────────────────── */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="connector-requirements-body"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        style={{ color: "#0B1A2F" }}
      >
        <Info size={13} style={{ color: "#2E8E3A", flexShrink: 0 }} aria-hidden="true" />
        <span className="flex-1 text-[12px] font-semibold">
          {manifest.displayName} — what this connector needs
        </span>
        {manifest.authType && (
          <span
            className="hidden text-[11px] sm:inline"
            style={{ color: "#5E6779" }}
          >
            {manifest.authType}
          </span>
        )}
        {expanded ? (
          <ChevronDown size={13} aria-hidden="true" style={{ color: "var(--ink-faint)", flexShrink: 0 }} />
        ) : (
          <ChevronRight size={13} aria-hidden="true" style={{ color: "var(--ink-faint)", flexShrink: 0 }} />
        )}
      </button>

      {/* ── Collapsible body ─────────────────────────────────────────────── */}
      {expanded && (
        <div id="connector-requirements-body" className="mt-3 grid gap-3">
          {/* Capabilities note */}
          {manifest.capabilities && (
            <p className="text-[11px]" style={{ color: "#5E6779" }}>
              {manifest.capabilities}
            </p>
          )}

          {/* Resend caveat — what happens if a send's outcome is ever unknown (a crash
              mid-delivery). Channels that can't tell a repeat is a repeat park the order
              for a human instead of silently resending it; see /help/exceptions-and-stuck-orders. */}
          {manifest.resendCaveat && (
            <p className="text-[11px]" style={{ color: "#5E6779" }}>
              <span className="font-semibold">If a send&apos;s outcome is ever unknown: </span>
              {manifest.resendCaveat}
            </p>
          )}

          {/* Required fields */}
          {requiredFields.length > 0 && (
            <FieldGroup title="Required fields" fields={requiredFields} />
          )}

          {/* Credential / secret fields */}
          {secretFields.filter((f) => !f.required).length > 0 && (
            <FieldGroup
              title="Credential fields (stored encrypted)"
              fields={secretFields.filter((f) => !f.required)}
              credentialNote
            />
          )}

          {/* Optional config fields */}
          {optionalFields.length > 0 && (
            <details>
              <summary
                className="cursor-pointer select-none text-[11px] font-semibold"
                style={{ color: "#5E6779" }}
              >
                Optional fields ({optionalFields.length})
              </summary>
              <div className="mt-2">
                <FieldGroup fields={optionalFields} />
              </div>
            </details>
          )}

          {/* Docs link */}
          {manifest.docsRef && (
            <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
              <a
                href={manifest.docsRef}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: "#2E8E3A" }}
                aria-label={`${manifest.displayName} documentation (opens in new tab)`}
              >
                {manifest.displayName} documentation
              </a>
            </p>
          )}

          {/* ── Check configuration ─────────────────────────────────────── */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <button
              type="button"
              onClick={handleCheck}
              disabled={checking}
              aria-label="Check the current delivery configuration against the connector's requirements (advisory only — does not affect save)"
              className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold"
              style={{
                border: "1px solid #D5DAEA",
                color: "#0B1A2F",
                background: "#FFF",
                opacity: checking ? 0.65 : 1,
                cursor: checking ? "not-allowed" : "pointer",
                flexShrink: 0,
              }}
            >
              {checking ? "Checking..." : "Check configuration"}
            </button>
            <p className="text-[11px] leading-snug" style={{ color: "var(--ink-faint)" }}>
              Advisory check — does not block save.
            </p>
          </div>

          {/* Validation result (advisory) */}
          {checkError && (
            <div
              className="flex items-start gap-2 rounded-[6px] px-3 py-2 text-[12px]"
              role="alert"
              style={{ background: "#FCEBEB", color: "#A52E2E", border: "1px solid #F5C5C5" }}
            >
              <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <span>{checkError}</span>
            </div>
          )}

          {checkResult && !checkError && (
            <div
              className="rounded-[6px] px-3 py-2"
              role="status"
              aria-live="polite"
              style={{
                background: checkResult.valid ? "#F0F7F1" : "#FFFBEB",
                border: `1px solid ${checkResult.valid ? "#CBE8CE" : "#F5DFA0"}`,
              }}
            >
              <div className="flex items-center gap-1.5">
                {checkResult.valid ? (
                  <CheckCircle2 size={13} style={{ color: "#1F6F2A", flexShrink: 0 }} aria-hidden="true" />
                ) : (
                  <AlertCircle size={13} style={{ color: "#A56B00", flexShrink: 0 }} aria-hidden="true" />
                )}
                <span
                  className="text-[12px] font-semibold"
                  style={{ color: checkResult.valid ? "#1F6F2A" : "#A56B00" }}
                >
                  {checkResult.valid ? "Looks complete" : "Configuration incomplete"}
                </span>
              </div>

              {checkResult.missing.length > 0 && (
                <p className="mt-1.5 text-[11px]" style={{ color: "#A56B00" }}>
                  <span className="font-semibold">Missing required: </span>
                  {checkResult.missing.join(", ")}
                </p>
              )}
              {checkResult.unknown.length > 0 && (
                <p className="mt-1 text-[11px]" style={{ color: "#5E6779" }}>
                  <span className="font-semibold">Not recognized: </span>
                  {checkResult.unknown.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── FieldGroup sub-component ──────────────────────────────────────────────────

interface FieldGroupProps {
  title?: string;
  fields: import("@/lib/api/types").ConnectorConfigField[];
  credentialNote?: boolean;
}

function FieldGroup({ title, fields, credentialNote = false }: FieldGroupProps) {
  return (
    <div className="grid gap-1.5">
      {title && (
        <p className="text-[11px] font-semibold uppercase" style={{ color: "var(--ink-faint)" }}>
          {title}
        </p>
      )}
      {credentialNote && (
        <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          These values are stored in the encrypted credential vault — the raw values are never exposed.
        </p>
      )}
      <div className="grid gap-1">
        {fields.map((field) => (
          <FieldRow key={field.name} field={field} />
        ))}
      </div>
    </div>
  );
}

// ── FieldRow sub-component ────────────────────────────────────────────────────

function FieldRow({ field }: { field: import("@/lib/api/types").ConnectorConfigField }) {
  return (
    <div
      className="flex flex-wrap items-start gap-x-2 gap-y-0.5 rounded-[5px] px-2 py-1.5"
      style={{ background: "#F6F7FA", border: "1px solid #E5E8EE" }}
    >
      <span className="font-mono text-[11px] font-semibold" style={{ color: "#0B1A2F" }}>
        {field.name}
      </span>
      <span className="text-[11px]" style={{ color: "#5E6779" }}>
        {field.label}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {field.required && (
          <span
            className="rounded px-1 py-0.5 text-[10px] font-semibold uppercase"
            style={{ background: "#FFF0E0", color: "#A56B00", border: "1px solid #F5DFA0" }}
          >
            Required
          </span>
        )}
        {field.secret && (
          <span
            className="rounded px-1 py-0.5 text-[10px] font-semibold uppercase"
            style={{ background: "#EDF2FF", color: "#2E5FAA", border: "1px solid #C7D8F5" }}
          >
            Secret
          </span>
        )}
        {field.type !== "string" && (
          <span
            className="rounded px-1 py-0.5 text-[10px] font-medium"
            style={{ background: "#F0F7F1", color: "#2E8E3A", border: "1px solid #CBE8CE" }}
          >
            {field.type}
          </span>
        )}
      </div>
      {field.helpText && (
        <p className="w-full text-[11px]" style={{ color: "var(--ink-faint)" }}>
          {field.helpText}
        </p>
      )}
    </div>
  );
}
