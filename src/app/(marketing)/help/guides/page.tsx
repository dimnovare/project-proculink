import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { GuideIndex } from "@/components/help/guide/GuideIndex";

export const metadata = pageMetadata({
  path: "/help/guides",
  title: "Step-by-step setup guides — ProcuLink",
  description:
    "Numbered walkthroughs for setting ProcuLink up: receiving orders by email, API, or a watched folder, adding suppliers and catalogs, mapping fields, and delivering to your supplier.",
  ogDescription:
    "Numbered walkthroughs for setting up order intake, suppliers, mapping, and delivery in ProcuLink.",
});

export default function GuidesIndexPage() {
  return (
    <div className="mx-auto px-5 pb-24 pt-10 sm:px-6 sm:pt-14" style={{ maxWidth: 860 }}>
      <Link
        href="/help"
        className="mb-6 inline-flex h-9 items-center gap-2 rounded-[7px] px-3 text-[13px] font-semibold"
        style={{
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--ink)",
          textDecoration: "none",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <span aria-hidden>←</span>
        Help center
      </Link>

      <header>
        <span
          className="inline-flex items-center rounded-full px-3 py-1 text-[11.5px] font-semibold uppercase"
          style={{
            color: "var(--brand-blue-deep)",
            background: "var(--brand-blue-soft)",
            letterSpacing: "0.05em",
          }}
        >
          Guides
        </span>
        <h1
          className="mt-3.5"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(28px, 4.5vw, 36px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            lineHeight: 1.15,
            color: "var(--ink)",
            margin: "14px 0 0",
          }}
        >
          Set-up guides
        </h1>
        <p className="mt-2.5 text-[15px]" style={{ color: "var(--ink-muted)", lineHeight: 1.65 }}>
          One task per guide, in numbered steps, with what to do when a step does not work. The
          help articles stay the reference — a guide is the procedure. We are converting the
          library one task at a time; the sections below show what is written and what is still
          to come.
        </p>
        <div
          aria-hidden="true"
          className="mt-5 h-0.5 w-full"
          style={{ background: "var(--gradient-link-spine)", opacity: 0.5, borderRadius: 2 }}
        />
      </header>

      <GuideIndex audience="client" />

      <p className="mt-10 text-center text-[13.5px]" style={{ color: "var(--ink-muted)" }}>
        Need a guide that is not here yet?{" "}
        <Link
          href="/support"
          className="font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
          style={{ color: "var(--brand-blue-deep)" }}
        >
          Ask support →
        </Link>
      </p>
    </div>
  );
}
