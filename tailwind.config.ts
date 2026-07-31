import type { Config } from "tailwindcss";
// ESM import rather than `require()`: the repo's pre-commit hook runs eslint
// directly over staged .ts files, where @typescript-eslint/no-require-imports
// applies. `next lint` never sees this file, so the error only surfaced the
// first time the config was staged. tailwindcss-animate ships index.d.ts, so
// the default import is typed.
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * ProcuLink Tailwind config — "The Bridge Layer" v1.0
 *
 * Token structure matches the design-system/tokens/tailwind.config.ts
 * so all signature components (EdgeRails, CanonicalSpine, XCard, etc.)
 * can use Tailwind classes directly.
 *
 * shadcn/ui CSS-variable tokens are preserved for primitives compatibility.
 */

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      // ─── Colors ───────────────────────────────────────────────────────
      colors: {
        // Brand palette — kebab-case keys so `bg-brand-blue-soft` etc. work
        brand: {
          blue:         "#1E66C9",   // buyer / incoming / structure / trust
          "blue-deep":  "#0F4FA8",
          "blue-soft":  "#EAF0F8",
          "blue-soft-2":"#DCE8F7",
          green:        "#2E8E3A",   // supplier / outgoing / completion
          // Button-fill green: #2E8E3A is 4.1613:1 with white (fails AA small
          // text). Use green-btn for solid fills under white text; keep
          // `green` for text/icons/dots/borders on light surfaces.
          // Recomputed 2026-07-31: this is 5.0244:1 with white, not the ≈4.6:1
          // the call-site comments claim. The old figure understated it, so
          // nothing shipped wrong — but it is now mirrored as
          // --brand-green-btn in globals.css and the number is the measured one.
          "green-btn":  "#297F34",   // 5.0244:1 with white — AA — founder-approved
          "green-deep": "#1E6D29",
          "green-soft": "#E9F1EA",
          "green-soft-2":"#D8EBDA",
          // Accent steps legible on navy chrome (--brand-blue is 2.0:1 there).
          "blue-bright": "#6BA5F0",   // 6.87:1 on navy
          "green-bright":"#5FC06B",   // 7.68:1 on navy
          "green-pale":  "#BFE7C5",   // 13.83:1 on --navy-code
        },

        // Navy chrome (sidebar + topbar) + the marketing dark-section scale.
        // Mirrors globals.css :root exactly — see docs/design-system/
        // 11-unified-page-rules.md and scripts/check-tokens.mjs.
        navy: {
          DEFAULT: "#0B1A2F",
          surface: "#14253D",
          border:  "#1F3252",
          text:    "#C8D1E0",
          muted:   "#7C8DA6",
          faint:   "#9DB2CE",   // faint text on navy — 8.06:1
          line:    "#1B2D49",
          glow:    "#0E2545",
          deep:    "#0C1D34",
          deeper:  "#0A1729",
          well:    "#0A1626",
          inset:   "#081424",
          code:    "#071221",
          raised:  "#0F233C",
          pale:    "#AFC6EA",   // 10.05:1 on navy
          "pale-line": "#CBDDF6",
        },

        // Product-mock traffic lights, shared by both marketing pages.
        dot: {
          red:   "#E05A52",
          amber: "#E0B13A",
          green: "#3FA84C",
        },

        // Work-area surfaces — nested so `bg-surface-2` works
        bg:     "#F6F7FA",
        bgWarm: "#F8F6F1",
        surface: {
          DEFAULT: "#FFFFFF",
          "2":     "#F1F3F7",
        },

        // Border — nested so `border-border-strong` works
        border: {
          DEFAULT: "#E5E8EE",
          strong:  "#CBD0DA",
          faint:   "#EEF0F4",
        },

        // Ink (text)
        ink: {
          DEFAULT: "#0B1A2F",
          muted:   "#5E6779",
          // Mirror the darkened --ink-faint (globals.css): #98A0AE was ≈2.6:1 on
          // white and failed WCAG AA; #667085 is ≈5.2:1. Keeps `text-ink-faint`
          // in sync with the CSS variable so the utility passes AA too.
          faint:   "#667085",
        },

        // Semantic — nested so `bg-amber-soft`, `bg-danger-soft`, `bg-ai-soft` work
        amber: {
          DEFAULT: "#B36D14",
          soft:    "#FAF1DD",
          // Mirror --amber-text from globals.css. It has existed there since the
          // last a11y pass, but was never added here — so `text-amber-text`
          // silently produced nothing while `var(--amber-text)` worked. #B36D14
          // on --amber-soft is 3.65:1 (fails AA text); #8A5310 is 5.62:1.
          text:    "#8A5310",
          // Amber for NAVY chrome — #8A5310 is only 2.93:1 on --navy-inset.
          bright:  "#E0B13A",   // 9.26:1 on --navy-inset
        },
        danger: {
          DEFAULT: "#B43838",
          soft:    "#FAE6E6",
        },
        ai: {
          DEFAULT: "#6F4FCE",   // ONLY for AI-generated content
          soft:    "#F0EAFB",
          border:  "#D9CCF4",
        },

        // ─── shadcn/ui CSS-variable tokens (keep for primitives) ──────
        background:  "hsl(var(--background))",
        foreground:  "hsl(var(--foreground))",
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        input: "hsl(var(--input))",
        ring:  "hsl(var(--ring))",
        sidebar: {
          DEFAULT:              "hsl(var(--sidebar-background))",
          foreground:           "hsl(var(--sidebar-foreground))",
          primary:              "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent:               "hsl(var(--sidebar-accent))",
          "accent-foreground":  "hsl(var(--sidebar-accent-foreground))",
          border:               "hsl(var(--sidebar-border))",
          ring:                 "hsl(var(--sidebar-ring))",
        },
      },

      // ─── Typography ───────────────────────────────────────────────────
      fontFamily: {
        sans:    ['"Inter"',               "system-ui", "-apple-system", "sans-serif"],
        display: ['"Bricolage Grotesque"', '"Inter"',   "system-ui", "sans-serif"],
        mono:    ['"JetBrains Mono"',      "ui-monospace", "monospace"],
      },

      fontSize: {
        xs:           ["10px",   { lineHeight: "1.3" }],
        sm:           ["11.5px", { lineHeight: "1.4" }],
        "body-s":     ["12.5px", { lineHeight: "1.45" }],
        body:         ["13px",   { lineHeight: "1.5" }],
        "body-l":     ["14px",   { lineHeight: "1.55" }],
        h4:           ["16px",   { lineHeight: "1.35", letterSpacing: "-0.01em" }],
        h3:           ["18px",   { lineHeight: "1.3",  letterSpacing: "-0.015em" }],
        h2:           ["24px",   { lineHeight: "1.2",  letterSpacing: "-0.02em" }],
        h1:           ["32px",   { lineHeight: "1.15", letterSpacing: "-0.025em" }],
        "display-s":  ["36px",   { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        display:      ["48px",   { lineHeight: "1.0",  letterSpacing: "-0.03em" }],
        "display-l":  ["78px",   { lineHeight: "0.98", letterSpacing: "-0.035em" }],
      },

      // ─── Spacing — named DS tokens for signature components ──────────
      spacing: {
        "rail":      "4px",   // EdgeRails left/right rail thickness
        "card-edge": "3px",   // XCard cross-section edge strip
        "spine":     "3px",   // CanonicalSpine vertical line
        "topbar":    "52px",  // BridgeTopbar height
        "sidebar":   "220px", // BridgeSidebar width
      },

      // ─── Z-index scale ────────────────────────────────────────────────
      zIndex: {
        rails:   "1",
        sticky:  "10",
        drawer:  "20",
        topbar:  "30",
        popover: "40",
        modal:   "50",
        toast:   "60",
      },

      // ─── Border radius ────────────────────────────────────────────────
      borderRadius: {
        sm:        "4px",
        DEFAULT:   "6px",
        md:        "8px",
        lg:        "10px",
        xl:        "12px",
        "2xl":     "14px",
        full:      "9999px",
        // shadcn CSS-variable radius kept alongside:
        "card-sm": "6px",
        card:      "8px",
        "card-lg": "12px",
      },

      // ─── Shadows ─────────────────────────────────────────────────────
      // Named (card/pop/hero) kept; semantic elevation ramp (md/lg/xl) added
      // from the Claude Design v2 handoff. Additive — existing classes unchanged.
      boxShadow: {
        card: "0 1px 2px rgba(11,26,47,0.04)",
        pop:  "0 8px 24px rgba(11,26,47,0.10)",
        hero: "0 50px 120px rgba(11,26,47,0.10), 0 8px 24px rgba(11,26,47,0.06)",
        md:   "0 6px 16px rgba(11,26,47,0.09), 0 2px 5px rgba(11,26,47,0.05)",
        lg:   "0 16px 40px rgba(11,26,47,0.14), 0 4px 12px rgba(11,26,47,0.07)",
        xl:   "0 28px 68px rgba(11,26,47,0.20), 0 10px 24px rgba(11,26,47,0.10)",
      },

      // ─── Background gradients ─────────────────────────────────────────
      backgroundImage: {
        "link-spine":    "linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)",
        "bridge-deck":   "linear-gradient(90deg, #1E66C9, #2E8E3A)",
        "rail-buyer":    "linear-gradient(180deg, rgba(30,102,201,0.2), #1E66C9 50%, rgba(30,102,201,0.2))",
        "rail-supplier": "linear-gradient(180deg, rgba(46,142,58,0.2), #2E8E3A 50%, rgba(46,142,58,0.2))",
        "mark-gradient": "linear-gradient(90deg, #1E66C9, #2E8E3A)",
      },

      // ─── Transition timing ────────────────────────────────────────────
      transitionTimingFunction: {
        "ease-out-soft":    "cubic-bezier(0.16, 1, 0.3, 1)",
        "ease-in-out-soft": "cubic-bezier(0.65, 0, 0.35, 1)",
      },

      // ─── Keyframes ────────────────────────────────────────────────────
      keyframes: {
        // shadcn
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        // Bridge Layer
        "link-spine-fill": {
          "0%":   { clipPath: "inset(0 100% 0 0)" },
          "100%": { clipPath: "inset(0 0% 0 0)" },
        },
        "wire-pulse": {
          "0%":      { offsetDistance: "0%",   opacity: "0" },
          "10%, 90%":{ opacity: "1" },
          "100%":    { offsetDistance: "100%", opacity: "0" },
        },
        "node-pulse": {
          "0%":  { boxShadow: "0 0 0 0    rgba(30, 102, 201, 0.5)" },
          "70%": { boxShadow: "0 0 0 14px rgba(30, 102, 201, 0)" },
          "100%":{ boxShadow: "0 0 0 0    rgba(30, 102, 201, 0)" },
        },
        "connector-draw": {
          from: { strokeDashoffset: "200" },
          to:   { strokeDashoffset: "0" },
        },
        "spine-reveal": {
          "0%":   { opacity: "0", transform: "scale(0.85)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "fade-up": {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.7" },
        },
        // Wire topology traveller (used by SVG animateMotion shim)
        "wire-travel": {
          "0%":   { offsetDistance: "0%" },
          "100%": { offsetDistance: "100%" },
        },
      },

      // ─── Animations ───────────────────────────────────────────────────
      animation: {
        "accordion-down":  "accordion-down 0.2s ease-out",
        "accordion-up":    "accordion-up 0.2s ease-out",
        "link-spine":      "link-spine-fill 1200ms cubic-bezier(0.16,1,0.3,1) both",
        "wire-pulse":      "wire-pulse 6s linear infinite",
        "node-pulse":      "node-pulse 2s ease-out",
        "connector-draw":  "connector-draw 800ms cubic-bezier(0.16,1,0.3,1) forwards",
        "spine-reveal":    "spine-reveal 0.3s cubic-bezier(0.16,1,0.3,1) both",
        "fade-up":         "fade-up 0.4s cubic-bezier(0.16,1,0.3,1) both",
        "pulse-subtle":    "pulse-subtle 2s ease-in-out infinite",
        "wire-travel":     "wire-travel 6s linear infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
