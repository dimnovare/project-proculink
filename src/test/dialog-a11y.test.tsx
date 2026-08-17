// The dialog gate. Three layers, because one alone is vacuous.
//
//   1. DERIVED GUARD — re-scan src/ for every ARIA dialog and fail if a file is
//      not in the registry. This is what stops the registry going stale. It is
//      not hypothetical: while this packet was being written, WP-32 landed three
//      new components on main that a hand-enumerated list did not contain.
//   2. CONFORMANCE — every registered MODAL must route through useDialogA11y, and
//      no registered POPOVER or NON-MODAL may be given a modal trap. Structural,
//      read from source.
//   3. TABLE-DRIVEN BEHAVIOUR — actually render the dialogs that can be rendered
//      in jsdom and assert the whole contract on each: focus moves in, Tab cycles,
//      Shift+Tab cycles back, Escape closes, focus returns to the trigger.
//
// WHY THREE AND NOT ONE. Layer 3 is the real test but it cannot reach every
// dialog: several are page-scale components wired to Clerk, MSW and a router, and
// mocking those to prove a keydown handler would test the mocks. Layer 2 closes
// that gap structurally — it proves the component calls the hook whose behaviour
// layer 3 and `useDialogA11y.test.tsx` prove exhaustively.
//
// STATED BLIND SPOT of layer 2: it proves the hook is CALLED, not that `panelRef`
// is attached to the right element. A component could call the hook and point the
// ref at a wrapper that is not the dialog. Layer 3 catches that for the dialogs it
// renders; for the rest it is uncaught, and that is the honest limit of this gate.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { useState } from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DIALOG_REGISTRY,
  DIALOG_GREP_FALSE_POSITIVES,
  MODAL_DIALOGS,
  POPOVER_DIALOGS,
  TOTAL_DIALOGS,
  type DialogEntry,
} from "./dialogRegistry";

vi.mock("next/navigation", () => ({
  usePathname: () => "/bridge",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn(), identify: vi.fn(), reset: vi.fn() }));
// Several dialogs reach useOrderDirection -> useQueriesEnabled -> Clerk's useAuth.
// Mocking the auth surface keeps the test about keyboard behaviour, not sessions.
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: "org_1", userId: "user_1" }),
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: null }),
  useOrganization: () => ({ isLoaded: true, organization: { id: "org_1", name: "Test Org" } }),
  useOrganizationList: () => ({ isLoaded: true, userMemberships: { data: [] }, setActive: vi.fn() }),
}));

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

// ─── Layer 1: the derived guard ───────────────────────────────────────────────

/**
 * Every file under src/ whose source mentions an ARIA dialog.
 *
 * `.mdx` is in scope on purpose — `next.config.ts` sets
 * `pageExtensions: ["ts","tsx","mdx"]` and the repo carries more `page.mdx` than
 * `page.tsx`, so a `.tsx`-only walk sees about half the app (TRAP 7).
 */
function filesMentioningDialog(): string[] {
  const out: string[] = [];
  const pattern = /role="dialog"|role="alertdialog"|aria-modal/;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx?|mdx)$/.test(name)) continue;
      // The registry and this gate obviously mention the patterns.
      const rel = relative(ROOT, full).split(sep).join("/");
      if (rel === "src/test/dialogRegistry.ts" || rel === "src/test/dialog-a11y.test.tsx") continue;
      // Test files describe dialogs, they do not ship them.
      if (/\.test\.tsx?$/.test(name)) continue;
      if (pattern.test(readFileSync(full, "utf8"))) out.push(rel);
    }
  };
  walk(SRC);
  return out.sort();
}

