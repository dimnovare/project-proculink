"use client";
import { Suspense, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useClerk, useOrganization, useUser } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { Card } from "@/components/bridge/layout/Card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { BillingSection } from "@/components/bridge/BillingSection";
import { SavedMark, SettingsPanel } from "@/components/settings/SettingsPrimitives";
import { Button, Pill } from "@/components/bridge/DSPrimitives";
import { membershipRoleLabel, nameInitials } from "@/components/bridge/UserChipMenu";
import { Failed, Quiet } from "@/components/flows/states";
import { COPY, documentRefusalMessage } from "@/lib/documentRefusals";
import {
  getBillingStatus,
  getApiKeys,
  createApiKey,
  revokeApiKey,
} from "@/lib/api-client";
import type { ApiKey } from "@/lib/api-client";
import { readSettingsTab, settingsAddress, SETTINGS_TABS } from "@/lib/settingsTabs";
import { isOrgAdminRefusal } from "@/lib/planGate";
import { planDisplayName, planName } from "@/lib/plans";
import { NotificationEmailSection } from "@/components/flows/NotificationEmailSection";
import { DestinationsSection } from "@/components/destinations/DestinationsSection";
import { formatDate } from "@/lib/format-date";

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageShell variant="wide"><PageHeader title="Settings" /></PageShell>}>
      <SettingsScreen />
    </Suspense>
  );
}

