import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

export const metadata = pageMetadata({
  path: "/formats",
  title: "Formats & methods — ProcuLink",
  description:
    "Every format and method, in one place. ProcuLink reads the files you receive, shows what it read beside the original, and sends the data on in the format your system needs.",
  ogDescription:
    "ProcuLink reads the files you receive, shows what it read beside the original, and sends the data on in the format your system needs.",
});

// What every workspace has today (offer ⇔ works). The one exception is Microsoft OneDrive and
// SharePoint, which the founder offers on request and which says so in its own line.
const LISTS: Array<{ title: string; items: string[] }> = [
  {
    title: "Documents we read",
    items: ["PDF (with a text layer)", "CSV", "Excel", "Word", "Text", "XML", "JSON", "Scans and phone photos"],
  },
  {
    title: "Outputs",
    items: ["CSV", "JSON", "XML", "Excel", "PDF", "Text", "Fixed-width"],
  },
  {
    title: "Ways in and out",
    items: [
      "In: upload, a flow's own email address, a mailbox, SFTP, FTP, FTPS, an S3 bucket, our API",
      "Out: email, a web address, SFTP, FTPS, an S3 bucket, Google Drive, Google Sheets, download",
      "Microsoft OneDrive and SharePoint: on request",
    ],
  },
];

const INK = "#0B1A2F";
const MUTED = "#56627A";
const LINE = "#E2E6EE";

export default function FormatsPage() {
  return (
    <main className="mx-auto max-w-[860px] px-5 py-12 sm:py-16">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#6F4FCE" }}>Capabilities</p>
      <h1 className="mt-2 text-[30px] font-semibold leading-tight sm:text-[36px]" style={{ color: INK, fontFamily: "'Bricolage Grotesque', Inter, sans-serif", letterSpacing: "-0.02em" }}>
        Every format and method, in one place
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: MUTED }}>
        ProcuLink reads the files you receive, shows what it read beside the original, and sends the
        data on in the format your system needs. Scans and phone photos are read too.
      </p>

      {LISTS.map((l) => (
        <section key={l.title} className="mt-10">
          <h2 className="text-[18px] font-semibold" style={{ color: INK, fontFamily: "'Bricolage Grotesque', Inter, sans-serif" }}>{l.title}</h2>
          <ul className="mt-4 overflow-hidden rounded-[10px]" style={{ border: `1px solid ${LINE}` }}>
            {l.items.map((item, i) => (
              <li
                key={item}
                className="px-4 py-3 text-[13.5px]"
                style={{ borderTop: i === 0 ? "none" : `1px solid ${LINE}`, background: "#FFFFFF", color: INK }}
              >
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="mt-12 rounded-[12px] px-6 py-7 text-center" style={{ background: "#0B1A2F" }}>
        <h2 className="text-[20px] font-semibold" style={{ color: "#FFFFFF", fontFamily: "'Bricolage Grotesque', Inter, sans-serif" }}>
          Try it on your own documents
        </h2>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link href="/sign-up" className="rounded-[7px] px-5 py-2.5 text-[14px] font-semibold" style={{ background: "#297F34", color: "#FFFFFF" }}>
            Start your free trial
          </Link>
          <Link href="/book-demo" className="rounded-[7px] px-5 py-2.5 text-[14px] font-semibold" style={{ background: "transparent", color: "#FFFFFF", border: "1px solid #2B3F5E" }}>
            Talk to us
          </Link>
        </div>
      </div>
    </main>
  );
}
