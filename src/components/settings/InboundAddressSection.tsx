"use client";

/**
 * InboundAddressSection — the addresses buyers email purchase orders to.
 *
 * REPLACES the old `InboundEmailRow`, which built `${slug}@orders.proculink.eu` in the browser from
 * the organisation slug. That row could not be right after the backend started issuing addresses
 * (`ProcuLink.Api/Controllers/SettingsController.cs`, backend PR 190): it showed ONE address, with
 * no expiry — but the slug address is now a `legacy_slug` row carrying a hard 90-day stop, and the
 * real current address is a minted one the browser cannot derive. It also could not reflect a
 * rotation or a revocation, because it never asked the server. It asserted a working address it had
 * not verified, which is the exact defect class this file is written against.
 *
 * THE HONESTY RULES THIS SCREEN IS BOUND BY. Every "there is nothing here" must be something the UI
 * actually observed:
 *   • while loading  → a skeleton. Never "no addresses".
 *   • on a failed load → "we could not read them", and explicitly NOT "mail has stopped" — a failed
 *     GET says nothing about whether mail is still arriving.
 *   • `address === null` → the row's ciphertext could not be opened. The address is NOT gone and may
 *     still be accepting mail, so it renders as un-displayable and stays revocable. Never blank.
 *   • `lastUsedAt === null` → we have no record, which is not the same as "never used". The line is
 *     omitted rather than guessed.
 *
 * NON-ADMIN. Rotate and revoke are `[RequireOrgAdmin]`. Following the house pattern (frontend PR
 * 127, `src/lib/planGate.ts`), controls are NOT pre-disabled and no Clerk role is read: the refusal
 * is caught from the 403 and rendered as `orgAdminMessage()`, with no action link, because the fix
 * is another person and there is nowhere to send them.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus } from "lucide-react";
import { Button } from "@/components/bridge/DSPrimitives";
import { isOrgAdminRefusal, orgAdminMessage } from "@/lib/planGate";
import { formatDate } from "@/lib/format-date";
import { Card } from "@/components/bridge/layout/Card";
import {
  INBOUND_KIND_PRIMARY,
  daysUntil,
  getInboundAddresses,
  hasExpiry,
  inboundAddressState,
  revokeInboundAddress,
  rotateInboundAddress,
  type InboundAddress,
} from "@/lib/api/inboundEmail";

const INK = "var(--ink)";
const MUTED = "var(--ink-muted)";
const FAINT = "var(--ink-faint)";

const QUERY_KEY = ["inbound-addresses"];

/** Turns any thrown failure into a sentence, with the org-admin refusal checked FIRST. */
function actionErrorCopy(error: unknown): string {
  if (isOrgAdminRefusal(error)) return orgAdminMessage();
  return "That did not go through. Nothing was changed — try again in a moment.";
}

// ── Presentation helpers ────────────────────────────────────────────────────

type Tone = "current" | "warn" | "spent";

/**
 * What to call this address, and how loudly.
 *
 * An unrecognised `kind` deliberately gets a neutral "Active" rather than being folded into
 * "Current address": claiming a kind we do not know is how an unknown value ends up rendering as
 * the favourable one.
 */
function badgeFor(
  address: InboundAddress,
  isCurrent: boolean,
): { text: string; tone: Tone } {
  const state = inboundAddressState(address);
  if (state === "revoked") return { text: "Revoked", tone: "spent" };
  if (state === "expired") return { text: "Stopped working", tone: "spent" };
  if (hasExpiry(address)) return { text: "Older address", tone: "warn" };
  if (isCurrent) return { text: "Current address", tone: "current" };
  return { text: "Active", tone: "current" };
}

const TONE_STYLE: Record<Tone, { background: string; color: string }> = {
  current: { background: "var(--brand-green-soft)", color: "var(--brand-green-deep)" },
  warn: { background: "var(--amber-soft)", color: "var(--amber-text)" },
  spent: { background: "var(--surface-2)", color: MUTED },
};

/**
 * The consequence sentence for an address that carries a hard stop.
 *
 * Keyed on the expiry, not on the kind — see `hasExpiry`. Says what STOPS, not just when, because a
 * bare date is the failure this screen exists to prevent: an operator who reads "11 Nov 2026" and
 * not "orders stop arriving" has no reason to act.
 */
