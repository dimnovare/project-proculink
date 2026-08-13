"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Wand2, ArrowLeft, ArrowRight, Send, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { upsertDeliveryConfig, testFireDelivery } from "@/lib/api/delivery";
import { invalidateOnboardingStatus } from "@/hooks/useOnboardingStatus";
import type { DeliveryProtocol, DeliveryTestResult, OutputFormatId } from "@/lib/api/types";
import { serverReasonOrNull } from "@/lib/serverText";
import { deliveryTestDisclosure } from "@/components/bridge/deliveryTestDisclosure";

/**
 * Guided delivery setup — an OPT-IN, additive stepper that walks a non-technical
 * user through configuring a supplier's delivery in four short steps. It is NOT a
 * mode: the single-form DeliveryConfigEditor stays the default; this is progressive
 * disclosure reached via a quiet "Set up step by step" link on the delivery tab.
 *
 * It writes through the SAME save (upsertDeliveryConfig) + test-fire
 * (testFireDelivery) APIs the editor uses and builds the SAME config/credential
 * shapes — no duplicated delivery logic, no new endpoints. It only fully handles the
 * simple common cases (HTTP none/apikey/bearer/basic, SFTP password/key, FTPS, Email
 * recipients); the advanced channels (OAuth2 HTTP, cXML credentials, Erply, Directo)
 * are deferred back to the full editor with a link to the matching help article.
 */

// The locked palette (mirrors DeliveryConfigEditor's inline hex so the wizard reads
// as the same surface it opens over).
const NAVY = "#0B1A2F";
const GREEN = "#2E8E3A";     // icons / borders / step-progress dots
const GREEN_BTN = "#297F34"; // solid fill under white text — ≈4.6:1 AA (2E8E3A was 4.16:1)
const GREEN_DEEP = "#1F6F2A";
const BLUE = "#1E66C9";
const MUTED = "#5E6779";
const FAINT = "#667085";
const BORDER = "#D5DAEA";
const INPUT_STYLE = { border: `1px solid ${BORDER}`, color: NAVY } as const;

// Channels the wizard fully handles inline. Advanced channels are offered as a
// deferral card (see ADVANCED_CHANNELS) rather than rebuilt here.
type SimpleChannel = "http" | "sftp" | "ftps" | "email";

interface SimpleChannelSpec {
  id: SimpleChannel;
  protocol: DeliveryProtocol;
  label: string;
  blurb: string;
  /** Marks the one option that needs nothing from the other company. */
  recommended?: boolean;
}

/**
 * Order matters (WP-27). Email leads and is preselected because it is the ONLY option
 * here that a user can finish on their own: mail leaves from ProcuLink's verified
 * sender, so the far end supplies an address and nothing else — and on day one that
 * address can be the user's own. Every other option needs an endpoint, a host, or
 * credentials from another company, which is exactly why first run used to dead-end
 * on this step.
 *
 * The blurbs say "they/them" rather than a hardcoded party noun so the copy reads
 * correctly in inbound mode too (see partyLabels / useOrderDirection).
 */
const SIMPLE_CHANNELS: SimpleChannelSpec[] = [
  {
    id: "email",
    protocol: "email",
    label: "Email",
    blurb:
      "We email the finished file from ProcuLink's own mail servers. They give you an address — nothing to install, nothing to set up on their side.",
    recommended: true,
  },
  {
    id: "http",
    protocol: "http",
    label: "HTTP webhook / API",
    blurb: "They gave you a URL that receives the order (a webhook or REST endpoint).",
  },
  {
    id: "sftp",
    protocol: "sftp",
    label: "SFTP",
    blurb: "They gave you a server address plus a login — the order is dropped as a file.",
  },
  {
    id: "ftps",
    protocol: "ftps",
    label: "FTPS",
    blurb: "Like SFTP, but FTP-over-TLS. A server address, a login, and a folder to drop the file in.",
  },
];

/** The option offered first, and the one a bare "Continue" would take. */
export const DEFAULT_SIMPLE_CHANNEL: SimpleChannel = "email";

// Advanced channels: the wizard does NOT rebuild these. It shows a short note and a
// link to the matching /help article, then closes back to the full editor.
interface AdvancedChannelSpec {
  id: string;
  label: string;
  blurb: string;
  helpSlug: string;
}

