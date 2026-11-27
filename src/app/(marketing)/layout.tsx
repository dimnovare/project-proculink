import { MarketingNav } from "@/components/marketing/MarketingNav";
import { SkipToContent } from "@/components/a11y/SkipToContent";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { EnglishOnly } from "@/components/marketing/EnglishOnlyNotice";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--surface)",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <SkipToContent />
      <MarketingNav />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <EnglishOnly>{children}</EnglishOnly>
      </main>

      <SiteFooter />
    </div>
  );
}