function expiryCopy(address: InboundAddress): string | null {
  if (!address.expiresAt) return null;
  const when = formatDate(address.expiresAt);
  const state = inboundAddressState(address);

  if (state !== "active") {
    return `Stopped working on ${when}. Purchase orders emailed to this address no longer arrive.`;
  }

  const days = daysUntil(address.expiresAt);
  const remaining =
    days === null ? "" : days <= 0 ? "" : days === 1 ? " — that is tomorrow" : ` — that is ${days} days away`;

  return (
    `This is your older address and it stops working on ${when}${remaining}. ` +
    `After that date, purchase orders emailed to it will not arrive. ` +
    `Give your buyers the current address before then.`
  );
}

// ── Copy affordance ─────────────────────────────────────────────────────────

function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked; the address stays selectable by hand.
    }
  };

  return (
    <Button
      variant="secondary"
      size="md"
      onClick={copy}
      aria-label="Copy email address"
      className="sm:flex-none"
    >
      <Copy size={13} />
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}

// ── One address ─────────────────────────────────────────────────────────────

function AddressRow({
  address,
  isCurrent,
  onRevoke,
  revoking,
  errorMessage,
}: {
  address: InboundAddress;
  isCurrent: boolean;
  onRevoke: () => void;
  revoking: boolean;
  errorMessage: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const badge = badgeFor(address, isCurrent);
  const expiry = expiryCopy(address);
  const state = inboundAddressState(address);
  const live = state === "active";

  return (
    <Card
      as="li"
      pad="13px 14px"
      radius={8}
      style={{ listStyle: "none" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          style={{
            ...TONE_STYLE[badge.tone],
            borderRadius: 999,
            padding: "2px 9px",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {badge.text}
        </span>
      </div>

      {/* The address itself — or an honest account of why it cannot be shown. */}
      {address.address ? (
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "9px 11px",
              color: live ? INK : FAINT,
              textDecoration: live ? "none" : "line-through",
              wordBreak: "break-all",
            }}
          >
            {address.address}
          </code>
          {live && <CopyAddressButton address={address.address} />}
        </div>
      ) : (
        <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.55, color: MUTED }}>
          This address cannot be displayed, so it cannot be copied. It may still be receiving
          purchase orders. Revoke it if you no longer want orders arriving at it.
          {address.prefix ? (
            <>
              {" "}
              It starts with{" "}
              <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: INK }}>
                {address.prefix}
              </code>
              .
            </>
          ) : null}
        </p>
      )}

      {expiry && (
        <p
          style={{
            margin: "9px 0 0",
            fontSize: 11.5,
            lineHeight: 1.55,
            color: live ? "var(--amber-text)" : MUTED,
          }}
        >
          {expiry}
        </p>
      )}

      {state === "revoked" && !expiry && (
        <p style={{ margin: "9px 0 0", fontSize: 11.5, lineHeight: 1.55, color: MUTED }}>
          {address.revokedAt
            ? `Revoked on ${formatDate(address.revokedAt)}. Purchase orders emailed to this address no longer arrive.`
            : "Revoked. Purchase orders emailed to this address no longer arrive."}
        </p>
      )}

      <p style={{ margin: "8px 0 0", fontSize: 11, color: FAINT }}>
        Added {formatDate(address.createdAt)}
        {/* Omitted entirely when null: no record is not the same as never used. */}
        {address.lastUsedAt ? ` · Last received an order ${formatDate(address.lastUsedAt)}` : ""}
      </p>

      {/* Revoking stops orders arriving, cannot be undone from here, and is silent to the
          sender — so it is a two-step action with the consequence stated before the click. */}
      {live &&
        (confirming ? (
          <div
            style={{
              marginTop: 10,
              borderRadius: 6,
              border: "1px solid var(--danger-border)",
              background: "var(--danger-soft)",
              padding: "10px 12px",
            }}
          >
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: INK }}>
              Revoke this address? Purchase orders emailed to it stop arriving from the next message
              onward. Senders are not told, so their orders simply never reach you. This cannot be
              undone — a revoked address cannot be switched back on.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button variant="danger" size="sm" onClick={onRevoke} disabled={revoking}>
                {revoking ? "Revoking…" : "Revoke this address"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={revoking}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2.5">
            <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
              Revoke
            </Button>
          </div>
        ))}

      {errorMessage && (
        <p role="status" style={{ margin: "9px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--danger)" }}>
          {errorMessage}
        </p>
      )}
    </Card>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

