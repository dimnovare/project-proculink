import { EARLY_ACCESS } from "@/lib/marketing/earlyAccess";
import { useMDXComponents } from "@/mdx-components";

/** The /formats early-access block for a help page. Its names come only from earlyAccess.ts (publicCopyDrift). Server-safe. */
export function EarlyAccessNote() {
  const { p: P = "p", ul: Ul = "ul", li: Li = "li", a: A = "a" } = useMDXComponents({});
  return (
    <div data-early-access="">
      <P>{EARLY_ACCESS.heading}: {EARLY_ACCESS.lead}</P>
      <Ul>{EARLY_ACCESS.items.map((i) => <Li key={i.key}><strong>{i.name}.</strong> {i.note}</Li>)}</Ul>
      <P>Once it is on, the form for a new destination says what each box needs. <A href={EARLY_ACCESS.cta.href}>{EARLY_ACCESS.cta.label}</A></P>
    </div>
  );
}