describe("dialog registry is DERIVED from the source, not hand-maintained", () => {
  it("every file in src/ that renders an ARIA dialog is in the registry", () => {
    const registered = new Set(DIALOG_REGISTRY.map((d) => d.file));
    const knownFalsePositives = new Set(DIALOG_GREP_FALSE_POSITIVES.map((f) => f.file));
    const unregistered = filesMentioningDialog().filter(
      (f) => !registered.has(f) && !knownFalsePositives.has(f),
    );
    expect(
      unregistered,
      "A new ARIA dialog landed without being registered. Add it to src/test/dialogRegistry.ts " +
        "with its kind (modal | popover | non-modal), or — if it only *mentions* the pattern and " +
        "renders no dialog — add it to DIALOG_GREP_FALSE_POSITIVES with the reason.",
    ).toEqual([]);
  });

  it("every registry entry still points at a real file", () => {
    for (const entry of DIALOG_REGISTRY) {
      expect(() => statSync(join(ROOT, entry.file)), `${entry.file} is gone`).not.toThrow();
    }
  });

  it("every recorded false positive really does render no dialog", () => {
    for (const fp of DIALOG_GREP_FALSE_POSITIVES) {
      const src = readFileSync(join(ROOT, fp.file), "utf8");
      // A file that renders a dialog writes the attribute as a JSX prop on its
      // own line or inline; a file that only QUERIES for one writes it inside a
      // selector string. If a real JSX `role="dialog"` prop ever appears here,
      // the entry is wrong and this must fail.
      const jsxDialogProp = /(?:^|\s)role="dialog"(?!\s*[,\]])/m;
      const insideSelector = /querySelector|querySelectorAll|closest\(/;
      const hasJsx = jsxDialogProp.test(src) && !insideSelector.test(src);
      expect(hasJsx, `${fp.file} now looks like it renders a dialog: ${fp.why}`).toBe(false);
    }
  });

  it("the inventory numbers the packet asked for are recorded, and counted per DIALOG", () => {
    // The packet said "11 of 17". Measured at 478b809 the grep matched 19 FILES,
    // one of which (InboxView) renders no dialog — so 18 dialogs in 18 files, and
    // 12 of the 18 had no focus trap. Both of the packet's numbers were low.
    //
    // 19 since LaneDrawer was marked up. It was a modal the whole time; this gate
    // could not count it, because the grep it derives from asks whether a dialog is
    // MARKED, and LaneDrawer was not. That direction is now guarded by
    // src/test/unmarked-modal.test.ts. The 18/12 above are the 478b809 baseline and
    // do not move; the totals here do.
    expect(DIALOG_REGISTRY.length).toBe(19);
    expect(TOTAL_DIALOGS).toBe(19);
    expect(DIALOG_REGISTRY.filter((d) => !d.hadTrapBefore).length).toBe(13);
    expect(DIALOG_REGISTRY.filter((d) => !d.hadEscapeBefore).length).toBe(6);
  });
});

// ─── Layer 2: conformance ─────────────────────────────────────────────────────

