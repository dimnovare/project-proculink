"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { StatusNotice } from "@/components/bridge/layout/StatusNotice";
import { Button, buttonClass } from "@/components/bridge/DSPrimitives";
import { capture } from "@/lib/analytics";
import { getBillingStatus } from "@/lib/api-client";
import { ApiHttpError } from "@/lib/api/core";
import { createFlow, createSampleDocument, type Flow } from "@/lib/api/documents";
import { COPY, refusalToken } from "@/lib/documentRefusals";
import { acceptFor, MAX_UPLOAD_BYTES } from "@/lib/fileKinds";
import { firstRunAddress, firstRunOf, isFirstFlow, PROVISIONAL_FLOW_NAME, welcomeKinds } from "@/lib/firstRun";
import { LIMIT_CODES } from "@/lib/limitRefusal";
import { FileDrop } from "./FileDrop";
import { useTenantQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useLinkedAccounts } from "./GoogleTargetFields";
import { PhotoCheck, useCamera } from "./PhotoCheck";
import { PausedNotice, pausedBy } from "./UploadToFlow";
import { uploadRefusalMessage, useUploadQueue } from "./UploadQueue";

const BILLING = "/settings?tab=billing";
const PLAN_CODES = new Set(["processing_paused", "flow_limit_reached"]);

/** A refusal said where it happened: the plan's and the workspace's with their way on, any other in the server's words. */
function Refusal({ error, again }: { error: unknown; again: string }) {
  const code = refusalToken(error) ?? "";
  if (LIMIT_CODES.has(code)) return <PausedNotice code={code} body={error instanceof ApiHttpError ? error.body : null} />;
  if (PLAN_CODES.has(code)) {
    return (
      <StatusNotice tone="error" action={<Link href={BILLING} className={buttonClass("secondary", "sm")}>Open Plan & billing</Link>}>
        {COPY[code]}
      </StatusNotice>
    );
  }
  return <StatusNotice tone="error">{`${uploadRefusalMessage(error)} ${again}`}</StatusNotice>;
}

const STEPS = [
  ["Add a document", "One document like the ones you get every week."],
  ["Check what we read", "The original stays beside the values we found."],
] as const;

/** The places a file can go, naming Google and OneDrive only where this workspace offers them. */
export function whereItGoes(linked?: { available: boolean; microsoftAvailable?: boolean }): string {
  const cloud = [linked?.available === true && "Google Drive or Sheets", linked?.microsoftAvailable === true && "OneDrive"].filter(Boolean);
  return cloud.length ? `A download, an email, a server, ${cloud.length > 1 ? `${cloud[0]}, ` : ""}or ${cloud.at(-1)}.` : "A download, an email or a server.";
}

/** Step "add" of first run, and the body of Documents, Flows and Upload when the workspace has no flow.
 *  `flows` is the answered list (never a loading or failed one). `flowId` is the address's flow, on /flows/new only. */
