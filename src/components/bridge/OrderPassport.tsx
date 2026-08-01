"use client";

// PO Passport — the provenance + acceptance record for a single order.
// Renders a Uploaded → Parsed → Validated → Mapped → Transformed → Delivered →
// (Accepted / Failed / Needs review) timeline derived from the live passport,
// plus the evidence behind each stage. "Download acceptance proof" exports the
// raw passport JSON returned by the API; PDF export is a marked TODO.

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiHttpError, apiClient } from "@/lib/api-client";
import type {
  PassportDto,
  PassportEvent,
  PassportMappingDecision,
  PassportDeliveryAttempt,
  PassportOutputArtifact,
} from "@/types/procurement";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

function fmtDateTime(at: string | null | undefined): string {
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" });
}

function timelineAt(timeline: PassportEvent[], ...keywords: string[]): string | null {
  for (const e of timeline) {
    const a = lc(e.action);
    if (keywords.some((k) => a.includes(k))) return e.at;
  }
  return null;
}

function hasTimeline(timeline: PassportEvent[], ...keywords: string[]): boolean {
  return timeline.some((e) => keywords.some((k) => lc(e.action).includes(k)));
}

// ─── Stage derivation ───────────────────────────────────────────────────────

type StageState = "done" | "current" | "pending" | "failed";
interface Stage {
  key: string;
  label: string;
  state: StageState;
  at: string | null;
  detail?: string;
}

/** Map the order/final status to the index of the last *completed* pipeline stage. */
const STATUS_RANK: Record<string, number> = {
  parsing: 0,          // uploaded done; parse in progress
  pending_review: 2,   // parsed + validated done; mapping needs attention
  ready: 3,            // mapped done; ready to transform
  transforming: 3,     // mapped done; transform in progress
  ready_to_deliver: 4, // transformed done; ready to deliver
  delivered: 5,        // delivered done
};

const PIPELINE = ["Uploaded", "Parsed", "Validated", "Mapped", "Transformed", "Delivered"];

interface DerivedTimeline {
  stages: Stage[];
  final: { label: string; state: StageState; detail?: string; at: string | null };
}