const ADVANCED_CHANNELS: AdvancedChannelSpec[] = [
  {
    id: "http-oauth2",
    label: "HTTP with OAuth2",
    blurb: "An API that needs a token fetched first (client id + secret + token URL).",
    helpSlug: "oauth2-delivery-setup",
  },
  {
    id: "cxml",
    label: "cXML network credentials",
    blurb: "A cXML endpoint that needs From / To / Sender identities and a shared secret.",
    helpSlug: "cxml-setup",
  },
  {
    id: "erp",
    label: "Erply or Directo ERP",
    blurb: "A direct ERP connector (client code / database + ERP credentials).",
    helpSlug: "delivery-setup",
  },
];

type AuthType = "none" | "apikey" | "bearer" | "basic";
type SftpAuthMode = "password" | "key";

const OUTPUT_FORMATS: Array<{ id: OutputFormatId; label: string; blurb: string }> = [
  { id: "csv", label: "CSV", blurb: "A simple spreadsheet-style file. A safe default if you're unsure." },
  { id: "xml", label: "XML", blurb: "A generic structured XML document." },
  { id: "json", label: "JSON", blurb: "A structured JSON document, common for APIs." },
  { id: "cxml", label: "cXML", blurb: "The cXML procurement standard (Ariba / Coupa style)." },
  { id: "ubl", label: "UBL 2.1", blurb: "The OASIS UBL 2.1 Order document, common in EU e-procurement. Not checked against Peppol BIS business rules." },
  { id: "x12", label: "X12 850", blurb: "The ANSI X12 850 EDI purchase-order format." },
];

interface DeliveryGuidedSetupProps {
  supplierId: string;
  /** Human noun for this counterparty ("supplier" | "customer") — display only. */
  nounLower?: string;
  /** Fired after the wizard saves a config so the parent can reload the editor. */
  onSaved?: () => void;
}

type Step = 1 | 2 | 3 | 4;

