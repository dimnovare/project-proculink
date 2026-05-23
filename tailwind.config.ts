import type { Config } from "tailwindcss";

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
      // ─── Bridge Layer tokens ──────────────────────────────────────────
      colors: {
        // Brand palette
        brand: {
          blue:      "#1E66C9", // buyer / incoming / structure / trust
          blueDeep:  "#0F4FA8",
          blueSoft:  "#E3EDFB",
          green:     "#2E8E3A", // supplier / outgoing / completion
          greenDeep: "#1E6D29",
          greenSoft: "#E2F1E2",
        },
        // Navy chrome (sidebar + topbar)
        navy: {
          DEFAULT: "#0B1A2F",
          surface: "#10243E",
          border:  "#1C2F49",
          text:    "#C5D2E4",
          muted:   "#7C8DA6",
        },
        // Work area
        bg:          "#F6F7FA",
        bgWarm:      "#F8F6F1",
        surface:     "#FFFFFF",
        surface2:    "#EFF2F7",
        border:      "#E2E6EE",
        borderStrong:"#C6CDDA",
        // Ink (text)
        ink: {
          DEFAULT: "#0B1A2F",
          muted:   "#56627A",
          faint:   "#8A93A5",
        },
        // Semantic
        amber:      "#C97A14",
        amberSoft:  "#FAEFD6",
        danger:     "#C53A3A",
        dangerSoft: "#FBE3E3",
        ai:         "#6F4FCE", // ONLY for AI-generated content
        aiSoft:     "#EEE7FB",

        // ─── shadcn/ui CSS-variable tokens (keep for primitives) ─────
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
        sans:    ['"Inter"',               "system-ui", "sans-serif"],
        display: ['"Bricolage Grotesque"', '"Inter"',   "system-ui", "sans-serif"],
        mono:    ['"JetBrains Mono"',      "ui-monospace", "monospace"],
      },

      // ─── Background gradients ─────────────────────────────────────────
      backgroundImage: {
        "link-spine":    "linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)",
        "bridge-deck":   "linear-gradient(90deg, #1E66C9, #2E8E3A)",
        "rail-buyer":    "linear-gradient(180deg, rgba(30,102,201,0.12), #1E66C9 50%, rgba(30,102,201,0.12))",
        "rail-supplier": "linear-gradient(180deg, rgba(46,142,58,0.12), #2E8E3A 50%, rgba(46,142,58,0.12))",
        "mark-gradient": "linear-gradient(90deg, #1E66C9, #2E8E3A)",
      },

      // ─── Radii ────────────────────────────────────────────────────────
      borderRadius: {
        "card-sm": "6px",
        card:      "8px",
        "card-lg": "12px",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },

      // ─── Keyframes ────────────────────────────────────────────────────
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        // Wire-topology travelling pulse
        "wire-travel": {
          "0%":   { offsetDistance: "0%" },
          "100%": { offsetDistance: "100%" },
        },
        // Link-spine activation fill
        "spine-fill": {
          from: { backgroundSize: "0% 100%" },
          to:   { backgroundSize: "100% 100%" },
        },
        // Status node pulse ring
        "node-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(30,102,201,0.4)" },
          "50%":      { boxShadow: "0 0 0 6px rgba(30,102,201,0)" },
        },
        // Subtle pulse for active elements
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.7" },
        },
      },

      animation: {
        "accordion-down":  "accordion-down 0.2s ease-out",
        "accordion-up":    "accordion-up 0.2s ease-out",
        "wire-travel":     "wire-travel 6s linear infinite",
        "spine-fill":      "spine-fill 1.2s ease-out forwards",
        "node-pulse":      "node-pulse 1.5s ease-in-out",
        "pulse-subtle":    "pulse-subtle 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