function deriveTimeline(p: PassportDto): DerivedTimeline {
  const fs = lc(p.finalStatus ?? p.order.status);
  const lineCount = p.canonical?.lineCount ?? 0;
  const hasOutput = !!p.outputArtifact;
  const attempts = p.deliveryAttempts ?? [];
  const resp = p.supplierResponse;
  const respOutcome = lc(resp?.outcome);

  const deliveredOk =
    fs.includes("delivered") ||
    respOutcome === "acknowledged" ||
    attempts.some((a) => {
      const s = lc(a.status);
      return s.includes("deliver") || s.includes("success") || s.includes("acknowled") || s === "ok" || s === "sent";
    });
  const deliveryFailed =
    fs.includes("delivery_failed") ||
    fs.includes("dead_letter") ||
    respOutcome === "rejected" ||
    (attempts.length > 0 && !deliveredOk && attempts.every((a) => {
      const s = lc(a.status);
      return s.includes("fail") || s.includes("error") || s.includes("reject");
    }));
  const transformFailed = fs.includes("transform_failed");
  const parseFailed = fs === "failed" || (fs.includes("parse") && fs.includes("fail"));
  const needsReview = fs.includes("review") || fs.includes("pending");

  // Last completed stage index, taking the higher of status rank and evidence.
  let reached = STATUS_RANK[fs] ?? 0;
  if (lineCount > 0) reached = Math.max(reached, 1);
  if (hasOutput) reached = Math.max(reached, 4);
  if (deliveredOk) reached = Math.max(reached, 5);

  // Where (if anywhere) the pipeline failed.
  let failedAt: number | null = null;
  if (parseFailed) failedAt = 1;
  else if (transformFailed) failedAt = 4;
  else if (deliveryFailed) failedAt = 5;

  const inProgress = failedAt == null && !deliveredOk && !needsReview;

  const at = (i: number): string | null => {
    switch (i) {
      case 0: return timelineAt(p.timeline, "upload", "creat") ?? p.order.createdAt;
      case 1: return timelineAt(p.timeline, "pars");
      case 2: return timelineAt(p.timeline, "valid");
      case 3: return timelineAt(p.timeline, "map", "resolv");
      case 4: return timelineAt(p.timeline, "transform") ?? p.outputArtifact?.createdAt ?? null;
      case 5: {
        const ack = attempts.find((a) => a.acknowledgedAt)?.acknowledgedAt;
        return timelineAt(p.timeline, "deliver") ?? ack ?? attempts[attempts.length - 1]?.attemptedAt ?? null;
      }
      default: return null;
    }
  };

  const detail = (i: number): string | undefined => {
    switch (i) {
      case 0: return p.sourceArtifact?.detectedFormat ? `${p.sourceArtifact.detectedFormat.toUpperCase()} source` : undefined;
      case 1: return lineCount > 0 ? `${lineCount} line${lineCount !== 1 ? "s" : ""} extracted` : undefined;
      case 2: {
        const errs = p.validationResults.filter((v) => v.passed === false || lc(v.severity ?? "") === "error").length;
        return errs > 0 ? `${errs} validation issue${errs !== 1 ? "s" : ""}` : undefined;
      }
      case 3: {
        const unresolved = p.mappingDecisions.filter((d) => lc(d.source) === "unresolved").length;
        return unresolved > 0 ? `${unresolved} unresolved` : p.mappingDecisions.length ? `${p.mappingDecisions.length} lines mapped` : undefined;
      }
      case 4: return p.outputArtifact?.format ? p.outputArtifact.format.toUpperCase() : undefined;
      case 5: {
        const a = attempts[attempts.length - 1];
        return a?.channel ? a.channel.toUpperCase() : undefined;
      }
      default: return undefined;
    }
  };

  const stages: Stage[] = PIPELINE.map((label, i) => {
    let state: StageState;
    if (failedAt === i) state = "failed";
    else if (i <= reached) state = "done";
    else if (i === reached + 1 && inProgress) state = "current";
    else state = "pending";
    return { key: label.toLowerCase(), label, state, at: at(i), detail: detail(i) };
  });

  // Final node.
  let final: DerivedTimeline["final"];
  if (respOutcome === "acknowledged") {
    final = { label: "Accepted", state: "done", at: resp?.acknowledgedAt ?? at(5), detail: resp?.responseCode != null ? `Response ${resp.responseCode}` : "Acknowledged by supplier" };
  } else if (respOutcome === "rejected") {
    final = { label: "Supplier rejected", state: "failed", at: resp?.acknowledgedAt ?? at(5), detail: resp?.rejectionReason ?? "The supplier read this order and refused it." };
  } else if (parseFailed || transformFailed || deliveryFailed) {
    const lastErr = attempts.map((a) => a.errorMessage || a.rejectionReason).filter(Boolean).pop();
    final = { label: "Failed", state: "failed", at: at(failedAt ?? 5), detail: lastErr ?? (p.finalStatus ?? p.order.status) };
  } else if (needsReview) {
    final = { label: "Needs review", state: "current", at: null, detail: "Resolve exceptions to continue" };
  } else if (deliveredOk) {
    final = { label: "Awaiting response", state: "current", at: at(5), detail: "Delivered — no supplier confirmation yet" };
  } else {
    final = { label: "In progress", state: "pending", at: null };
  }

  return { stages, final };
}

// ─── Visual atoms ───────────────────────────────────────────────────────────

const STATE_STYLE: Record<StageState, { ring: string; fill: string; text: string; glyph: string }> = {
  // `fill` carries the white ✓ glyph, so it is a TEXT background even though the
  // glyph is aria-hidden: #FFFFFF on #2E8E3A is 4.1613:1. --brand-green-btn is
  // the token this repo already uses for a solid green under white text (5.0244:1
  // — same move as the webhooks and settings primary buttons). `ring` stays
  // --brand-green: it is a 2px border, non-text, and clears the 3:1 floor.
  // failed's #B43838 already carries white at 5.8932:1 and is left alone.
  done:    { ring: "#2E8E3A", fill: "#297F34", text: "#1E6D29", glyph: "✓" },
  current: { ring: "#1E66C9", fill: "#FFFFFF", text: "#0F4FA8", glyph: "●" },
  pending: { ring: "#CBD0DA", fill: "#FFFFFF", text: "var(--ink-faint)", glyph: "" },
  failed:  { ring: "#B43838", fill: "#B43838", text: "#B43838", glyph: "✕" },
};