export function DeliveryGuidedSetup({ supplierId, nounLower = "supplier", onSaved }: DeliveryGuidedSetupProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[12px] font-semibold transition-colors"
        style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF", color: NAVY, cursor: "pointer" }}
      >
        <Wand2 size={13} color={GREEN} />
        Set up step by step
        <ArrowRight size={13} />
      </button>

      {open && (
        <WizardModal
          supplierId={supplierId}
          nounLower={nounLower}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function WizardModal({
  supplierId,
  nounLower,
  onClose,
  onSaved,
}: {
  supplierId: string;
  nounLower: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>(1);
  const [channel, setChannel] = useState<SimpleChannel | null>(null);

  // Step-2 fields (only the ones the selected channel needs are shown).
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [apiKeyHeader, setApiKeyHeader] = useState("X-Api-Key");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");

  const [host, setHost] = useState("");
  const [port, setPort] = useState<number | "">("");
  const [remotePath, setRemotePath] = useState("");
  const [sftpAuthMode, setSftpAuthMode] = useState<SftpAuthMode>("password");
  const [privateKey, setPrivateKey] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");
  const [allowInvalidCertificate, setAllowInvalidCertificate] = useState(false);

  const [toAddresses, setToAddresses] = useState("");
  const [replyTo, setReplyTo] = useState("");

  const [outputFormat, setOutputFormat] = useState<OutputFormatId>("csv");
  const [autoDeliver, setAutoDeliver] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DeliveryTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spec = useMemo(() => SIMPLE_CHANNELS.find((c) => c.id === channel) ?? null, [channel]);

  // Step-2 completeness — mirrors the editor's canSave for these channels.
  const step2Ready = useMemo(() => {
    if (!channel) return false;
    if (channel === "http") return url.trim() !== "";
    if (channel === "sftp" || channel === "ftps") return host.trim() !== "";
    if (channel === "email") return toAddresses.trim() !== "";
    return false;
  }, [channel, url, host, toAddresses]);

  function selectChannel(next: SimpleChannel) {
    setChannel(next);
    if ((next === "sftp" || next === "ftps") && port === "") {
      setPort(next === "sftp" ? 22 : 21);
    }
    setStep(2);
  }

  // Build the config JSON the backend stores — SAME shapes the editor's
  // buildConfigObject() produces, for the subset of channels handled here.
  function buildConfigObject(): Record<string, unknown> {
    if (channel === "sftp") {
      return { host, port: Number(port) || 22, remotePath, makeDirectories: true, timeoutSeconds: 30 };
    }
    if (channel === "ftps") {
      return {
        host,
        port: Number(port) || 21,
        remotePath,
        makeDirectories: true,
        timeoutSeconds: 30,
        allowInvalidCertificate,
      };
    }
    if (channel === "email") {
      return { toAddresses, ...(replyTo ? { replyTo } : {}) };
    }
    return { url, method: "POST", timeoutSeconds: 30 }; // http
  }

  // Build the credentials JSON — SAME shapes the editor's buildCredentialsJson()
  // produces. This is a fresh config from the wizard, so there is never a saved
  // credential to preserve (the editor's "leave blank to keep" paths don't apply).
  function buildCredentialsJson(): string | null {
    if (channel === "email") return null; // HTTP email API — no per-supplier credentials
    if (channel === "sftp") {
      if (sftpAuthMode === "key") {
        return JSON.stringify({ username: basicUsername, privateKey, privateKeyPassphrase });
      }
      return JSON.stringify({ username: basicUsername, password: basicPassword });
    }
    if (channel === "ftps") {
      return JSON.stringify({ username: basicUsername, password: basicPassword });
    }
    // http
    if (authType === "none") return '{"type":"none"}';
    if (authType === "apikey") {
      return JSON.stringify({ type: "apikey", header: apiKeyHeader, value: apiKeyValue });
    }
    if (authType === "bearer") {
      return JSON.stringify({ type: "bearer", token: bearerToken });
    }
    return JSON.stringify({ type: "basic", username: basicUsername, password: basicPassword });
  }

  async function saveConfig(): Promise<boolean> {
    if (!spec) return false;
    setSaving(true);
    setError(null);
    try {
      await upsertDeliveryConfig(supplierId, {
        protocol: spec.protocol,
        autoDeliver,
        configJson: JSON.stringify(buildConfigObject()),
        credentialsJson: buildCredentialsJson(),
        outputFormat,
      });
      setSaved(true);
      // hasDeliveryConfig just flipped — refresh checklist/chip surfaces.
      void invalidateOnboardingStatus(queryClient);
      // Let the parent reload the underlying editor with the freshly-saved config.
      onSaved?.();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save delivery config.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndAdvance() {
    const ok = await saveConfig();
    if (ok) setStep(4);
  }

  async function handleTestFire() {
    setTesting(true);
    setError(null);
    try {
      const result = await testFireDelivery(supplierId);
      setTestResult(result);
      if (result.success) void invalidateOnboardingStatus(queryClient);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run delivery test.");
    } finally {
      setTesting(false);
    }
  }

  function finish() {
    onClose();
  }

  const stepTitles: Record<Step, string> = {
    1: `How does this ${nounLower} receive orders?`,
    2: "Where does it go?",
    3: "What format?",
    4: "Send a test",
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-[560px] gap-0 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="px-5 pt-5 pb-3 pr-10">
          <StepDots step={step} />
          <DialogTitle className="mt-2 text-[16px]">{stepTitles[step]}</DialogTitle>
          <DialogDescription className="text-[12px]">
            Step {step} of 4 · guided delivery setup
          </DialogDescription>
        </DialogHeader>

        {/* Body scroll area gives up the cookie-banner inset (0 once dismissed) so
            the step footer below stays visible instead of scrolling out of reach. */}
        <div className="px-5 py-4" style={{ borderTop: "1px solid #E5E8EE", maxHeight: "calc(60vh - var(--plk-bottom-inset, 0px))", overflowY: "auto" }}>
          {step === 1 && <StepChannel onSelect={selectChannel} onClose={onClose} />}

          {step === 2 && spec && (
            <StepDestination
              channel={spec.id}
              url={url} setUrl={setUrl}
              authType={authType} setAuthType={setAuthType}
              apiKeyHeader={apiKeyHeader} setApiKeyHeader={setApiKeyHeader}
              apiKeyValue={apiKeyValue} setApiKeyValue={setApiKeyValue}
              bearerToken={bearerToken} setBearerToken={setBearerToken}
              basicUsername={basicUsername} setBasicUsername={setBasicUsername}
              basicPassword={basicPassword} setBasicPassword={setBasicPassword}
              host={host} setHost={setHost}
              port={port} setPort={setPort}
              remotePath={remotePath} setRemotePath={setRemotePath}
              sftpAuthMode={sftpAuthMode} setSftpAuthMode={setSftpAuthMode}
              privateKey={privateKey} setPrivateKey={setPrivateKey}
              privateKeyPassphrase={privateKeyPassphrase} setPrivateKeyPassphrase={setPrivateKeyPassphrase}
              allowInvalidCertificate={allowInvalidCertificate} setAllowInvalidCertificate={setAllowInvalidCertificate}
              toAddresses={toAddresses} setToAddresses={setToAddresses}
              replyTo={replyTo} setReplyTo={setReplyTo}
            />
          )}

          {step === 3 && (
            <StepFormat
              outputFormat={outputFormat}
              setOutputFormat={setOutputFormat}
              autoDeliver={autoDeliver}
              setAutoDeliver={setAutoDeliver}
              nounLower={nounLower}
            />
          )}

          {step === 4 && (
            <StepTest
              saved={saved}
              testing={testing}
              testResult={testResult}
              onTestFire={handleTestFire}
              protocol={spec?.protocol ?? null}
            />
          )}

          {error && (
            <div className="mt-3 rounded-[6px] px-3 py-2 text-[12px]" role="alert" style={{ background: "#FCEBEB", color: "#A52E2E", border: "1px solid #F5C5C5" }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer — step-dependent navigation. */}
        <div
          className="flex items-center gap-2 px-5 py-3"
          style={{ borderTop: "1px solid #E5E8EE", background: "#F6F7FA" }}
        >
          {step > 1 && step < 4 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-medium"
              style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF", color: NAVY, cursor: "pointer" }}
            >
              <ArrowLeft size={13} /> Back
            </button>
          )}

          <div className="flex-1" />

          {step === 1 && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] px-3 py-1.5 text-[12px] font-medium"
              style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF", color: MUTED, cursor: "pointer" }}
            >
              Cancel
            </button>
          )}

          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!step2Ready}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-semibold"
              style={{ border: "none", background: step2Ready ? NAVY : FAINT, color: "#FFF", cursor: step2Ready ? "pointer" : "default" }}
            >
              Continue <ArrowRight size={13} />
            </button>
          )}

          {step === 3 && (
            <button
              type="button"
              onClick={handleSaveAndAdvance}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-semibold"
              style={{ border: "none", background: saving ? FAINT : NAVY, color: "#FFF", cursor: saving ? "default" : "pointer" }}
            >
              {saving ? "Saving..." : "Save & continue"} <ArrowRight size={13} />
            </button>
          )}

          {step === 4 && (
            <button
              type="button"
              onClick={finish}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-semibold"
              style={{ border: "none", background: GREEN_BTN, color: "#FFF", cursor: "pointer" }}
            >
              <Check size={13} /> Done
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Step indicator ───────────────────────────────────────────────────────────
function StepDots({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {([1, 2, 3, 4] as Step[]).map((n) => (
        <span
          key={n}
          className="h-1.5 rounded-full transition-all"
          style={{
            width: n === step ? 22 : 8,
            background: n <= step ? GREEN : "#D5DAEA",
          }}
        />
      ))}
    </div>
  );
}

// ── Step 1 — channel picker ──────────────────────────────────────────────────
function StepChannel({
  onSelect,
  onClose,
}: {
  onSelect: (c: SimpleChannel) => void;
  onClose: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState<AdvancedChannelSpec | null>(null);

  if (showAdvanced) {
    return (
      <div className="grid gap-3">
        <div className="rounded-[7px] p-3" style={{ background: "#FFF6E5", border: "1px solid #F0D39A" }}>
          <p className="text-[12px] font-semibold" style={{ color: "#8A4B00" }}>
            {showAdvanced.label} needs a few more details
          </p>
          <p className="mt-1 text-[12px]" style={{ color: "#8A4B00" }}>
            This channel has extra settings the guided setup doesn&apos;t cover. Set it up in the full
            editor — close this and use the form on the delivery tab.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-semibold"
              style={{ border: "none", background: NAVY, color: "#FFF", cursor: "pointer" }}
            >
              Open the full editor
            </button>
            <Link
              href={`/help/${showAdvanced.helpSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px]"
              style={{ color: "#8A4B00", textDecoration: "underline", textUnderlineOffset: 2 }}
            >
              Read the setup guide →
            </Link>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowAdvanced(null)}
          className="inline-flex items-center gap-1.5 self-start text-[12px] font-medium"
          style={{ color: MUTED, background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          <ArrowLeft size={13} /> Back to channels
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <p className="text-[12px]" style={{ color: MUTED }}>
        Every option below except Email needs something from them first — a URL, a server, a
        login. Email needs nothing: put any address in and it works today.
      </p>
      {SIMPLE_CHANNELS.map((c) => {
        const isDefault = c.id === DEFAULT_SIMPLE_CHANNEL;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            aria-describedby={isDefault ? "guided-default-channel-note" : undefined}
            className="grid w-full gap-0.5 rounded-[7px] px-3 py-2.5 text-left transition-colors"
            style={{
              border: isDefault ? `1.5px solid ${GREEN}` : `1px solid ${BORDER}`,
              background: isDefault ? "#F3FAF4" : "#FFFFFF",
              cursor: "pointer",
            }}
          >
            <span className="flex items-center justify-between gap-2 text-[13px] font-semibold" style={{ color: NAVY }}>
              <span className="flex flex-wrap items-center gap-2">
                {c.label}
                {c.recommended && (
                  <span
                    className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                    style={{ background: "#DCEEDE", color: GREEN_DEEP, letterSpacing: "0.05em" }}
                  >
                    Recommended
                  </span>
                )}
              </span>
              <ArrowRight size={14} color={FAINT} />
            </span>
            <span className="text-[12px]" style={{ color: MUTED }}>{c.blurb}</span>
          </button>
        );
      })}
      <p id="guided-default-channel-note" className="text-[11px]" style={{ color: MUTED }}>
        Not ready to ask them yet? Choose Email and put your own address in — you will see
        exactly what they would receive.
      </p>

      <div className="mt-1.5 rounded-[7px] p-3" style={{ background: "#FBFCFE", border: "1px solid #E5E8EE" }}>
        <p className="text-[11px] font-semibold uppercase" style={{ color: FAINT }}>
          Something more advanced?
        </p>
        <div className="mt-2 grid gap-1.5">
          {ADVANCED_CHANNELS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setShowAdvanced(a)}
              className="grid gap-0.5 rounded-[6px] px-2.5 py-2 text-left transition-colors"
              style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", cursor: "pointer" }}
            >
              <span className="text-[12px] font-semibold" style={{ color: NAVY }}>{a.label}</span>
              <span className="text-[11px]" style={{ color: MUTED }}>{a.blurb}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step 2 — destination + auth ──────────────────────────────────────────────
interface StepDestinationProps {
  channel: SimpleChannel;
  url: string; setUrl: (v: string) => void;
  authType: AuthType; setAuthType: (v: AuthType) => void;
  apiKeyHeader: string; setApiKeyHeader: (v: string) => void;
  apiKeyValue: string; setApiKeyValue: (v: string) => void;
  bearerToken: string; setBearerToken: (v: string) => void;
  basicUsername: string; setBasicUsername: (v: string) => void;
  basicPassword: string; setBasicPassword: (v: string) => void;
  host: string; setHost: (v: string) => void;
  port: number | ""; setPort: (v: number | "") => void;
  remotePath: string; setRemotePath: (v: string) => void;
  sftpAuthMode: SftpAuthMode; setSftpAuthMode: (v: SftpAuthMode) => void;
  privateKey: string; setPrivateKey: (v: string) => void;
  privateKeyPassphrase: string; setPrivateKeyPassphrase: (v: string) => void;
  allowInvalidCertificate: boolean; setAllowInvalidCertificate: (v: boolean) => void;
  toAddresses: string; setToAddresses: (v: string) => void;
  replyTo: string; setReplyTo: (v: string) => void;
}

function StepDestination(p: StepDestinationProps) {
  const { channel } = p;

  if (channel === "http") {
    return (
      <div className="grid gap-3">
        <WizardField label="Endpoint URL" hint="The exact address your supplier gave you to send orders to.">
          <input
            value={p.url}
            onChange={(e) => p.setUrl(e.target.value)}
            placeholder="https://supplier.example/orders"
            className="h-9 w-full rounded-[5px] px-2.5 text-[12px]"
            style={INPUT_STYLE}
          />
        </WizardField>

        <WizardField label="How does it check who you are?" hint="If your supplier gave you a key, token, or login, pick it here. Otherwise leave as None.">
          <select
            value={p.authType}
            onChange={(e) => p.setAuthType(e.target.value as AuthType)}
            className="h-9 w-full rounded-[5px] px-2 text-[12px]"
            style={{ ...INPUT_STYLE, background: "#FFF" }}
          >
            <option value="none">None</option>
            <option value="apikey">API key</option>
            <option value="bearer">Bearer token</option>
            <option value="basic">Username &amp; password</option>
          </select>
        </WizardField>

        {p.authType === "apikey" && (
          <div className="grid gap-3 lg:grid-cols-[160px_minmax(0,1fr)]">
            <WizardField label="Header name" hint="The header your supplier told you to send the key in.">
              <input value={p.apiKeyHeader} onChange={(e) => p.setApiKeyHeader(e.target.value)} placeholder="X-Api-Key" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
            </WizardField>
            <WizardField label="Key value">
              <input type="password" value={p.apiKeyValue} onChange={(e) => p.setApiKeyValue(e.target.value)} placeholder="paste the key your supplier gave you" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
            </WizardField>
          </div>
        )}
        {p.authType === "bearer" && (
          <WizardField label="Bearer token">
            <input type="password" value={p.bearerToken} onChange={(e) => p.setBearerToken(e.target.value)} placeholder="paste the token" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
          </WizardField>
        )}
        {p.authType === "basic" && (
          <div className="grid gap-3 lg:grid-cols-2">
            <WizardField label="Username">
              <input value={p.basicUsername} onChange={(e) => p.setBasicUsername(e.target.value)} placeholder="supplier-username" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
            </WizardField>
            <WizardField label="Password">
              <input type="password" value={p.basicPassword} onChange={(e) => p.setBasicPassword(e.target.value)} placeholder="supplier password" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
            </WizardField>
          </div>
        )}

        <HelpNote slug="oauth2-delivery-setup" label="delivery setup guide" />
      </div>
    );
  }

  if (channel === "sftp" || channel === "ftps") {
    const isSftp = channel === "sftp";
    return (
      <div className="grid gap-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_100px]">
          <WizardField label="Server address (host)" hint="The server your supplier gave you to connect to.">
            <input value={p.host} onChange={(e) => p.setHost(e.target.value)} placeholder={isSftp ? "sftp.supplier.example" : "ftps.supplier.example"} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
          </WizardField>
          <WizardField label="Port" hint={isSftp ? "Usually 22." : "Usually 21."}>
            <input type="number" min={1} value={p.port} onChange={(e) => p.setPort(e.target.value === "" ? "" : Number(e.target.value))} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
          </WizardField>
        </div>

        <WizardField label="Folder to drop the file in (remote path)" hint="Where on their server the order file should land, e.g. /inbound/orders.">
          <input value={p.remotePath} onChange={(e) => p.setRemotePath(e.target.value)} placeholder="/inbound/orders" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
        </WizardField>

        <WizardField label="Username">
          <input value={p.basicUsername} onChange={(e) => p.setBasicUsername(e.target.value)} placeholder="login your supplier gave you" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
        </WizardField>

        {isSftp && (
          <WizardField label="Sign in with" hint="A password, or a private key if your supplier issued one.">
            <select value={p.sftpAuthMode} onChange={(e) => p.setSftpAuthMode(e.target.value as SftpAuthMode)} className="h-9 w-full rounded-[5px] px-2 text-[12px]" style={{ ...INPUT_STYLE, background: "#FFF" }}>
              <option value="password">Password</option>
              <option value="key">Private key</option>
            </select>
          </WizardField>
        )}

        {isSftp && p.sftpAuthMode === "key" ? (
          <>
            <WizardField label="Private key">
              <textarea value={p.privateKey} onChange={(e) => p.setPrivateKey(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" rows={4} className="w-full rounded-[5px] px-2.5 py-2 font-mono text-[11px]" style={INPUT_STYLE} />
            </WizardField>
            <WizardField label="Key passphrase (optional)">
              <input type="password" value={p.privateKeyPassphrase} onChange={(e) => p.setPrivateKeyPassphrase(e.target.value)} className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
            </WizardField>
          </>
        ) : (
          <WizardField label="Password">
            <input type="password" value={p.basicPassword} onChange={(e) => p.setBasicPassword(e.target.value)} placeholder="password" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
          </WizardField>
        )}

        {!isSftp && (
          <label className="flex items-start gap-2 text-[12px]" style={{ color: "#8A4B00" }}>
            <input type="checkbox" checked={p.allowInvalidCertificate} onChange={(e) => p.setAllowInvalidCertificate(e.target.checked)} />
            Allow an invalid TLS certificate — only if your supplier uses a self-signed or expired cert. Leave off otherwise.
          </label>
        )}

        <HelpNote slug="sftp-ftps-delivery-keys" label="SFTP / FTPS key guide" />
      </div>
    );
  }

  // email
  return (
    <div className="grid gap-3">
      <p className="text-[11px]" style={{ color: MUTED }}>
        Sent from ProcuLink&apos;s mail servers over HTTPS — no email server or password needed.
      </p>
      <WizardField label="Send to (email addresses)" hint="One or more addresses, separated by commas.">
        <input value={p.toAddresses} onChange={(e) => p.setToAddresses(e.target.value)} placeholder="po@supplier.example, sales@supplier.example" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
      </WizardField>
      <WizardField label="Reply-to (optional)" hint="Where replies from the supplier should go.">
        <input value={p.replyTo} onChange={(e) => p.setReplyTo(e.target.value)} placeholder="purchasing@your-company.example" className="h-9 w-full rounded-[5px] px-2.5 text-[12px]" style={INPUT_STYLE} />
      </WizardField>
      <HelpNote slug="delivery-setup" label="delivery setup guide" />
    </div>
  );
}

// ── Step 3 — output format ───────────────────────────────────────────────────
function StepFormat({
  outputFormat,
  setOutputFormat,
  autoDeliver,
  setAutoDeliver,
  nounLower,
}: {
  outputFormat: OutputFormatId;
  setOutputFormat: (v: OutputFormatId) => void;
  autoDeliver: boolean;
  setAutoDeliver: (v: boolean) => void;
  nounLower: string;
}) {
  return (
    <div className="grid gap-3">
      <p className="text-[12px]" style={{ color: MUTED }}>
        The file format your {nounLower}&apos;s system expects. If you&apos;re not sure, ask them —
        CSV is a safe starting point.
      </p>
      <div className="grid gap-2">
        {OUTPUT_FORMATS.map((f) => {
          const selected = outputFormat === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setOutputFormat(f.id)}
              className="grid gap-0.5 rounded-[7px] px-3 py-2.5 text-left transition-colors"
              style={{
                border: selected ? `1px solid ${GREEN}` : `1px solid ${BORDER}`,
                background: selected ? "#E9F1EA" : "#FFFFFF",
                cursor: "pointer",
              }}
            >
              <span className="flex items-center justify-between text-[13px] font-semibold" style={{ color: NAVY }}>
                {f.label}
                {selected && <Check size={14} color={GREEN} />}
              </span>
              <span className="text-[12px]" style={{ color: MUTED }}>{f.blurb}</span>
            </button>
          );
        })}
      </div>

      <label className="mt-1 flex items-start gap-2 rounded-[7px] px-3 py-2.5 text-[12px]" style={{ border: "1px solid #E5E8EE", background: "#FBFCFE", color: NAVY }}>
        <input type="checkbox" checked={autoDeliver} onChange={(e) => setAutoDeliver(e.target.checked)} className="mt-0.5" />
        <span>
          <span className="font-semibold">Auto-deliver</span> — send automatically once an order is
          transformed and ready. Leave off to review each order before it goes.
        </span>
      </label>
    </div>
  );
}

// ── Step 4 — save + test ─────────────────────────────────────────────────────
function StepTest({
  saved,
  testing,
  testResult,
  onTestFire,
  protocol,
}: {
  saved: boolean;
  testing: boolean;
  testResult: DeliveryTestResult | null;
  onTestFire: () => void;
  /** The channel being set up. Decides what the test's side effect actually is. */
  protocol: DeliveryProtocol | null;
}) {
  const disclosure = protocol ? deliveryTestDisclosure(protocol) : null;

  return (
    <div className="grid gap-3">
      {saved && (
        <div className="flex items-start gap-2 rounded-[7px] px-3 py-2.5 text-[12px]" style={{ background: "#F0F7F1", border: "1px solid #CBE8CE", color: GREEN_DEEP }}>
          <Check size={15} color={GREEN} className="mt-0.5 shrink-0" />
          <span>Delivery is saved. Now send a small test to check the connection works.</span>
        </div>
      )}

      <p className="text-[12px]" style={{ color: MUTED }}>
        This sends one tiny sample file to the address you configured. It proves ProcuLink can reach
        it — it does <span className="font-semibold">not</span> mean the supplier accepted a real order.
      </p>

      {/* What the test leaves behind, per channel — a file on their server, a message in their
          inbox, or a request against their live system. See deliveryTestDisclosure: the sentence
          above says what the test PROVES, this says what it DOES, and they are different things. */}
      {disclosure && (
        <div
          className="rounded-[6px] px-3 py-2 text-[11px] leading-5"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: MUTED }}
        >
          <p className="m-0">{disclosure.effect}</p>
          {disclosure.caveat && <p className="m-0 mt-1">{disclosure.caveat}</p>}
        </div>
      )}

      <button
        type="button"
        onClick={onTestFire}
        disabled={testing}
        className="inline-flex items-center justify-center gap-1.5 self-start rounded-[6px] px-3.5 py-2 text-[12px] font-semibold"
        style={{ border: "none", background: testing ? FAINT : GREEN_BTN, color: "#FFF", cursor: testing ? "default" : "pointer" }}
      >
        <Send size={13} /> {testing ? "Testing..." : "Send a test"}
      </button>

      {testResult && (
        <div
          className="rounded-[6px] px-3 py-2.5 text-[12px]"
          style={{
            background: testResult.success ? "#F0F7F1" : "#FCEBEB",
            color: testResult.success ? GREEN_DEEP : "#A52E2E",
            border: `1px solid ${testResult.success ? "#CBE8CE" : "#F5C5C5"}`,
          }}
        >
          <p className="m-0 flex items-center gap-1.5 font-semibold">
            {testResult.success ? <Check size={14} /> : <X size={14} />}
            {testResult.success ? "The endpoint answered" : "Test failed"}
            {testResult.responseCode != null ? ` · response code ${testResult.responseCode}` : ""}
          </p>
          {/* Captured endpoint response body on a 200 test-fire — see DeliveryConfigEditor. */}
          {serverReasonOrNull(testResult.errorMessage) && <p className="m-0 mt-1 font-medium">{serverReasonOrNull(testResult.errorMessage)}</p>}
          {testResult.success && (
            <p className="m-0 mt-1 text-[11px]" style={{ color: "#2E5F35" }}>
              The endpoint answered — that doesn&apos;t prove the supplier accepted the order, but the
              connection works. You&apos;re set up.
            </p>
          )}
        </div>
      )}

      <p className="text-[11px]" style={{ color: FAINT }}>
        You can skip the test and run it later from the delivery tab. Click Done to finish — your setup
        is already saved.
      </p>
    </div>
  );
}

// ── Small shared bits ────────────────────────────────────────────────────────
function WizardField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase" style={{ color: FAINT }}>{label}</span>
      {children}
      {hint && <span className="text-[11px]" style={{ color: MUTED }}>{hint}</span>}
    </label>
  );
}

function HelpNote({ slug, label }: { slug: string; label: string }) {
  return (
    <Link
      href={`/help/${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[11px]"
      style={{ color: BLUE, textDecoration: "underline", textUnderlineOffset: 2 }}
    >
      Need help? See the {label} →
    </Link>
  );
}