describe("every modal dialog routes through the shared contract", () => {
  it.each(MODAL_DIALOGS.map((d) => [d.name, d] as const))(
    "%s calls useDialogA11y",
    (_name, entry: DialogEntry) => {
      const src = readFileSync(join(ROOT, entry.file), "utf8");
      expect(
        src.includes("useDialogA11y("),
        `${entry.file} renders a modal dialog but does not use the shared dialog contract. ` +
          "Import useDialogA11y from @/hooks/useDialogA11y and give it the dialog element's ref.",
      ).toBe(true);
    },
  );

  it.each(POPOVER_DIALOGS.map((d) => [d.name, d] as const))(
    "%s is a popover and is NOT given a modal trap",
    (_name, entry: DialogEntry) => {
      const src = readFileSync(join(ROOT, entry.file), "utf8");
      expect(src.includes("useDialogA11y("), `${entry.file} must still get Escape + focus restore`).toBe(true);
      // Match the CALL, not the file. `src.includes("modal: false")` was satisfied by
      // the string appearing anywhere — including in a comment — so setting
      // `modal: true` and leaving `// was modal: false` behind passed while the real
      // call trapped Tab. A refuter demonstrated exactly that. This anchors inside the
      // useDialogA11y({...}) argument object, where a comment cannot reach.
      expect(
        /useDialogA11y\(\{[^}]*\bmodal:\s*false\b/.test(src),
        `${entry.file} is registered as a popover, so its useDialogA11y CALL must pass ` +
          "`modal: false`. Trapping Tab inside a layer the user can click past is the " +
          "keyboard trap WCAG 2.1.2 forbids.",
      ).toBe(true);
    },
  );

  it("no dialog still carries its own hand-rolled focus trap", () => {
    // Six copies of the same 40 lines is what this packet removed. A new copy is
    // a regression even if it works, because the next fix will not reach it.
    const offenders = DIALOG_REGISTRY.filter((entry) => {
      const src = readFileSync(join(ROOT, entry.file), "utf8");
      // A local trap is recognisable as a Tab-key branch that reaches for the
      // element list itself.
      return /e\.key\s*[=!]==?\s*"Tab"/.test(src) && /querySelectorAll/.test(src);
    });
    expect(
      offenders.map((o) => o.file),
      "These files re-implement the Tab trap locally instead of using useDialogA11y.",
    ).toEqual([]);
  });
});

// ─── Layer 3: table-driven behaviour ──────────────────────────────────────────

import { ConnectionConfirmDialog } from "@/components/connections/ConnectionLifecycleUI";
import { ConfirmDialog } from "@/components/bridge/review/ConfirmDialog";
import { AdjustLimitsModal } from "@/app/(app)/admin/AdjustLimitsModal";
import { CreateInvoiceModal } from "@/app/(app)/admin/CreateInvoiceModal";
import { HelpSlideover } from "@/components/bridge/HelpSlideover";
import { HistoryDrawer } from "@/components/connections/HistoryDrawer";
import { OrderDetailsDrawer } from "@/components/bridge/workshop/OrderDetailsDrawer";
import { OnboardingWizard } from "@/components/bridge/OnboardingWizard";
import { LaneDrawer } from "@/components/bridge/LaneDrawer";
import type { AdminOrganisation } from "@/lib/api/billing";
import type { PartyLabels } from "@/hooks/useOrderDirection";

const ORG: AdminOrganisation = {
  id: "org_1",
  name: "Test Org",
  slug: "test-org",
  plan: "growth",
  accountStatus: "active",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  mrrContribution: 0,
  createdAt: "2026-01-01T00:00:00Z",
  lastOrderActivity: null,
  orderVolume30d: 0,
  supplierCount: 1,
};

const LABELS: PartyLabels = {
  counterpartyNoun: "Supplier",
  counterpartyPlural: "Suppliers",
  railHeader: "Supplier",
  primaryCta: "Send to supplier",
  primaryCtaProgress: "Sending…",
  doneLabel: "Sent",
  deliveredLabel: "Delivered",
  unknownBuyer: "Unknown buyer",
};

/** One renderable dialog: `file` ties it back to the registry. */
interface RenderableDialog {
  file: string;
  render: (onClose: () => void) => React.ReactElement;
}

const RENDERABLE: RenderableDialog[] = [
  {
    file: "src/components/connections/ConnectionLifecycleUI.tsx",
    render: (onClose) => (
      <ConnectionConfirmDialog
        state={{ kind: "publish", revisionId: "rev_1", versionNo: 2 }}
        busy={false}
        onCancel={onClose}
        onConfirm={() => {}}
      />
    ),
  },
  {
    file: "src/components/bridge/review/ConfirmDialog.tsx",
    render: (onClose) => (
      <ConfirmDialog
        exceptionCount={0}
        onConfirm={() => {}}
        onCancel={onClose}
        supplierName="Acme"
        outputFormat="csv"
        grandTotal="€ 100.00"
        lineCount={2}
        labels={LABELS}
        failingRuleCount={0}
      />
    ),
  },
  {
    file: "src/app/(app)/admin/AdjustLimitsModal.tsx",
    render: (onClose) => <AdjustLimitsModal org={ORG} onClose={onClose} onSaved={() => {}} />,
  },
  {
    file: "src/app/(app)/admin/CreateInvoiceModal.tsx",
    render: (onClose) => (
      <CreateInvoiceModal organisations={[ORG]} defaultOrganisationId={ORG.id} onClose={onClose} />
    ),
  },
  {
    file: "src/components/bridge/HelpSlideover.tsx",
    render: (onClose) => <HelpSlideover open onClose={onClose} />,
  },
  {
    file: "src/components/connections/HistoryDrawer.tsx",
    render: (onClose) => (
      <HistoryDrawer
        open
        onClose={onClose}
        connectionId="conn_1"
        revisions={[]}
        activeRevisionId={null}
        liveSummary={null}
        liveVersionNo={null}
        testEvidence={null}
        busy={false}
        testingRevisionId={null}
        rollingBackRevisionId={null}
        discardingRevisionId={null}
        onTest={() => {}}
        onRequestPublish={() => {}}
        onRequestRollback={() => {}}
        onRequestArchive={() => {}}
      />
    ),
  },
  {
    file: "src/components/bridge/workshop/OrderDetailsDrawer.tsx",
    render: (onClose) => (
      <OrderDetailsDrawer
        open
        onClose={onClose}
        tab="passport"
        onTab={() => {}}
        orderId="ord_1"
        poNumber="PO-1"
        supplierName="Acme"
        currency="EUR"
        status="pending_review"
        counterpartyNoun="supplier"
      />
    ),
  },
  {
    file: "src/components/bridge/OnboardingWizard.tsx",
    render: (onClose) => <OnboardingWizard onDismiss={onClose} />,
  },
  {
    file: "src/components/bridge/LaneDrawer.tsx",
    render: (onClose) => (
      <LaneDrawer
        lane={{
          buyerName: "Heinrich Industries",
          buyerCode: "HEI",
          supplierName: "Acme Components",
          supplierCode: "ACM",
          health: "ok",
          healthBasis: { complete: true, scanned: 12 },
          volume: "12 ord",
        }}
        onClose={onClose}
      />
    ),
  },
];

/** Mount `ui` behind a trigger button, so focus-restore has somewhere to return. */
function TriggerHarness({ children }: { children: (close: () => void) => React.ReactElement }) {
  const [open, setOpen] = useState(false);
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <button onClick={() => setOpen(true)}>trigger</button>
      <button>page control</button>
      {open && children(() => setOpen(false))}
    </QueryClientProvider>
  );
}

