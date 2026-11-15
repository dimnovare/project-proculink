"use client";

// The help panel: opens beside the page (over it on phones and tablets), never
// dims it and never traps focus. Search, the three tasks for this screen, Start
// here and popular articles; a task or article opens inside the panel.

import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/bridge/DSPrimitives";
import { ErrorBoundary } from "@/components/bridge/ErrorBoundary";
import { Quiet } from "@/components/flows/states";
import { loadHelpPage } from "@/components/help/helpPages";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { capture } from "@/lib/analytics";
import { POPULAR_ARTICLE_SLUGS, resolveArticles, type HelpArticle } from "@/lib/help-articles";
import { buildHelpFuse, searchHelpArticles } from "@/lib/help-search";
import { matchGuide } from "@/lib/section-guides";

export interface HelpPanelControl { open: boolean; show(): void; close(): void; toggle(): void }

const CLOSED: HelpPanelControl = { open: false, show() {}, close() {}, toggle() {} };
const HelpPanelContext = createContext<HelpPanelControl>(CLOSED);

/** Holds whether help is open. Outside it, useHelpPanel() is a closed no-op (top-bar unit tests render without it). */
export function HelpPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const control = useMemo<HelpPanelControl>(() => ({
    open,
    show: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen((o) => !o),
  }), [open]);
  return <HelpPanelContext.Provider value={control}>{children}</HelpPanelContext.Provider>;
}

export const useHelpPanel = () => useContext(HelpPanelContext);

type Page = ComponentType<{ components?: Record<string, unknown> }>;
const pages = new Map<string, Page>();
const pageFor = (href: string) => {
  let page = pages.get(href);
  if (!page) pages.set(href, (page = lazy(() => loadHelpPage(href))));
  return page;
};

type Props = { children?: ReactNode };
const PANEL_MDX = {
  wrapper: ({ children }: Props) => <div className="text-[14px] leading-relaxed text-ink [&_p]:my-3 [&_li]:my-1">{children}</div>,
  h1: ({ children }: Props) => <h3 className="m-0 mb-3 font-display text-[18px] font-semibold text-ink">{children}</h3>,
  h2: ({ children }: Props) => <h4 className="mb-2 mt-5 text-[16px] font-semibold text-ink">{children}</h4>,
  h3: ({ children }: Props) => <h5 className="mb-2 mt-4 text-[15px] font-semibold text-ink">{children}</h5>,
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} target="_blank" rel="noopener" className="font-semibold text-brand-blue" />,
};

const NEW_TAB = { target: "_blank", rel: "noopener" } as const;
const FOOT_LINK = "inline-flex items-center min-h-11 text-[13.5px] font-semibold text-brand-blue";
const H3 = "m-0 text-[14.5px] font-semibold text-ink";

/** The panel itself; renders nothing while closed. */
export function HelpPanel() {
  const { open, close } = useHelpPanel();
  const pathname = usePathname();
  const panelRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useDialogA11y({ open, onClose: close, panelRef, modal: false, initialFocusRef: searchRef });

  useEffect(() => {
    if (open) capture("help_slideover_opened", { route: pathname });
  }, [open, pathname]);

  if (!open) return null;
  return (
    <aside
      ref={panelRef}
      id="help-panel"
      aria-label="Help"
      className="absolute inset-x-0 bottom-[var(--plk-tabbar-h)] z-drawer max-h-[75dvh] rounded-t-[16px] border-t md:inset-x-auto md:right-0 md:inset-y-0 md:max-h-none md:w-[420px] md:rounded-none md:border-t-0 md:border-l min-[1440px]:static min-[1440px]:shrink-0 flex flex-col border-border bg-surface"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
        <h2 className="m-0 font-display text-[22px] font-semibold text-ink">Help</h2>
        <Button variant="ghost" aria-label="Close help" onClick={close} className="!h-11 !w-11 !px-0">
          <X size={20} aria-hidden />
        </Button>
      </div>
      <Body key={pathname} pathname={pathname} searchRef={searchRef} />
      <nav aria-label="Help links" className="flex justify-between gap-3 border-t border-border px-6 pb-6 md:pb-2 pt-2">
        <a href="/help" {...NEW_TAB} className={FOOT_LINK}>Open help centre</a>
        <a href="/support" {...NEW_TAB} className={FOOT_LINK}>Contact support</a>
        <a href="/support#report-a-bug" {...NEW_TAB} className={FOOT_LINK}>Report a problem</a>
      </nav>
    </aside>
  );
}

