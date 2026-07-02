import type { Config } from "tailwindcss";

/**
 * ProcuLink Tailwind preset — "The Bridge Layer".
 * Usage in tailwind.config.ts:
 *   import proculink from "./design-system/tailwind.preset";
 *   export default { presets: [proculink], content: [...] } satisfies Config;
 *
 * shadcn semantic colors read hsl(var(--x)) from shadcn-theme.css.
 * ProcuLink semantic colors read the --pl-* hex vars from tokens.css.
 */
const preset: Partial<Config> = {
  darkMode: ["class", '[data-pl-chrome="navy"]'],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },

        // ProcuLink semantic (direct hex vars from tokens.css)
        source:  { DEFAULT: "var(--pl-blue)",  deep: "var(--pl-blue-deep)",  soft: "var(--pl-blue-soft)",  foreground: "#fff" },
        output:  { DEFAULT: "var(--pl-green)", deep: "var(--pl-green-deep)", soft: "var(--pl-green-soft)", foreground: "#fff" },
        warn:    { DEFAULT: "var(--pl-amber)", soft: "var(--pl-amber-soft)", foreground: "#fff" },
        blocker: { DEFAULT: "var(--pl-danger)", soft: "var(--pl-danger-soft)", foreground: "#fff" },
        assist:  { DEFAULT: "var(--pl-ai)", soft: "var(--pl-ai-soft)", border: "var(--pl-ai-border)", foreground: "#fff" },
        navy:    { DEFAULT: "var(--pl-navy)", surface: "var(--pl-navy-surface)", border: "var(--pl-navy-border)", text: "var(--pl-navy-text)", muted: "var(--pl-navy-muted)" },
        ink:     { DEFAULT: "var(--pl-ink)", muted: "var(--pl-ink-muted)", faint: "var(--pl-ink-faint)" },
        surface: { DEFAULT: "var(--pl-surface)", 2: "var(--pl-surface-2)" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Bricolage Grotesque", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "var(--pl-radius-sm)", DEFAULT: "var(--pl-radius)", md: "var(--pl-radius-md)",
        lg: "var(--pl-radius-lg)", xl: "var(--pl-radius-xl)", "2xl": "var(--pl-radius-2xl)",
      },
      boxShadow: {
        sm: "var(--pl-shadow-sm)", DEFAULT: "var(--pl-shadow)", md: "var(--pl-shadow-md)",
        lg: "var(--pl-shadow-lg)", xl: "var(--pl-shadow-xl)",
      },
      transitionTimingFunction: { bridge: "cubic-bezier(0.16,1,0.3,1)" },
      keyframes: {
        "pl-node-pulse": { "0%": { boxShadow: "0 0 0 0 rgba(30,102,201,.5)" }, "70%": { boxShadow: "0 0 0 12px rgba(30,102,201,0)" }, "100%": { boxShadow: "0 0 0 0 rgba(30,102,201,0)" } },
        "pl-connector-draw": { from: { strokeDashoffset: "200" }, to: { strokeDashoffset: "0" } },
      },
      animation: { "pl-node-pulse": "pl-node-pulse 2s var(--pl-ease) infinite", "pl-connector-draw": "pl-connector-draw .6s var(--pl-ease) forwards" },
    },
  },
};
export default preset;