const flush = async () => {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
};

async function openDialog(entry: RenderableDialog) {
  render(<TriggerHarness>{(close) => entry.render(close)}</TriggerHarness>);
  const trigger = screen.getByText("trigger");
  trigger.focus();
  fireEvent.click(trigger);
  await flush();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  expect(dialog, `${entry.file} rendered no [role=dialog]`).not.toBeNull();
  return { trigger, dialog: dialog! };
}

const key = (k: string, shiftKey = false) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: k, shiftKey });

describe("shared dialog behaviour, applied to every renderable modal", () => {
  beforeEach(() => {
    document.body.style.overflow = "";
  });

  it("the table covers a real subset of the registry, and every row is registered", () => {
    const registered = new Set(MODAL_DIALOGS.map((d) => d.file));
    for (const r of RENDERABLE) {
      expect(registered.has(r.file), `${r.file} is rendered here but is not a registered modal`).toBe(true);
    }
    // Guard against the table quietly emptying out and every case below vanishing.
    expect(RENDERABLE.length).toBeGreaterThanOrEqual(8);
  });

  it.each(RENDERABLE.map((r) => [r.file, r] as const))("%s — focus moves INTO the dialog", async (_f, entry) => {
    const { dialog, trigger } = await openDialog(entry);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(trigger);
  });

  it.each(RENDERABLE.map((r) => [r.file, r] as const))("%s — Tab cycles within the dialog", async (_f, entry) => {
    const { dialog } = await openDialog(entry);
    const stops = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(stops.length, `${entry.file} has no tab stops to cycle`).toBeGreaterThan(0);

    stops[stops.length - 1].focus();
    key("Tab");
    expect(document.activeElement, "Tab from the last stop must wrap to the first").toBe(stops[0]);
  });

  it.each(RENDERABLE.map((r) => [r.file, r] as const))("%s — Shift+Tab cycles backwards", async (_f, entry) => {
    const { dialog } = await openDialog(entry);
    const stops = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    stops[0].focus();
    key("Tab", true);
    expect(document.activeElement, "Shift+Tab from the first stop must wrap to the last").toBe(
      stops[stops.length - 1],
    );
  });

  it.each(RENDERABLE.map((r) => [r.file, r] as const))("%s — Escape closes it", async (_f, entry) => {
    await openDialog(entry);
    key("Escape");
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(RENDERABLE.map((r) => [r.file, r] as const))(
    "%s — focus returns to the trigger on close",
    async (_f, entry) => {
      const { trigger } = await openDialog(entry);
      key("Escape");
      await flush();
      expect(document.activeElement).toBe(trigger);
    },
  );
});