export function InboundAddressSection() {
  const qc = useQueryClient();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { data: addresses, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getInboundAddresses,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Both mutations answer with the whole updated list, so the cache is written from the response
  // rather than invalidated — the server's list is authoritative and one round trip is enough.
  const rotate = useMutation({
    mutationFn: rotateInboundAddress,
    onSuccess: (list) => qc.setQueryData(QUERY_KEY, list),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInboundAddress(id),
    onSuccess: (list) => {
      qc.setQueryData(QUERY_KEY, list);
      setRevokingId(null);
    },
  });

  const heading = (
    <>
      <p style={{ fontSize: 12.5, fontWeight: 600, color: INK, margin: 0 }}>Your inbound email address</p>
      <p style={{ fontSize: 11.5, color: MUTED, margin: "3px 0 10px", lineHeight: 1.5 }}>
        Send or forward purchase orders to this address — we read the attachment (or the email body)
        and turn it into an order automatically.
      </p>
    </>
  );

  const shell = (children: React.ReactNode) => (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--surface-2)",
        padding: "14px 16px",
        marginBottom: 16,
      }}
    >
      {heading}
      {children}
    </div>
  );

  // Loading — a skeleton, never a claim about what does or does not exist.
  if (isLoading) {
    return shell(
      <div role="status" aria-busy="true" className="grid gap-2">
        <span className="sr-only">Loading…</span>
        <div style={{ height: 38, borderRadius: 6, background: "var(--surface)" }} />
        <div style={{ height: 38, borderRadius: 6, background: "var(--surface)" }} />
      </div>,
    );
  }

  // Failed load — says what we could not do, and pointedly does NOT claim mail has stopped.
  if (isError) {
    return shell(
      <div
        style={{
          borderRadius: 6,
          border: "1px solid var(--danger-border)",
          borderLeft: "3px solid var(--danger)",
          background: "var(--surface)",
          padding: "12px 14px",
        }}
      >
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: INK }}>
          We could not load your email addresses
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 11.5, lineHeight: 1.55, color: MUTED }}>
          This is a problem reading them, not a change to them. Any orders already being emailed to
          your address are unaffected.
        </p>
        <div className="mt-2.5">
          <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Checking…" : "Try again"}
          </Button>
        </div>
      </div>,
    );
  }

  const rows = addresses ?? [];

  // The one to hand to buyers: the newest active minted address (the list arrives newest-first, and
  // rotating mints a new primary). Left undefined when nothing qualifies rather than crowning a row
  // that has not earned it.
  const currentId = rows.find(
    (a) => a.kind === INBOUND_KIND_PRIMARY && inboundAddressState(a) === "active",
  )?.id;

  // Live addresses first, server order preserved inside each group, so the address to copy is on top.
  const ordered = [...rows].sort((a, b) => {
    const rank = (x: InboundAddress) => (inboundAddressState(x) === "active" ? 0 : 1);
    return rank(a) - rank(b);
  });

  const rotateError = rotate.isError ? actionErrorCopy(rotate.error) : null;

  return shell(
    <>
      {ordered.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: MUTED }}>
          The server returned no email addresses for this workspace. That is unexpected — reload the
          page, and contact support if it keeps happening.
        </p>
      ) : (
        <ul style={{ display: "grid", gap: 10, margin: 0, padding: 0 }}>
          {ordered.map((a) => (
            <AddressRow
              key={a.id}
              address={a}
              isCurrent={a.id === currentId}
              revoking={revoke.isPending && revokingId === a.id}
              errorMessage={revoke.isError && revokingId === a.id ? actionErrorCopy(revoke.error) : null}
              onRevoke={() => {
                setRevokingId(a.id);
                revoke.mutate(a.id);
              }}
            />
          ))}
        </ul>
      )}

      {/* Rotation is additive on the server: the old address keeps working until it is revoked.
          Saying so is the whole point — an operator who thinks this is a cutover stops watching an
          address that is still live. */}
      <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <p style={{ margin: "0 0 8px", fontSize: 11.5, lineHeight: 1.55, color: MUTED }}>
          Need a different address? Creating one makes it your current address. Your existing
          addresses keep receiving purchase orders until you revoke them, so you can give buyers the
          new one before retiring the old.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => rotate.mutate()}
          disabled={rotate.isPending}
        >
          <Plus size={13} />
          {rotate.isPending ? "Creating…" : "Create a new address"}
        </Button>
        {rotateError && (
          <p role="status" style={{ margin: "9px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--danger)" }}>
            {rotateError}
          </p>
        )}
      </div>
    </>,
  );
}