function Pct({ value }: { value: number }) {
  const pct = Math.round(value);
  const { bg, color } =
    pct >= 90 ? { bg: "#E9F1EA", color: "#1E6D29" } :
    pct >= 75 ? { bg: "#FAF1DD", color: "#8A5310" } :
                { bg: "#FBE3E3", color: "#B43838" };
  return (
    <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", background: bg, color, borderRadius: 3, padding: "2px 5px" }}>
      {pct}%
    </span>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section style={{ border: "1px solid #E5E8EE", borderRadius: 8, background: "#FFFFFF", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #E5E8EE", display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "#5E6779", margin: 0 }}>{title}</h3>
        {count != null && (
          <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", color: "var(--ink-faint)" }}>{count}</span>
        )}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </section>
  );
}

function Ref({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)" }}>{label}</span>
      <span style={{ fontSize: 11.5, fontFamily: "'JetBrains Mono',monospace", color: "#0B1A2F", wordBreak: "break-all" }}>{value || "—"}</span>
    </div>
  );
}

const SOURCE_BADGE: Record<string, { bg: string; color: string }> = {
  deterministic: { bg: "#E9F1EA", color: "#1E6D29" },
  ai:            { bg: "#F0EAFB", color: "#5E3DB0" },
  unresolved:    { bg: "#FBE3E3", color: "#B43838" },
};

function MappingRow({ d }: { d: PassportMappingDecision }) {
  const badge = SOURCE_BADGE[lc(d.source)] ?? { bg: "#F1F3F7", color: "#5E6779" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #F0F2F6", fontSize: 11.5 }}>
      <span style={{ width: 22, flexShrink: 0, color: "var(--ink-faint)", fontFamily: "'JetBrains Mono',monospace" }}>{d.lineNumber}</span>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#1E66C9", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{d.buyerCode || "—"}</span>
      <span style={{ color: "var(--ink-faint)", flexShrink: 0 }}>→</span>
      {/* Resolved code is #1E6D29, not #2E8E3A: 11.5px mono copy on the Section's
          #FFFFFF, where #2E8E3A is 4.1613:1 — under AA. #1E6D29 is 6.4128:1, and
          matches the #1E66C9 buyer code beside it (5.5275:1). */}
      <span style={{ fontFamily: "'JetBrains Mono',monospace", color: d.supplierCode ? "#1E6D29" : "#B43838", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{d.supplierCode || "unresolved"}</span>
      <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", background: badge.bg, color: badge.color, borderRadius: 3, padding: "2px 6px" }}>{d.source}</span>
      {d.confidence != null && <Pct value={d.confidence <= 1 ? d.confidence * 100 : d.confidence} />}
    </div>
  );
}

/**
 * The ONE attempt state in which the channel observed the supplier take the bytes. Everything
 * else only proves we tried — including the two states the backend documents as unknowable:
 * `dispatching` (the row is committed BEFORE the network write, purely as a crash backstop —
 * DeliveryService's own note says the reachable outcomes are "sent and accepted", "sent and
 * rejected" and "never sent", and it cannot tell them apart) and `unconfirmed` (the park,
 * whose reason reads "The artifact may have been sent, but the outcome was never observed").
 * Both reach the passport with a real artifact id and no dispatched-bytes fingerprint.
 */
function sendWasObserved(status: string): boolean {
  const s = lc(status);
  return s.includes("deliver") || s.includes("success") || s.includes("acknowled") || s === "ok";
}

/** The two states above, where "did anything go out?" has no answer yet — or ever. */
function outcomeIsUnknown(status: string): boolean {
  const s = lc(status);
  return s === "dispatching" || s === "unconfirmed";
}

/**
 * One honest sentence per failure. This used to be a single line telling the retention story
 * ("the link may have expired, or the file may have been removed…") for EVERY failure — shown
 * verbatim for 404 and 429, where it is simply untrue. The endpoint distinguishes them
 * (404 no such artifact for this order · 410 Gone blob purged per retention · 429 signed-URL
 * rate limit), so the copy does too.
 */
function downloadFailureMessage(err: unknown): string {
  const status = err instanceof ApiHttpError ? err.status : 0;
  if (status === 410) return "That copy is gone — it was removed under your data-retention setting.";
  if (status === 404) return "We have no stored copy of that file for this order.";
  if (status === 429) return "Too many download requests just now. Wait a moment, then try again.";
  if (status === 401 || status === 403) return "You do not have access to that file.";
  return "Couldn't get that file just now. Please try again.";
}

/**
 * One delivery attempt, with the two things a disputed delivery actually needs: the exact
 * file that went out, and the fingerprint recorded when it went out.
 *
 * The pairing is per attempt, never per order — an order can hold several artifacts and
 * several attempts, and a retry after a re-transform sends DIFFERENT bytes. `a.artifactId`
 * is the artifact this attempt dispatched; when the backend can't prove which one it was it
 * sends null, and we offer no download rather than handing the operator bytes we can't vouch
 * for. The generated-file comparison likewise only runs when this attempt sent the artifact
 * we're holding the hash for.
 *
 * The second axis is WHETHER anything went out at all. Only a status the channel confirmed
 * earns the words "what we sent"; every other state — a failure, a crashed in-flight row, a
 * parked unknown outcome — gets "what we tried to send", which is true in all of them.
 */
function DeliveryRow({
  a,
  orderId,
  generated,
}: {
  a: PassportDeliveryAttempt;
  orderId: string;
  generated: PassportOutputArtifact | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ok = sendWasObserved(a.status);
  const unknownOutcome = outcomeIsUnknown(a.status);
  const color = ok ? "#1E6D29" : lc(a.status).includes("fail") || lc(a.status).includes("reject") ? "#B43838" : "#B36D14";

  // Only comparable when this attempt sent the very artifact whose hash we hold.
  const comparable =
    !!generated && !!a.artifactId && !!a.artifactSha256 && !!generated.artifactSha256 &&
    generated.artifactId === a.artifactId;
  const matches = comparable && generated!.artifactSha256 === a.artifactSha256;

  async function handleDownload() {
    if (!a.artifactId) return;
    setError(null);

    // Open the tab INSIDE the click, while the browser still counts this as a user gesture.
    // Doing it after the await — as this used to — puts window.open outside the transient
    // activation: Safari refuses it outright, Chrome and Firefox drop it once the activation
    // window lapses, which a cold-start API round trip can outlive. The old code also never
    // checked the return value and caught only the fetch, so a blocked pop-up produced no
    // file, no error and no message at all.
    //
    // `noopener` is deliberately NOT passed: with it window.open returns null even when
    // nothing was blocked, which would make "blocked" indistinguishable from "fine". The
    // back-reference is severed by hand instead, before the tab is pointed anywhere.
    const tab = window.open("", "_blank");
    if (!tab) {
      setError("Your browser blocked the download window. Allow pop-ups for this site, then try again.");
      return;
    }
    try { tab.opener = null; } catch { /* hardened window — nothing to sever */ }

    setBusy(true);
    try {
      const { url } = await apiClient.getDownloadUrl(orderId, a.artifactId);
      tab.location.href = url;
    } catch (err) {
      try { tab.close(); } catch { /* already gone */ }
      setError(downloadFailureMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="delivery-attempt" style={{ padding: "8px 0", borderTop: "1px solid #F0F2F6", display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#5E6779", fontFamily: "'JetBrains Mono',monospace" }}>#{a.attemptNumber}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "capitalize" }}>{a.status || "—"}</span>
        {a.channel && <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>· {a.channel}</span>}
        {a.responseCode != null && <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", color: "var(--ink-faint)" }}>· {a.responseCode}</span>}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--ink-faint)" }}>{fmtDateTime(a.attemptedAt)}</span>
      </div>
      {a.destination && <div style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", color: "#5E6779", wordBreak: "break-all" }}>{a.destination}</div>}
      {(a.errorMessage || a.rejectionReason) && (
        <div style={{ fontSize: 11, color: "#B43838" }}>{a.errorMessage || a.rejectionReason}</div>
      )}

      {/* Proof of what went out */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
        {a.artifactId ? (
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            style={{
              height: 24, padding: "0 9px", borderRadius: 5, border: "1px solid #CBD8EC",
              background: "#F4F8FF", color: "#0F4FA8", fontSize: 10.5, fontWeight: 700,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Preparing…" : ok ? "↓ Download what we sent" : "↓ Download the file we tried to send"}
          </button>
        ) : (
          <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>
            No stored copy of what this attempt sent.
          </span>
        )}
        {unknownOutcome && (
          <span style={{ fontSize: 10.5, color: "#8A5310" }}>
            We do not know whether this file reached the supplier.
          </span>
        )}
        {comparable && (
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", borderRadius: 3, padding: "2px 6px", background: matches ? "#E9F1EA" : "#FBE3E3", color: matches ? "#1E6D29" : "#B43838" }}>
            {matches ? "Matches the file we generated" : "Does not match the file we generated"}
          </span>
        )}
      </div>

      {a.artifactSha256 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)" }}>
            {ok ? "Fingerprint of the file we sent (SHA-256)" : "Fingerprint of the file we tried to send (SHA-256)"}
          </span>
          <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", color: "#5E6779", wordBreak: "break-all" }}>
            {a.artifactSha256}
          </span>
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: "#B43838" }}>{error}</div>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function OrderPassport({ orderId }: { orderId: string }) {
  const [exported, setExported] = useState(false);

  const { data: passport, isLoading, isError, refetch } = useQuery({
    queryKey: ["order-passport", orderId],
    queryFn: () => apiClient.getOrderPassport(orderId),
    retry: 1,
    staleTime: 30_000,
  });

  function handleDownloadJson() {
    if (!passport) return;
    const blob = new Blob([JSON.stringify(passport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `passport-${passport.order.poNumber || passport.order.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2500);
  }

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 18, width: 220, background: "#E5E8EE", borderRadius: 4, marginBottom: 16 }} />
        <div style={{ display: "grid", gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ height: 40, background: "#F1F3F7", borderRadius: 8 }} />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !passport) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
        <div style={{ fontSize: 26, color: "#CBD0DA" }}>⊘</div>
        <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>Couldn&apos;t load the order history</p>
        <p className="text-[13px]" style={{ color: "#5E6779" }}>The history for this order is temporarily unavailable.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-[6px] px-4 text-[12.5px] font-semibold"
          style={{ height: 32, border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F" }}
        >
          ↻ Retry
        </button>
      </div>
    );
  }

  const { stages, final } = deriveTimeline(passport);
  const allNodes: Stage[] = [...stages, { key: "final", label: final.label, state: final.state, at: final.at, detail: final.detail }];

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-5 sm:px-6">
      {/* Header + proof actions */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h2 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B1A2F" }}>
            Order history
          </h2>
          <p className="text-[12.5px] mt-1" style={{ color: "#5E6779" }}>
            Full history for <span className="font-mono" style={{ color: "#0F4FA8" }}>{passport.order.poNumber}</span> — every stage, decision, and delivery attempt, with the supplier&apos;s response.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadJson}
            className="rounded-[6px] px-3 text-[12.5px] font-semibold"
            style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: "none", cursor: "pointer" }}
          >
            {exported ? "✓ Downloaded" : "↓ Download order record"}
          </button>
        </div>
      </div>

      {/* Two columns on desktop: timeline + evidence */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* Timeline */}
        <Section title="Timeline">
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", top: 8, bottom: 8, left: 8, width: 2, background: "linear-gradient(180deg,#1E66C9,#2E8E3A)", borderRadius: 2 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {allNodes.map((n) => {
                const s = STATE_STYLE[n.state];
                return (
                  <div key={n.key} style={{ position: "relative", paddingLeft: 28, paddingTop: 6, paddingBottom: 6 }}>
                    <div
                      aria-hidden
                      style={{
                        position: "absolute", left: 1, top: 8, width: 16, height: 16, borderRadius: "50%",
                        background: s.fill, border: `2px solid ${s.ring}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, fontWeight: 800, color: n.state === "current" ? s.ring : "#FFFFFF",
                        boxShadow: n.state === "current" ? `0 0 0 3px ${s.ring}22` : "none",
                      }}
                    >
                      {s.glyph}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: n.state === "pending" ? "var(--ink-faint)" : "#0B1A2F" }}>{n.label}</span>
                      {n.state === "current" && <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: s.text }}>in progress</span>}
                    </div>
                    {n.detail && <div style={{ fontSize: 11, color: n.state === "failed" ? "#B43838" : "#5E6779", marginTop: 1 }}>{n.detail}</div>}
                    {n.at && <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 1 }}>{fmtDateTime(n.at)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        {/* Evidence */}
        <div className="flex flex-col gap-5">
          {/* Artifacts */}
          <Section title="Source & output">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <Ref label="Source file" value={passport.sourceArtifact?.storageKey} />
                <Ref label="Detected format" value={passport.sourceArtifact?.detectedFormat?.toUpperCase()} />
              </div>
              <div className="flex flex-col gap-3">
                <Ref label="Output file" value={passport.outputArtifact?.fileKey} />
                <Ref label="Output format" value={passport.outputArtifact?.format?.toUpperCase()} />
                {/* The fingerprint recorded when the file was generated — what a downloaded
                    copy is checked against. Shown here rather than only per attempt because
                    it belongs to the file, not to any one send. */}
                <Ref label="Fingerprint of the file we generated (SHA-256)" value={passport.outputArtifact?.artifactSha256} />
              </div>
            </div>
            {passport.supplierProfile && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #E5E8EE", display: "flex", flexWrap: "wrap", gap: 16, fontSize: 11.5, color: "#5E6779" }}>
                <span>Protocol: <strong style={{ color: "#0B1A2F" }}>{passport.supplierProfile.protocol || "—"}</strong></span>
                <span>Profile output: <strong style={{ color: "#0B1A2F" }}>{passport.supplierProfile.outputFormat || "—"}</strong></span>
                {passport.supplierProfile.acceptedFormats?.length ? (
                  <span>Accepts: <strong style={{ color: "#0B1A2F" }}>{passport.supplierProfile.acceptedFormats.join(", ")}</strong></span>
                ) : null}
                {passport.supplierProfile.version && <span>v{passport.supplierProfile.version}</span>}
              </div>
            )}
          </Section>

          {/* Canonical summary */}
          {passport.canonical && (
            <Section title="Order summary">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Ref label="Lines" value={String(passport.canonical.lineCount)} />
                <Ref label="Total quantity" value={passport.canonical.totalQuantity != null ? String(passport.canonical.totalQuantity) : "—"} />
                <Ref label="Total value" value={passport.canonical.totalValue != null ? passport.canonical.totalValue.toLocaleString("en-IE", { minimumFractionDigits: 2 }) : "—"} />
                <Ref label="Currency" value={passport.canonical.currency} />
              </div>
            </Section>
          )}

          {/* Mapping decisions */}
          {passport.mappingDecisions.length > 0 && (
            <Section title="Mapping decisions" count={passport.mappingDecisions.length}>
              <div>{passport.mappingDecisions.map((d) => <MappingRow key={d.lineNumber} d={d} />)}</div>
            </Section>
          )}

          {/* Delivery attempts */}
          <Section title="Delivery attempts" count={passport.deliveryAttempts.length}>
            {passport.deliveryAttempts.length === 0 ? (
              <p className="text-[12.5px]" style={{ color: "var(--ink-faint)", margin: 0 }}>No delivery attempts yet.</p>
            ) : (
              <div>
                {passport.deliveryAttempts.map((a) => (
                  <DeliveryRow key={a.attemptNumber} a={a} orderId={orderId} generated={passport.outputArtifact} />
                ))}
              </div>
            )}
          </Section>

          {/* Supplier response */}
          <Section title="Supplier response">
            {passport.supplierResponse ? (
              <div className="flex flex-col gap-2 text-[12.5px]" style={{ color: "#5E6779" }}>
                <div>
                  Outcome: <strong style={{ color: lc(passport.supplierResponse.outcome) === "acknowledged" ? "#1E6D29" : lc(passport.supplierResponse.outcome) === "rejected" ? "#B43838" : "#0B1A2F", textTransform: "capitalize" }}>{passport.supplierResponse.outcome}</strong>
                  {passport.supplierResponse.responseCode != null && <span className="font-mono"> · {passport.supplierResponse.responseCode}</span>}
                </div>
                {passport.supplierResponse.acknowledgedAt && <div>Acknowledged: {fmtDateTime(passport.supplierResponse.acknowledgedAt)}</div>}
                {passport.supplierResponse.rejectionReason && <div style={{ color: "#B43838" }}>{passport.supplierResponse.rejectionReason}</div>}
              </div>
            ) : (
              <p className="text-[12.5px]" style={{ color: "var(--ink-faint)", margin: 0 }}>No supplier response recorded yet.</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
