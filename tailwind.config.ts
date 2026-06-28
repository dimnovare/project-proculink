import type { Config } from "tailwindcss";

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
          "green-deep": "#1E6D29",
          "green-soft": "#E9F1EA",
          "green-soft-2":"#D8EBDA",
        },

        // Navy chrome (sidebar + topbar)
        navy: {
          DEFAULT: "#0B1A2F",
          surface: "#14253D",
          border:  "#1F3252",
          text:    "#C8D1E0",
          muted:   "#7C8DA6",
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
          faint:   "#98A0AE",
        },

        // Semantic — nested so `bg-amber-soft`, `bg-danger-soft`, `bg-ai-soft` work
        amber: {
          DEFAULT: "#B36D14",
          soft:    "#FAF1DD",
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
        full:      "9999px",
        // shadcn CSS-variable radius kept alongside:
        "card-sm": "6px",
        card:      "8px",
        "card-lg": "12px",
      },

      // ─── Shadows ─────────────────────────────────────────────────────
      boxShadow: {
        card: "0 1px 2px rgba(11,26,47,0.04)",
        pop:  "0 8px 24px rgba(11,26,47,0.10)",
        hero: "0 50px 120px rgba(11,26,47,0.10), 0 8px 24px rgba(11,26,47,0.06)",
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
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