export function Welcome({ flows, flowId }: { flows: readonly Flow[]; flowId?: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useUser();
  const queue = useUploadQueue();
  const google = useLinkedAccounts();
  const onFirstRun = flowId !== undefined;
  const run = firstRunOf(flows);
  // R4: the address's flow, else the one a refused start left, else none yet.
  const made = useRef<Flow | null>(null);
  // The run keeps the address's flow until it is finished (FirstRun never draws a finished one), so another file never makes a second flow.
  const known = flows.find((f) => f.id === flowId) ?? (run.state === "new" ? run.flow : null) ?? made.current;
  const first = isFirstFlow(flows, known?.id ?? null);
  const [key, setKey] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const camera = useCamera(setPhoto, "welcome-camera-input");
  const went = useRef(false);
  // A trial that ended or a paused account: said under the title, and nothing here invites a file (A-02).
  const billing = useQuery({ queryKey: ["billing-status"], queryFn: getBillingStatus, staleTime: 60_000, enabled: useTenantQueriesEnabled() });
  const paused = pausedBy([], billing.data);

  const finish = (flow: string, doc: string) => {
    if (went.current) return;
    went.current = true;
    capture("wizard_step_completed", { step: 1, step_name: "add", first });
    router.push(firstRunAddress({ step: "check", flow, doc }));
  };

  const resolve = async (): Promise<Flow> => {
    if (known) return known;
    const f = await createFlow(PROVISIONAL_FLOW_NAME);
    made.current = f;
    void qc.invalidateQueries({ queryKey: ["flows"] });
    // FirstRun waits on the address's flow with Welcome unmounted, which would lose the queued file's key: seed it.
    qc.setQueryData(["flow", f.id], f);
    if (onFirstRun) router.replace(firstRunAddress({ flow: f.id }));
    return f;
  };
  const start = useMutation({
    mutationFn: async (what: File | "sample") => {
      setKey(null);
      if (first) capture("first_upload_started", { file_kind: what === "sample" ? "sample" : what.name.split(".").pop()?.toLowerCase() ?? "" });
      const flow = await resolve();
      if (what === "sample") return { flow: flow.id, doc: (await createSampleDocument(flow.id)).id };
      setKey(queue.add([what], flow)[0]);
      return null;
    },
    onSuccess: (r) => {
      if (!r) return;
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: ["flows"] });
      finish(r.flow, r.doc);
    },
  });
  const item = queue.items.find((i) => i.key === key);
  // The queue uploads on its own; the step moves on once it says the file was taken.
  useEffect(() => {
    if (item?.state === "done" && item.document) finish(item.flowId, item.document.id);
  });
  const uploading = item?.state === "waiting" || item?.state === "uploading";
  const busy = start.isPending || uploading;
  const go = (what: File | "sample") => { if (!busy && !paused) start.mutate(what); };
  const fileError = start.variables !== "sample" && start.isError ? start.error : item?.state === "refused" ? item.error : null;
  const sampleError = start.variables === "sample" && start.isError ? start.error : null;
  const photos = known ? !!known.scansOn : true; // R6: with no flow, photos are assumed on
  const name = user?.firstName?.trim();
  const title = first ? `Welcome${name ? `, ${name}` : ""}. Let's read your first document.` : "Set up a new flow";

  return (
    <PageShell variant="narrow">
      <PageHeader
        title={title} back={onFirstRun ? { href: "/flows", label: "Flows" } : undefined}
        sub={paused ? "Processing is paused, so new documents can't be read right now."
          : first ? "About two minutes. You see the file before anything is sent." : "Add one document like the ones this flow will read. We set the flow up from it."}
      />
      {paused && <div className="mb-5"><PausedNotice {...paused} /></div>}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid content-start gap-5">
          <section data-testid="welcome-drop" aria-labelledby="welcome-drop-heading" className="grid gap-3">
            <h2 id="welcome-drop-heading" className="m-0 text-[18px] font-semibold text-ink">
              <span className="hidden sm:inline">Drop a document here</span>
              <span className="sm:hidden">Add a document</span>
            </h2>
            <FileDrop
              accept={acceptFor(known ?? { scansOn: true })} maxBytes={MAX_UPLOAD_BYTES} prompt={welcomeKinds(known ?? undefined)} variant="primary"
              disabled={!!paused} busy={busy && start.variables !== "sample"} busyLabel={`Uploading ${item?.file.name ?? (start.variables instanceof File ? start.variables.name : "")}…`}
              onFile={go}
            >
              {photos && (
                <Button variant="secondary" size="lg" className="!h-12 w-full sm:hidden" disabled={busy || !!paused} onClick={camera.open}>
                  <Camera size={18} aria-hidden />Take a photo
                </Button>
              )}
            </FileDrop>
            {camera.input}
            {!!fileError && <Refusal error={fileError} again="Choose another file." />}
            {/* Added offline: it waits on the device, and this step moves on once it has gone up. */}
            {item?.state === "held" && <p className="m-0 text-[13px] text-ink-muted">It uploads when you&apos;re back online.</p>}
          </section>
          <section data-testid="welcome-sample" aria-label="Our sample invoice" className="grid justify-items-start gap-1">
            <p className="m-0 flex flex-wrap items-center gap-x-2 text-[14px] text-ink">
              No document ready?
              <button type="button" disabled={busy || !!paused} onClick={() => go("sample")}
                className="inline-flex min-h-[44px] items-center font-semibold text-brand-blue underline disabled:opacity-50 sm:min-h-0">
                Use our sample invoice
              </button>
            </p>
            <p className="m-0 text-[13px] text-ink-muted">
              {start.isPending && start.variables === "sample" ? "Getting our sample invoice…" : "Try a test or anonymised document if you prefer."}
            </p>
            {!!sampleError && <Refusal error={sampleError} again="Try again in a moment." />}
          </section>
        </div>
        <aside className="grid content-start gap-6 max-lg:order-first">
          <section data-testid="welcome-steps" aria-labelledby="welcome-steps-heading">
            <h2 id="welcome-steps-heading" className="m-0 mb-2 hidden text-[14px] font-semibold text-ink sm:block">Three short steps</h2>
            <ol className="m-0 grid list-decimal gap-2 pl-5 text-[14px] text-ink">
              {[...STEPS, ["Choose where it goes", whereItGoes(google.data)] as const].map(([t, d]) => (
                <li key={t}>
                  <span className="font-semibold">{t}</span>
                  <span className="hidden text-ink-muted sm:block">{d}</span>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="welcome-flow-heading" className="text-[14px] text-ink-muted">
            <h2 id="welcome-flow-heading" className="m-0 mb-1 hidden text-[14px] font-semibold text-ink sm:block">What is a flow?</h2>
            <p className="m-0 hidden sm:block">
              A flow is what happens to one kind of document, for example supplier invoices sent to your accounting system.{" "}
              {first ? "We create your first flow from this document." : "We set this flow up from this document."}
            </p>
            <p className="m-0 sm:hidden">{first && "We set up your first flow from it. "}A flow is what happens to one kind of document.</p>
          </section>
        </aside>
      </div>
      {photo && (
        <PhotoCheck
          file={photo}
          onBack={() => setPhoto(null)} onRetake={() => { setPhoto(null); camera.open(); }} onUse={() => { go(photo); setPhoto(null); }}
        />
      )}
    </PageShell>
  );
}
