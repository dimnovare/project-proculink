import { EARLY_ACCESS, EINVOICE_STEPS } from "@/lib/marketing/earlyAccess";
import { useMDXComponents } from "@/mdx-components";
import { Step } from "@/components/help/guide";

/** `**label**` as bold, the rest as text. */
const bold = (s: string) => s.split("**").map((t, i) => (i % 2 ? <strong key={i}>{t}</strong> : t));

/** The early-access steps of the e-invoice guide, numbered from `from`. Their names come only from earlyAccess.ts (publicCopyDrift). */
export function EInvoiceSteps({ from }: { from: number }) {
  const { p: P = "p", a: A = "a" } = useMDXComponents({});
  return (
    <div data-early-access="">
      <P>{EARLY_ACCESS.heading}: {EARLY_ACCESS.lead} <A href={EARLY_ACCESS.cta.href}>{EARLY_ACCESS.cta.label}</A></P>
      {EINVOICE_STEPS.map((s, i) => (
        <Step key={s.title} n={from + i} title={s.title}>
          {s.body.map((line) => <P key={line}>{bold(line)}</P>)}
        </Step>
      ))}
    </div>
  );
}
