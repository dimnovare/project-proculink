"use client";

// The public site's one header: logo, the five pages (from 900px), Sign in and
// the filled action, and below 900px a menu sheet.

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { ProcuLinkMark } from "@/components/bridge/DSPrimitives";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useCopy } from "@/i18n/useCopy";
import { LanguageList, LanguageMenuButton } from "./LanguageSwitcher";

// Clerk is the heaviest dependency of the public pages (~140 kB). The probe is
// code-split (ssr: false), renders nothing, and only reports a signed-in
// session. The links below are rendered signed-out by the server and change
// their words in place when the probe reports, so nothing jumps and no focused
// node is replaced. With no publishable key nothing from Clerk loads at all.
const MarketingClerkLinks = dynamic(
  () => import("@/components/marketing/MarketingClerkLinks").then((m) => m.MarketingClerkLinks),
  { ssr: false, loading: () => null },
);

export const SITE_LINKS = [
  ["How it works", "/how-it-works"],
  ["Formats", "/formats"],
  ["Pricing", "/pricing"],
  ["Security", "/security"],
  ["Help", "/help"],
] as const satisfies readonly (readonly [label: string, href: string])[];

/** True when the visitor is on `href` or below it ("/help/flows" is under "/help"; "/helpful" is not). */
export function isCurrentSection(pathname: string | null, href: string): boolean {
  return pathname != null && (pathname === href || pathname.startsWith(`${href}/`));
}

const WIDE = "(min-width: 900px)";
const FILLED =
  "inline-flex h-11 min-w-[9.5rem] items-center justify-center whitespace-nowrap rounded-lg bg-brand-green-btn px-4 text-[15px] max-[389px]:min-w-[7rem] max-[389px]:px-3.5 font-semibold text-white hover:bg-brand-green-deep";

