import { Check } from "lucide-react";
import { Card } from "@/components/bridge/layout/Card";
import { useCopy } from "@/i18n/useCopy";
import { CsvFile, EXAMPLE_INVOICE, InvoiceSheet, LookValue, SITE } from "./sitePictures";

// Home's example, the one picture on the site that moves by itself. Pure CSS,
// once, 4.4 seconds. The static styles ARE the finished picture; each keyframe
// only says where an element comes FROM, and only opacity and transform move,
// so nothing shifts layout. With reduced motion every animation is off and the
// visitor sees exactly the picture the animation ends on, the Total still
// marked to check the way the Review screen marks it.
const CSS = `
.plk-ex-hl{transform-origin:left center}
.plk-ex-track{opacity:0}
@keyframes plk-ex-grow{from{transform:scaleX(0)}}
@keyframes plk-ex-rise{from{opacity:0;transform:translateY(6px)}}
@keyframes plk-ex-pop{from{opacity:0;transform:scale(.6)}}
@keyframes plk-ex-run{0%{opacity:1;transform:translateX(-100%)}90%{opacity:1;transform:none}100%{opacity:0;transform:none}}
.plk-ex .plk-ex-hl{animation:plk-ex-grow .4s ease-out 1 both}
.plk-ex .plk-ex-hl-1{animation-delay:.2s}
.plk-ex .plk-ex-hl-2{animation-delay:.35s}
.plk-ex .plk-ex-hl-3{animation-delay:.5s}
.plk-ex .plk-ex-hl-4{animation-delay:.65s}
.plk-ex .plk-ex-hl-5{animation-delay:.8s}
.plk-ex .plk-ex-val{animation:plk-ex-rise .6s ease-out 1 both}
.plk-ex .plk-ex-val-1{animation-delay:1s}
.plk-ex .plk-ex-val-2{animation-delay:1.15s}
.plk-ex .plk-ex-val-3{animation-delay:1.3s}
.plk-ex .plk-ex-val-4{animation-delay:1.45s}
.plk-ex .plk-ex-val-5{animation-delay:1.6s}
.plk-ex .plk-ex-need{animation:plk-ex-rise .6s ease-out 1.8s 1 both}
.plk-ex .plk-ex-line{animation:plk-ex-rise .5s ease-out 1 both}
.plk-ex .plk-ex-line:nth-child(1){animation-delay:2.8s}
.plk-ex .plk-ex-line:nth-child(2){animation-delay:2.9s}
.plk-ex .plk-ex-line:nth-child(3){animation-delay:3s}
.plk-ex .plk-ex-line:nth-child(4){animation-delay:3.1s}
.plk-ex .plk-ex-sent{animation:plk-ex-pop .5s ease-out 1 both}
.plk-ex .plk-ex-sent-1{animation-delay:3.6s}
.plk-ex .plk-ex-sent-2{animation-delay:3.9s}
.plk-ex .plk-ex-track{animation:plk-ex-run 4.2s ease-in-out .2s 1 both}
@media (prefers-reduced-motion: reduce){.plk-ex,.plk-ex *{animation:none!important}}
`;

const VALUES = [
  ["Invoice number", EXAMPLE_INVOICE.number],
  ["Date", EXAMPLE_INVOICE.date],
  ["Supplier", EXAMPLE_INVOICE.supplier],
  ["Total", EXAMPLE_INVOICE.totalPlain],
  ["Lines", "3 rows, 5 columns"],
] as const;

function StageHead({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[15px] font-semibold">
      <span className={`size-[9px] rounded-full ${dot}`} />
      {children}
    </p>
  );
}

export function HomeExample() {
  const { c } = useCopy("pictures");
  return (
    <div
      data-testid="home-example"
      role="img"
      aria-label={c("example.label", "An example: an invoice arrives as a PDF, ProcuLink reads its values, and a CSV file is sent to an accounting server and a Google Sheet.")}
      className="plk-ex relative pt-[30px]"
    >
      <style>{CSS}</style>
      <div aria-hidden="true" className="absolute inset-x-0 top-2 h-0.5 rounded-[1px] bg-link-spine" />
      <div aria-hidden="true" className="absolute inset-x-0 top-0.5 hidden h-3.5 overflow-hidden min-[900px]:block">
        <div className="plk-ex-track absolute inset-0">
          <span className="absolute right-0 top-0 size-3.5 rounded-full border-[3px] border-brand-green bg-surface" />
        </div>
      </div>
      <div aria-hidden="true" className="grid items-start gap-x-8 gap-y-7 min-[680px]:grid-cols-2 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4">
          <StageHead dot="bg-brand-blue">{c("example.arrived", "What arrived")}</StageHead>
          <InvoiceSheet marked className="-rotate-1" />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <StageHead dot="bg-navy">{c("example.read", "What we read")}</StageHead>
          <Card flush className="text-[14.5px]">
            {VALUES.map(([label, value], i) => (
              <div key={label} className={`plk-ex-val plk-ex-val-${i + 1} flex items-center gap-3 border-t border-border-faint px-4 py-[11px] first:border-t-0`}>
                {label === "Total" ? (
                  <LookValue label={c(`example.values.${i}`, label)} value={value} sentenceClass="plk-ex-need" />
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className={`${SITE.soft} text-[12.5px]`}>{c(`example.values.${i}`, label)}</p>
                      <p className="font-semibold">{label === "Lines" ? c("example.lines", value) : value}</p>
                    </div>
                    <Check aria-hidden="true" className="size-[18px] shrink-0 text-brand-green-deep" strokeWidth={2.5} />
                  </>
                )}
              </div>
            ))}
          </Card>
          <p className={`${SITE.soft} text-[14px]`}>{c("example.marked", "Anything missing or hard to read is marked, so you know where to look.")}</p>
        </div>
        {/* Spans both columns at two-up widths, so it is never left beside an empty half. */}
        <div className="flex min-w-0 flex-col gap-4 min-[680px]:max-lg:col-span-2">
          <StageHead dot="bg-brand-green">{c("example.send", "What we send")}</StageHead>
          <CsvFile sent />
          <p className={`${SITE.soft} text-[14px]`}>{c("example.expects", "The file your system expects, sent where it needs to go.")}</p>
        </div>
      </div>
    </div>
  );
}