function SettingsScreen() {
  // The tab is the address: one known id, else Workspace. A press replaces the address with that tab alone.
  const tab = readSettingsTab(useSearchParams());
  const router = useRouter();
  const { organization } = useOrganization();
  const { data: billing } = useQuery({ queryKey: ["billing-status"], queryFn: getBillingStatus, staleTime: 60_000 });
  const orgName   = organization?.name ?? "…";
  // Until billing has loaded (or when it fails) the header names only the workspace.
  const planLabel = billing && planDisplayName(billing.plan);

  return (
    <PageShell variant="wide">
      <PageHeader title="Settings" sub={organization && (billing ? `${orgName}, on the ${planLabel}` : orgName)} />
      <nav aria-label="Settings sections" className="mb-5 flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--border)]">
        {SETTINGS_TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => router.replace(settingsAddress(t.id), { scroll: false })}
              className={`h-11 shrink-0 whitespace-nowrap border-b-2 px-3.5 text-[14px] max-[480px]:flex-1 max-[480px]:px-0.5 max-[480px]:text-[13.5px] ${
                on ? "border-brand-blue font-semibold text-ink" : "border-transparent font-medium text-ink-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
      {tab === "org"          && <OrgSection />}
      {tab === "destinations" && <DestinationsSection />}
      {tab === "billing"      && <BillingSection />}
      {tab === "api"          && <ApiKeysSection />}
    </PageShell>
  );
}

// Inline two-button confirm, scoped to the row: renders the trigger; a press swaps it for the prompt and
// "{confirmLabel} / Cancel".
function InlineConfirm({
  onConfirm,
  trigger,
  confirmLabel = "Confirm",
  prompt,
  fullWidth = false,
}: {
  onConfirm: () => void;
  trigger: (open: () => void) => ReactNode;
  confirmLabel?: string;
  prompt?: string;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) return <>{trigger(() => setOpen(true))}</>;
  return (
    <div role="group" aria-label={prompt ?? "Confirm action"} className={`flex flex-wrap items-center justify-end gap-1.5 ${fullWidth ? "w-full" : ""}`}>
      {prompt && <span className="mr-0.5 text-[13px] text-ink-muted">{prompt}</span>}
      <Button type="button" variant="danger" size="sm" className={fullWidth ? "flex-1" : undefined} onClick={() => { setOpen(false); onConfirm(); }}>
        {confirmLabel}
      </Button>
      <Button type="button" variant="secondary" size="sm" className={fullWidth ? "flex-1" : undefined} onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

// ── Failed write, said out loud ─────────────────────────────────────────────

/**
 * Copy for a Settings write that did not land. `stillTrue` leads and names the state the person is STILL in:
 * someone who presses Revoke on a leaked key and sees nothing, or a neutral "something went wrong", concludes
 * the key is dead. The role refusal is checked first: it is the one cause a retry cannot fix.
 */
function writeFailureCopy(error: unknown, stillTrue: string): string {
  const why = isOrgAdminRefusal(error)
    ? COPY.requires_org_admin
    : "We could not complete the change — try again in a moment.";
  return `${stillTrue} ${why}`;
}

/** Inline, row-scoped failure line. `role="alert"`: this is never ambient information. */
function WriteFailure({ children, className }: { children: ReactNode; className?: string }) {
  return <p role="alert" className={`mb-0 mt-2 text-[13px] font-medium leading-normal text-danger-text ${className ?? ""}`}>{children}</p>;
}

// ── Workspace tab ──────────────────────────────────────────────────────────

type Organization = NonNullable<ReturnType<typeof useOrganization>["organization"]>;

/** Name, People and "Tell me when" on the left; the fixed facts on the right. Name and People wait for Clerk's organisation. */
function OrgSection() {
  const { organization, memberships } = useOrganization({ memberships: { pageSize: 10 } });
  const { user } = useUser();
  const clerk = useClerk();
  const { data: billing } = useQuery({ queryKey: ["billing-status"], queryFn: getBillingStatus, staleTime: 60_000 });
  const people = memberships?.data;
  const fact = "flex flex-col gap-0.5 border-t border-border py-3 first:border-t-0 first:pt-0";

  let roster: ReactNode;
  if (memberships?.isError && !people?.length) roster = <p className="m-0 text-[14px] text-ink-muted">We couldn&apos;t load the people in this workspace.</p>;
  else if (!people || (memberships?.isLoading && !people.length)) roster = <Quiet>Loading people…</Quiet>;
  else
    roster = (
      <>
        <ul className="m-0 list-none border-b border-border p-0">
          {people.map((m) => {
            const u = m.publicUserData;
            const name = [u?.firstName, u?.lastName].filter(Boolean).join(" ") || u?.identifier || "";
            const role = membershipRoleLabel(m.role);
            return (
              <li key={m.id} className="flex items-center gap-3 border-t border-border py-3">
                <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[12.5px] font-bold text-ink-muted">
                  {nameInitials(name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 font-semibold text-ink">
                    {name}
                    {u?.userId === user?.id && <span className="font-normal text-ink-muted"> (you)</span>}
                  </p>
                  {u?.identifier && <p className="m-0 text-[13px] text-ink-muted [overflow-wrap:anywhere]">{u.identifier}</p>}
                </div>
                {role && <Pill tone="neutral">{role}</Pill>}
              </li>
            );
          })}
        </ul>
        {(memberships?.count ?? 0) > people.length && (
          <p className="m-0 text-[13px] text-ink-muted">{`${memberships!.count - people.length} more are listed under Invite or manage people.`}</p>
        )}
      </>
    );
  const count = people && !memberships?.isLoading ? memberships!.count : null;

  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex min-w-0 max-w-[800px] flex-[999_1_520px] flex-col gap-4">
        {organization && <WorkspaceName organization={organization} />}
        {organization && (
          <SettingsPanel
            id="s-people"
            title="People"
            sub={count === null ? undefined : count === 1 ? "1 person has access to this workspace." : `${count} people have access to this workspace.`}
            side={<Button type="button" variant="secondary" onClick={() => clerk.openOrganizationProfile()}>Invite or manage people</Button>}
          >
            {roster}
            <p className="m-0 text-[13px] text-ink-muted">Administrators can change workspace settings, billing and API keys.</p>
          </SettingsPanel>
        )}
        <NotificationEmailSection />
      </div>
      <div className="flex min-w-0 max-w-[412px] flex-[1_1_280px] flex-col gap-4">
        <SettingsPanel as="aside" id="s-about" title="About this workspace">
          <dl className="m-0">
            {billing && (
              <div className={fact}>
                <dt className="text-[13px] text-ink-muted">Plan</dt>
                <dd className="m-0 flex flex-wrap items-center justify-between gap-x-3">
                  <span className="font-semibold text-ink">{planName(billing.plan)}</span>
                  <Link href={settingsAddress("billing")} className="inline-flex min-h-[40px] items-center font-semibold">See plan and billing</Link>
                </dd>
              </div>
            )}
            <div className={fact}>
              <dt className="text-[13px] text-ink-muted">Default currency</dt>
              <dd className="m-0 font-semibold text-ink">Euro (EUR)</dd>
            </div>
            {/* Not a per-workspace region: nothing configures one. It names where documents are stored and links the page that qualifies it. */}
            <div className={fact}>
              <dt className="text-[13px] text-ink-muted">Document storage</dt>
              <dd className="m-0">
                <Link href="/security" className="inline-flex min-h-[40px] items-center font-semibold">EU-region</Link>
              </dd>
            </div>
          </dl>
          <p className="m-0 text-[13px] text-ink-muted">Currency and storage are fixed for the workspace.</p>
        </SettingsPanel>
      </div>
    </div>
  );
}

/** Saves when the box is left or on Enter: trimmed, once per new value, never while a save is out; a failure keeps what was typed. */
function WorkspaceName({ organization }: { organization: Organization }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const sent = useRef<string | null>(null);
  // The request starts in the handler (one per change, decided right there); the mutation tracks its outcome.
  const save = useMutation({
    mutationFn: (request: Promise<unknown>) => request,
    onSuccess: () => {
      // The person has taken ownership of the name: retire the auto-name nudge.
      try { localStorage.removeItem("ws-autonamed"); } catch { /* storage may be blocked */ }
    },
    onError: () => { sent.current = null; },
  });
  const value = draft ?? organization.name;

  function commit() {
    const name = value.trim();
    setEmpty(!name);
    if (!name || name === organization.name || name === sent.current || save.isPending) return;
    sent.current = name;
    save.mutate(organization.update({ name }));
  }

  const failure = empty
    ? "Give the workspace a name."
    : save.isError
      ? isClerkAPIResponseError(save.error) && save.error.status === 403 ? COPY.requires_org_admin : "We couldn't save the name. Try again."
      : null;

  return (
    <SettingsPanel id="s-name" title={<label htmlFor="ws-name">Workspace name</label>} side={save.isSuccess && <SavedMark />}>
      <div className="flex max-w-[420px] flex-col gap-2">
        <input
          id="ws-name"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          className="h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-[14px] text-ink max-[639px]:text-[16px] max-[480px]:h-11"
        />
        <p className="m-0 text-[13px] text-ink-muted">Shown at the top of every screen. It saves when you leave the box.</p>
        {failure && <p role="alert" className="m-0 text-[13px] text-danger-text">{failure}</p>}
      </div>
    </SettingsPanel>
  );
}

// ── API keys tab ───────────────────────────────────────────────────────────

/**
 * The raw key lives only in `newKey` and the create mutation, and both are cleared when the dialog closes by
 * any route: never in the query cache, the address, storage, a log or a title. A reload shows the name, the
 * prefix the server gives, and the dates.
 */
function ApiKeysSection() {
  const qc = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copy, setCopy] = useState<"copied" | "failed" | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const list = useQuery<ApiKey[]>({ queryKey: ["api-keys"], queryFn: getApiKeys, retry: false });
  const keys = list.data;

  const create = useMutation({
    // The raw key goes straight to `newKey` and is left out of what the mutation keeps: a reset mutation
    // still sits in the mutation cache until it is collected.
    mutationFn: async (label: string) => {
      const { rawKey, ...made } = await createApiKey(label);
      setNewKey(rawKey);
      return made;
    },
    onSuccess: () => {
      setNewLabel("");
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const closeKey = () => { setNewKey(null); setCopy(null); create.reset(); };
  const submit = () => { const label = newLabel.trim(); if (label && !create.isPending) create.mutate(label); };
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(newKey ?? "");
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  };

  // A failed revoke leads with the key still being live, and names the one proof that it landed: the row
  // showing Revoked.
  const revokeFailureFor = (keyId: string): string | null =>
    revoke.isError && revoke.variables === keyId
      ? writeFailureCopy(
          revoke.error,
          "Still active — do not assume this key is revoked. Anyone holding it can still use the API " +
            "until this row shows Revoked.",
        )
      : null;
  const revoking = (keyId: string) => revoke.isPending && revoke.variables === keyId;
  const lastUsed = (k: ApiKey) => (k.lastUsedAt === null ? "Never used" : formatDate(k.lastUsedAt));
  const revokeControl = (k: ApiKey, fullWidth: boolean) => (
    <InlineConfirm
      onConfirm={() => { if (!revoke.isPending) revoke.mutate(k.id); }}
      confirmLabel="Revoke"
      prompt="Anything that uses this key stops working."
      fullWidth={fullWidth}
      trigger={(open) => (
        <Button type="button" variant="secondary" size="sm" className={fullWidth ? "w-full" : undefined} loading={revoking(k.id)} onClick={open}>
          Revoke
        </Button>
      )}
    />
  );
  const cell = "border-b border-border px-3 py-3 text-[13px]";

  let body: ReactNode;
  if (list.isError && !keys) body = <Failed error={list.error} retry={() => list.refetch()} />;
  else if (!keys) body = <Quiet>Loading keys…</Quiet>;
  else if (!keys.length && !showCreate)
    body = (
      <div className="grid gap-1">
        <p className="m-0 text-[14px] font-semibold text-ink">No API keys yet.</p>
        <p className="m-0 text-[14px] text-ink-muted">Create one when another system needs to send files to your flows.</p>
      </div>
    );
  else if (keys.length)
    body = (
      <>
        {/* Desktop: one table (hidden on phones so nothing scrolls sideways). */}
        <table data-testid="api-keys-table" className="hidden w-full border-collapse md:table">
          <thead>
            <tr>
              {["Name", "Key", "Created", "Last used", ""].map((h) => (
                <th key={h} className="whitespace-nowrap border-b border-border px-3 pb-2.5 text-left text-[12.5px] font-semibold text-ink-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className={k.isActive ? undefined : "opacity-60"}>
                <td className={`${cell} font-semibold text-ink`}>{k.label}</td>
                <td className={cell}><code className="font-mono text-ink-muted">{k.keyPrefix}…</code></td>
                <td className={`${cell} whitespace-nowrap text-ink-muted`}>{formatDate(k.createdAt)}</td>
                <td className={`${cell} whitespace-nowrap text-ink-muted`}>{lastUsed(k)}</td>
                <td className={`${cell} text-right`}>
                  {k.isActive ? (
                    <>
                      <div className="inline-flex justify-end">{revokeControl(k, false)}</div>
                      {revokeFailureFor(k.id) && <WriteFailure className="ml-auto max-w-[340px] text-right">{revokeFailureFor(k.id)}</WriteFailure>}
                    </>
                  ) : (
                    <Pill tone="neutral">Revoked</Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Phones: each key as a stacked card. */}
        <div data-testid="api-keys-cards" className="flex flex-col gap-2 md:hidden">
          {keys.map((k) => (
            <Card key={k.id} pad="12px 14px" radius={10} className={k.isActive ? undefined : "opacity-60"}>
              <div className="flex items-center justify-between gap-2.5">
                <span className="truncate text-[14px] font-semibold text-ink">{k.label}</span>
                {!k.isActive && <Pill tone="neutral">Revoked</Pill>}
              </div>
              <code className="mt-1.5 block font-mono text-[13px] text-ink-muted">{k.keyPrefix}…</code>
              <p className="mb-0 mt-1.5 text-[13px] text-ink-muted">
                {k.lastUsedAt === null
                  ? `Created ${formatDate(k.createdAt)}. Never used.`
                  : `Created ${formatDate(k.createdAt)}. Last used ${formatDate(k.lastUsedAt)}.`}
              </p>
              {k.isActive && (
                <div className="mt-2.5">
                  {revokeControl(k, true)}
                  {revokeFailureFor(k.id) && <WriteFailure>{revokeFailureFor(k.id)}</WriteFailure>}
                </div>
              )}
            </Card>
          ))}
        </div>
      </>
    );

  return (
    <SettingsPanel
      id="api-keys"
      title="API keys"
      sub="A key lets another system send files to your flows and fetch results. You see a key once, when you create it."
      className="max-w-[960px]"
    >
      {/* One-time reveal: a focus-trapped dialog; every way of closing it forgets the key. */}
      <Dialog open={!!newKey} onOpenChange={(open) => { if (!open) closeKey(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-text" aria-hidden />
              Copy your new API key now
            </DialogTitle>
            <DialogDescription>This is the only time the key is shown. Store it somewhere safe before you close this.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code data-testid="new-api-key" className="flex-1 break-all rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[13px] text-ink">
              {newKey}
            </code>
            <Button type="button" variant="secondary" onClick={handleCopy}>
              <Copy size={14} aria-hidden />
              Copy
            </Button>
          </div>
          <p role="status" className="m-0 min-h-[1.25rem] text-[13px] text-ink-muted">
            {copy === "copied" ? "Copied" : copy === "failed" ? "Couldn't copy. Select the key and copy it yourself." : ""}
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={closeKey}>I&apos;ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {body}

      {showCreate ? (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label htmlFor="api-key-name" className="text-[13px] font-semibold text-ink">Name</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="api-key-name"
              value={newLabel}
              autoFocus
              aria-describedby="api-key-name-hint"
              onChange={(e) => setNewLabel(e.target.value)}
              className="h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-[14px] text-ink max-[639px]:text-[16px] sm:max-w-[420px]"
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" className="flex-1 sm:flex-none" loading={create.isPending} disabled={!newLabel.trim()}>
                <Plus size={14} aria-hidden />
                {create.isPending ? "Creating…" : "Create key"}
              </Button>
              <Button type="button" variant="secondary" className="flex-1 sm:flex-none" onClick={() => { setShowCreate(false); setNewLabel(""); create.reset(); }}>
                Cancel
              </Button>
            </div>
          </div>
          <p id="api-key-name-hint" className="m-0 text-[13px] text-ink-muted">Name it after the system that will use it.</p>
          {create.isError && <p role="alert" className="m-0 text-[13px] text-danger-text">{documentRefusalMessage(create.error)}</p>}
        </form>
      ) : (
        keys && (
          <div>
            <Button type="button" variant="primary" onClick={() => setShowCreate(true)}>
              <Plus size={14} aria-hidden />
              Create key
            </Button>
          </div>
        )
      )}
    </SettingsPanel>
  );
}