export function MarketingNav() {
  const pathname = usePathname();
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mainNavRef = useRef<HTMLElement>(null);
  const widened = useRef(false);
  const closeMenu = useCallback(() => setOpen(false), []);
  const { c } = useCopy("nav");
  // With the language button, and German or Polish words, the row is full at 900px: until 1180px the links sit
  // closer and a size smaller.
  const pad = "whitespace-nowrap px-1.5 text-[14px] min-[1180px]:px-3 min-[1180px]:text-[15px]";
  /** A page link's label in the reader's language, keyed by its path ("/how-it-works" is "how-it-works"). */
  const linkLabel = (label: string, href: string) => c(href.slice(1), label);

  // The sheet is navigation by content but an opaque `fixed inset-0` layer by
  // behaviour, so it is a modal: trap, Escape, focus back to the Menu button.
  // Focus lands on the sheet itself (no ring), not its first link: a tap must not light up the logo. Tab goes on from there.
  useDialogA11y({ open, onClose: closeMenu, panelRef: menuRef, initialFocusRef: menuRef });

  // A sheet left open while the window widens past 900px closes. jsdom has no matchMedia.
  useEffect(() => {
    if (!open || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(WIDE);
    const widen = () => {
      widened.current = true;
      setOpen(false);
    };
    if (mq.matches) {
      widen();
      return;
    }
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) widen();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [open]);

  // Closing on widen hands focus back to the Menu button, which the wide header
  // hides, so focus would fall to the page. This runs after the dialog hook has
  // restored focus and moves it to the first page link instead.
  useEffect(() => {
    if (open || !widened.current) return;
    widened.current = false;
    mainNavRef.current?.querySelector<HTMLElement>("a")?.focus();
  }, [open]);

  const action = signedIn
    ? { label: c("open", "Open ProcuLink"), href: "/documents" }
    : { label: c("startFree", "Start free"), href: "/sign-up" };

  return (
    <header className="on-navy sticky top-0 z-40 bg-navy">
      <div className="mx-auto flex h-[60px] max-w-[1160px] items-center gap-2 px-6 min-[900px]:h-16">
        <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2.5">
          <span className="inline-flex [&>svg]:size-[26px] min-[900px]:[&>svg]:size-7">
            <ProcuLinkMark size={28} />
          </span>
          {/* At 360px (312px inside px-6): mark + word ~125, the 112px filled box and Menu 44 fit, so the word gives way
              only below 350px, signed in or not. It stays the link's name either way. */}
          <span className="font-display text-[19px] font-bold tracking-[-0.02em] text-white max-[349px]:sr-only min-[900px]:text-[20px]">
            ProcuLink
          </span>
        </Link>

        <nav ref={mainNavRef} aria-label="Main" className="ml-2 hidden items-center min-[900px]:flex min-[1180px]:ml-4">
          {SITE_LINKS.map(([label, href]) => {
            const current = isCurrentSection(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex h-11 items-center ${pad} ${
                  current ? "font-semibold text-white" : "font-medium text-navy-text hover:text-white"
                }`}
              >
                {linkLabel(label, href)}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <LanguageMenuButton />
          {/* Signed in, "Sign in" keeps its box (so nothing moves) but leaves the reading and tab order. */}
          <Link
            href="/sign-in"
            aria-hidden={signedIn || undefined}
            tabIndex={signedIn ? -1 : undefined}
            className={`hidden h-11 items-center ${pad} font-medium text-navy-text hover:text-white min-[900px]:inline-flex ${
              signedIn ? "invisible" : ""
            }`}
          >
            {c("signIn", "Sign in")}
          </Link>
          <Link href={action.href} className={FILLED}>
            {/* Below 390px the box keeps one width for both labels (nothing moves when sign-in resolves): it shows
                "Open" and still reads out "Open ProcuLink". */}
            {signedIn ? (
              <>
                <span aria-hidden className="min-[390px]:hidden">{c("openShort", "Open")}</span>
                <span className="max-[389px]:sr-only">{action.label}</span>
              </>
            ) : action.label}
          </Link>
          {clerkEnabled && <MarketingClerkLinks onSignedInChange={setSignedIn} />}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={c("menu", "Menu")}
            aria-expanded={open}
            aria-controls="marketing-mobile-menu"
            className="inline-flex h-11 w-11 items-center justify-center text-white min-[900px]:hidden"
          >
            <Menu aria-hidden="true" className="size-6" />
          </button>
        </div>
      </div>
      <div aria-hidden="true" className="h-0.5 bg-link-spine" />

      {open && (
        <div
          id="marketing-mobile-menu"
          ref={menuRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={c("menu", "Menu")}
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-navy outline-none min-[900px]:hidden"
        >
          <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-navy-line px-6">
            <Link href="/" onClick={closeMenu} className="flex items-center gap-2.5">
              <ProcuLinkMark size={26} />
              <span className="font-display text-[19px] font-bold tracking-[-0.02em] text-white">ProcuLink</span>
            </Link>
            <button
              type="button"
              onClick={closeMenu}
              aria-label={c("closeMenu", "Close menu")}
              className="inline-flex h-11 w-11 items-center justify-center text-white"
            >
              <X aria-hidden="true" className="size-6" />
            </button>
          </div>

          <nav aria-label="Mobile" className="flex flex-col gap-1 px-4 pt-4">
            {SITE_LINKS.map(([label, href]) => {
              const current = isCurrentSection(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={closeMenu}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-12 items-center border-b border-navy-line px-3 text-[17px] ${
                    current ? "font-semibold text-white" : "font-medium text-navy-text"
                  }`}
                >
                  {linkLabel(label, href)}
                </Link>
              );
            })}
            {!signedIn && (
              <Link
                href="/sign-in"
                onClick={closeMenu}
                className="flex min-h-12 items-center border-b border-navy-line px-3 text-[17px] font-medium text-navy-text"
              >
                {c("signIn", "Sign in")}
              </Link>
            )}
            <Link href={action.href} onClick={closeMenu} className={`${FILLED} mt-5 !min-h-12 w-full`}>
              {action.label}
            </Link>
          </nav>

          <div role="group" aria-labelledby="mobile-language" className="px-4 pb-8 pt-8">
            <p id="mobile-language" className="mb-1 px-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-navy-faint">
              {c("language", "Language")}
            </p>
            <LanguageList variant="sheet" />
          </div>
        </div>
      )}
    </header>
  );
}