function Body({ pathname, searchRef }: { pathname: string | null; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const guide = matchGuide(pathname);
  const [article, setArticle] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const fuse = useMemo(() => buildHelpFuse(), []);
  const results = useMemo(() => searchHelpArticles(fuse, debounced, 6), [fuse, debounced]);
  const searching = debounced.trim().length > 0;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  // One help_search event per settled non-empty query.
  useEffect(() => {
    const q = debounced.trim();
    if (q) capture("help_search", { query_len: q.length, results: searchHelpArticles(fuse, q, 6).length, surface: "panel" });
  }, [debounced, fuse]);

  /** Plain clicks open the page here; modifier and middle clicks keep the link's own behaviour. */
  const opener = (href: string, surface: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    capture("help_article_click", { slug: href.replace(/^\/help\/(guides\/)?/, ""), surface, route: pathname });
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setArticle(href);
  };

  if (article) {
    const Page = pageFor(article);
    return (
      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
        <Button variant="ghost" onClick={() => setArticle(null)} className="self-start">Back to help</Button>
        <ErrorBoundary
          context="HelpPanel"
          fallback={() => (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-[14px] text-ink">We couldn&apos;t open this article.</p>
              <a href={article} {...NEW_TAB} className={FOOT_LINK + " self-start"}>Open it in the help centre</a>
            </div>
          )}
        >
          <Suspense fallback={<Quiet>Loading the article…</Quiet>}>
            <Page components={PANEL_MDX} />
          </Suspense>
          <a href={article} {...NEW_TAB} className={FOOT_LINK + " self-start"}>Open in the help centre</a>
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="help-panel-search" className="text-[13px] font-semibold text-ink">Search help articles</label>
        <input
          ref={searchRef}
          id="help-panel-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="For example: needs you"
          className="h-10 rounded-card-sm border border-border-strong bg-surface px-3 text-[14px] text-ink"
        />
      </div>
      {searching ? (
        <section aria-label="Search results" className="flex flex-col gap-1">
          <h3 className={H3}>Search results</h3>
          {results.length === 0
            ? <p className="m-0 text-[13.5px] text-ink-muted">Nothing matches. Try other words, or open the help centre.</p>
            : results.map((a) => <ArticleRow key={a.slug} article={a} onClick={opener(`/help/${a.slug}`, "panel_search")} showCategory />)}
        </section>
      ) : (
        <>
          {guide && (
            <section aria-label="Help for this screen" className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <h3 className={H3}>On this screen</h3>
                <span className="text-[13px] text-ink-muted">{guide.screen}</span>
              </div>
              {guide.tasks.map((t) => (
                <a key={t.title} href={t.href} onClick={opener(t.href, "panel_task")} className="flex min-h-11 flex-col justify-center py-1.5">
                  <span className="text-[14.5px] font-semibold text-brand-blue">{t.title}</span>
                  <span className="text-[13.5px] text-ink-muted">{t.line}</span>
                </a>
              ))}
            </section>
          )}
          {guide && (
            <div className="rounded-[10px] bg-brand-blue-soft px-4 py-3 text-brand-blue-deep">
              <h3 className="m-0 text-[14.5px] font-semibold">Start here</h3>
              <p className="m-0 mt-1 text-[13.5px]">{guide.startHere}</p>
            </div>
          )}
          <section aria-label="Popular articles" className="flex flex-col gap-1">
            <h3 className={H3}>Popular articles</h3>
            {resolveArticles(POPULAR_ARTICLE_SLUGS, 3).map((a) => (
              <ArticleRow key={a.slug} article={a} onClick={opener(`/help/${a.slug}`, "panel_popular")} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function ArticleRow({ article, onClick, showCategory }: { article: HelpArticle; onClick: React.MouseEventHandler<HTMLAnchorElement>; showCategory?: boolean }) {
  return (
    <a href={`/help/${article.slug}`} onClick={onClick} className="flex min-h-11 flex-col justify-center py-1.5">
      {showCategory && <span className="text-[12.5px] text-ink-faint">{article.category}</span>}
      <span className="text-[14.5px] font-semibold text-ink">{article.title}</span>
      <span className="text-[13px] text-ink-muted">{article.readMin} minute read</span>
    </a>
  );
}
