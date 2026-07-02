// redesign/core.jsx — design tokens, icons, primitives → window.PL
// "The Bridge Layer", simplified. Navy chrome · blue = source/buyer · green = supplier/output.

const T = {
  blue: "#1E66C9", blueDeep: "#0F4FA8", blueSoft: "#EAF0F8", blueSoft2: "#DCE8F7",
  green: "#2E8E3A", greenDeep: "#1E6D29", greenSoft: "#E9F1EA", greenSoft2: "#D8EBDA",
  navy: "#0B1A2F", navySurface: "#14253D", navyBorder: "#1F3252",
  navyText: "#C8D1E0", navyMuted: "#7C8DA6",
  bg: "#F6F7FA", surface: "#FFFFFF", surface2: "#F1F3F7",
  border: "#E5E8EE", borderStrong: "#CBD0DA", borderFaint: "#EEF0F4",
  ink: "#0B1A2F", inkMuted: "#5E6779", inkFaint: "#98A0AE",
  amber: "#B36D14", amberSoft: "#FAF1DD",
  danger: "#B43838", dangerSoft: "#FAE6E6",
  ai: "#6F4FCE", aiSoft: "#F0EAFB", aiBorder: "#D9CCF4",
  ui: '"Inter", -apple-system, system-ui, sans-serif',
  display: '"Bricolage Grotesque", "Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};
T.linkGradient = `linear-gradient(90deg, ${T.blue} 0%, ${T.blue} 35%, ${T.green} 65%, ${T.green} 100%)`;
// ---- elevation ramp (premium, layered) ----
T.shadowSm = "0 1px 2px rgba(11,26,47,0.05)";
T.shadow   = "0 1px 3px rgba(11,26,47,0.05), 0 1px 2px rgba(11,26,47,0.04)";
T.shadowMd = "0 6px 16px rgba(11,26,47,0.09), 0 2px 5px rgba(11,26,47,0.05)";
T.shadowLg = "0 16px 40px rgba(11,26,47,0.14), 0 4px 12px rgba(11,26,47,0.07)";
T.shadowXl = "0 28px 68px rgba(11,26,47,0.20), 0 10px 24px rgba(11,26,47,0.10)";
T.ease = "cubic-bezier(0.16,1,0.3,1)";

/* ---------- Brand mark: an open link, blue node → green node ---------- */
function Mark({ size = 24 }) {
  const id = `mk-${Math.round(Math.random() * 1e5)}`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" style={{ flexShrink: 0 }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={T.blue}/><stop offset="100%" stopColor={T.green}/></linearGradient></defs>
      <path d="M8 10h14a10 10 0 0 1 10 10 10 10 0 0 1-10 10H8" stroke={`url(#${id})`} strokeWidth="3.6" strokeLinecap="round" fill="none"/>
      <circle cx="8" cy="10" r="2.6" fill={T.blue}/><circle cx="8" cy="30" r="2.6" fill={T.green}/>
    </svg>
  );
}

function LinkSpine({ height = 2, soft = true }) {
  return <div style={{ height, background: soft
    ? `linear-gradient(90deg, transparent, ${T.blue}99 28%, ${T.green}99 72%, transparent)`
    : T.linkGradient }} />;
}

/* ---------- Icons (1.3–1.5 stroke, 16 grid) ---------- */
const Icon = {
  Search: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke={c} strokeWidth="1.4"/><path d="M11 11l3 3" stroke={c} strokeWidth="1.4" strokeLinecap="round"/></svg>),
  Bell: ({ s = 16, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5v2.2c0 .5-.2 1-.6 1.4L3 11h10l-.9-1.4c-.4-.4-.6-.9-.6-1.4V6A3.5 3.5 0 0 0 8 2.5z" stroke={c} strokeWidth="1.3"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke={c} strokeWidth="1.3"/></svg>),
  Help: ({ s = 16, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.3" stroke={c} strokeWidth="1.3"/><path d="M6.4 6.2a1.7 1.7 0 0 1 3.1.9c0 1.1-1.5 1.3-1.5 2.3" stroke={c} strokeWidth="1.3" strokeLinecap="round"/><circle cx="8" cy="11.4" r=".7" fill={c}/></svg>),
  Upload: ({ s = 16, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 11V3M5 6l3-3 3 3M3 12v1.5h10V12" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  Orders: ({ s = 16, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke={c} strokeWidth="1.3"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>),
  Today: ({ s = 16, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke={c} strokeWidth="1.3"/><path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>),
  Flow: ({ s = 16, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="2" stroke={c} strokeWidth="1.3"/><circle cx="12" cy="12" r="2" stroke={c} strokeWidth="1.3"/><path d="M6 4h3a2 2 0 0 1 2 2v4" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>),
  Warn: ({ s = 16, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 2.5l6 10.5H2z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/><path d="M8 6.5V9M8 11v.4" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>),
  Check: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12 13 4.5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  CheckCircle: ({ s = 16, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.3" stroke={c} strokeWidth="1.3"/><path d="M5.2 8.2L7 10l3.8-4" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  X: ({ s = 12, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke={c} strokeWidth="1.6" strokeLinecap="round"/></svg>),
  Sparkle: ({ s = 12, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 12 12" fill="none"><path d="M6 1.2l1.1 3.2 3.2 1.1-3.2 1.1L6 9.8 4.9 6.6 1.7 5.5l3.2-1.1z" fill={c}/></svg>),
  Chevron: ({ s = 12, dir = "right", c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 12 12" fill="none" style={{ transform: dir === "down" ? "rotate(90deg)" : dir === "left" ? "rotate(180deg)" : dir === "up" ? "rotate(-90deg)" : "", transition: "transform .18s" }}><path d="M4.5 2.5L8 6l-3.5 3.5" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  ArrowRight: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5M11 8H2" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  ArrowLeft: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M10 3l-5 5 5 5M5 8h9" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  Send: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5z" stroke={c} strokeWidth="1.4" strokeLinejoin="round"/></svg>),
  Save: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M3 2.5h8l2 2V13.5H3zM5.5 2.5v3h5v-3M5.5 13.5v-4h5v4" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/></svg>),
  Edit: ({ s = 13, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/></svg>),
  Eye: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke={c} strokeWidth="1.3"/><circle cx="8" cy="8" r="1.8" stroke={c} strokeWidth="1.3"/></svg>),
  Refresh: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M13 5a5.5 5.5 0 1 0 1 4" stroke={c} strokeWidth="1.4" strokeLinecap="round"/><path d="M13 2v3h-3" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  Plus: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke={c} strokeWidth="1.6" strokeLinecap="round"/></svg>),
  Clock: ({ s = 13, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.3" stroke={c} strokeWidth="1.3"/><path d="M8 4.5V8l2.5 1.5" stroke={c} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  Grip: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="6" cy="4" r="1" fill={c}/><circle cx="10" cy="4" r="1" fill={c}/><circle cx="6" cy="8" r="1" fill={c}/><circle cx="10" cy="8" r="1" fill={c}/><circle cx="6" cy="12" r="1" fill={c}/><circle cx="10" cy="12" r="1" fill={c}/></svg>),
  Download: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M8 2.5v7M5 7l3 2.5L11 7M3 12.5h10" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  Copy: ({ s = 13, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke={c} strokeWidth="1.3"/><path d="M3.5 10.5h-1V3a.5.5 0 0 1 .5-.5h7.5v1" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>),
  Dots: ({ s = 16, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="1.2" fill={c}/><circle cx="8" cy="8" r="1.2" fill={c}/><circle cx="12" cy="8" r="1.2" fill={c}/></svg>),
  Phone: ({ s = 16, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" stroke={c} strokeWidth="1.3"/><path d="M7 12.5h2" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>),
  Doc: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M4 2h5l3 3v9H4z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/><path d="M9 2v3h3" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/></svg>),
  Lock: ({ s = 13, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><rect x="3.5" y="7" width="9" height="6.5" rx="1.3" stroke={c} strokeWidth="1.3"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke={c} strokeWidth="1.3"/></svg>),
  Gear: ({ s = 16, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke={c} strokeWidth="1.3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke={c} strokeWidth="1.3" strokeLinecap="round"/></svg>),
  Bolt: ({ s = 14, c = "currentColor" }) => (<svg width={s} height={s} viewBox="0 0 16 16" fill="none"><path d="M9 1.5L3.5 9H8l-1 5.5L13 7H8.5z" stroke={c} strokeWidth="1.3" strokeLinejoin="round"/></svg>),
};

/* ---------- ConfidenceChip ---------- */
function ConfidenceChip({ value, sm }) {
  if (value == null) return null;
  if (window.plTweaks && window.plTweaks().confidence === false) return null;
  const tone = value >= 90 ? { fg: T.greenDeep, bg: T.greenSoft } : value >= 75 ? { fg: T.amber, bg: T.amberSoft } : { fg: T.danger, bg: T.dangerSoft };
  return (<span style={{ fontFamily: T.mono, fontSize: sm ? 10 : 10.5, fontWeight: 600, padding: sm ? "1px 5px" : "2px 6px", borderRadius: 4, background: tone.bg, color: tone.fg, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{value}%</span>);
}

/* ---------- SrcChip ---------- */
function SrcChip({ type, sm }) {
  const colors = { PDF: "#B43838", XLSX: T.greenDeep, EXCEL: T.greenDeep, CSV: "#345470", XML: "#5E3DB0", cXML: "#5E3DB0", EDI: T.amber, EMAIL: "#4A5568", API: T.greenDeep, JSON: "#846100", UBL: "#5E3DB0", X12: T.amber };
  return (<span style={{ fontFamily: T.mono, fontSize: sm ? 9 : 10, fontWeight: 700, padding: sm ? "1px 4px" : "2px 6px", borderRadius: 3, background: T.surface2, color: colors[type] || T.inkMuted, letterSpacing: "0.04em", border: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>{type}</span>);
}

/* ---------- Pill: semantic status ---------- */
function Pill({ tone = "neutral", children, icon, sm }) {
  const map = {
    neutral: { fg: T.inkMuted, bg: T.surface2, bd: T.border },
    blue: { fg: T.blueDeep, bg: T.blueSoft, bd: "transparent" },
    green: { fg: T.greenDeep, bg: T.greenSoft, bd: "transparent" },
    amber: { fg: T.amber, bg: T.amberSoft, bd: "transparent" },
    danger: { fg: T.danger, bg: T.dangerSoft, bd: "transparent" },
    ai: { fg: T.ai, bg: T.aiSoft, bd: "transparent" },
  };
  const v = map[tone] || map.neutral;
  return (<span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: sm ? 10.5 : 11.5, fontWeight: 600, padding: sm ? "2px 7px" : "3px 9px", borderRadius: 999, background: v.bg, color: v.fg, border: `1px solid ${v.bd}`, whiteSpace: "nowrap" }}>{icon}{children}</span>);
}

/* ---------- Button ---------- */
function Button({ children, variant = "secondary", size = "md", onClick, icon, iconRight, disabled, full, style = {} }) {
  const filled = ["primary", "send", "ai", "danger"].includes(variant);
  const v = variant === "primary" ? { bg: T.navy, fg: "#fff", border: T.navy }
    : variant === "send" ? { bg: T.green, fg: "#fff", border: T.greenDeep }
    : variant === "ai" ? { bg: T.ai, fg: "#fff", border: T.ai }
    : variant === "danger" ? { bg: T.danger, fg: "#fff", border: T.danger }
    : variant === "ghost" ? { bg: "transparent", fg: T.inkMuted, border: "transparent" }
    : { bg: T.surface, fg: T.ink, border: T.borderStrong };
  const h = size === "sm" ? 28 : size === "lg" ? 42 : 33;
  const fs = size === "sm" ? 12 : size === "lg" ? 14 : 13;
  const px = size === "sm" ? 11 : size === "lg" ? 20 : 14;
  return (
    <button onClick={disabled ? null : onClick} style={{ height: h, padding: `0 ${px}px`, background: v.bg, color: v.fg, border: `1px solid ${v.border}`, borderRadius: 7, fontSize: fs, fontWeight: 550, fontFamily: T.ui, display: full ? "flex" : "inline-flex", width: full ? "100%" : undefined, alignItems: "center", justifyContent: "center", gap: 7, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, whiteSpace: "nowrap", boxShadow: filled && !disabled ? "0 1px 2px rgba(11,26,47,0.16), inset 0 1px 0 rgba(255,255,255,0.10)" : "none", transition: "filter .15s, background .15s, box-shadow .15s", ...style }}
      onMouseEnter={e => { if (!disabled && variant !== "secondary" && variant !== "ghost") e.currentTarget.style.filter = "brightness(1.08)"; if (!disabled && variant === "secondary") e.currentTarget.style.background = T.surface2; if (!disabled && variant === "ghost") e.currentTarget.style.background = T.surface2; }}
      onMouseLeave={e => { e.currentTarget.style.filter = "none"; if (variant === "secondary") e.currentTarget.style.background = T.surface; if (variant === "ghost") e.currentTarget.style.background = "transparent"; }}>
      {icon && <span style={{ display: "inline-flex" }}>{icon}</span>}{children}{iconRight && <span style={{ display: "inline-flex" }}>{iconRight}</span>}
    </button>
  );
}

/* ---------- Card ---------- */
function Card({ children, edge, pad = 0, style = {}, onClick, hover }) {
  const edgeColor = edge === "buyer" ? T.blue : edge === "supplier" ? T.green : edge === "bridge" ? null : null;
  return (
    <div onClick={onClick} style={{ position: "relative", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, boxShadow: T.shadow, overflow: "hidden", cursor: onClick ? "pointer" : "default", transition: "border-color .16s, box-shadow .16s, transform .16s", padding: pad, ...style }}
      onMouseEnter={hover ? (e => { e.currentTarget.style.borderColor = T.borderStrong; e.currentTarget.style.boxShadow = T.shadowMd; e.currentTarget.style.transform = "translateY(-2px)"; }) : undefined}
      onMouseLeave={hover ? (e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = T.shadow; e.currentTarget.style.transform = "none"; }) : undefined}>
      {edge && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: edge === "bridge" ? T.linkGradient : edgeColor }}/>}
      {children}
    </div>
  );
}

/* ---------- Toggle ---------- */
function Toggle({ on, onChange, label, sub }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => onChange?.(!on)}>
      <span style={{ width: 34, height: 20, borderRadius: 999, background: on ? T.green : T.borderStrong, position: "relative", flexShrink: 0, transition: "background .18s" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: "50%", background: "white", transition: "left .18s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }}/>
      </span>
      {label && <span><span style={{ fontSize: 12.5, color: T.ink, fontWeight: 500 }}>{label}</span>{sub && <span style={{ fontSize: 11, color: T.inkMuted, display: "block" }}>{sub}</span>}</span>}
    </label>
  );
}

/* ---------- Picker (styled select) ---------- */
function Picker({ value, options, onChange, tone, placeholder, size = "md", full }) {
  const accent = tone === "buyer" ? T.blue : tone === "supplier" ? T.green : T.ink;
  const empty = value == null || value === "";
  return (
    <div style={{ position: "relative", display: full ? "block" : "inline-block", width: full ? "100%" : undefined }}>
      <select value={value ?? ""} onChange={e => onChange?.(e.target.value)} style={{ appearance: "none", width: full ? "100%" : undefined, height: size === "sm" ? 28 : 32, padding: "0 28px 0 10px", borderRadius: 6, border: `1px solid ${T.borderStrong}`, background: T.surface, color: empty ? T.inkFaint : accent, fontSize: 12.5, fontWeight: empty ? 400 : 550, fontFamily: T.ui, cursor: "pointer", outline: "none" }}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => { const val = typeof o === "string" ? o : o.v; const lab = typeof o === "string" ? o : o.l; return <option key={val} value={val}>{lab}</option>; })}
      </select>
      <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}><Icon.Chevron dir="down" c={T.inkFaint}/></span>
    </div>
  );
}

/* ---------- Tabs ---------- */
function Tabs({ value, onChange, tabs }) {
  return (
    <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${T.border}` }}>
      {tabs.map(t => {
        const k = typeof t === "string" ? t : t.k; const label = typeof t === "string" ? t : t.label; const badge = typeof t === "object" ? t.badge : null;
        const on = value === k;
        return (
          <button key={k} onClick={() => onChange(k)} style={{ position: "relative", padding: "10px 14px", fontSize: 13, fontWeight: on ? 600 : 500, color: on ? T.ink : T.inkMuted, borderBottom: `2px solid ${on ? T.blue : "transparent"}`, marginBottom: -1, display: "inline-flex", alignItems: "center", gap: 7 }}>
            {label}
            {badge != null && <span style={{ fontSize: 10.5, fontWeight: 700, fontFamily: T.mono, padding: "1px 6px", borderRadius: 999, background: on ? T.blueSoft : T.surface2, color: on ? T.blueDeep : T.inkMuted }}>{badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- AiSuggestion bar ---------- */
function AiSuggestion({ children, source, confidence, onAccept, onEdit, onReject, compact }) {
  return (
    <div style={{ background: T.aiSoft, border: `1px solid ${T.aiBorder}`, borderRadius: 8, padding: compact ? "9px 11px" : "11px 13px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: T.ai, textTransform: "uppercase" }}><Icon.Sparkle s={11} c={T.ai}/>Suggestion</span>
        {confidence != null && <ConfidenceChip value={confidence} sm/>}
        {source && <span style={{ fontSize: 10.5, color: T.inkMuted, marginLeft: "auto" }}>{source}</span>}
      </div>
      <div style={{ fontSize: 12.5, color: T.ink, marginBottom: onAccept ? 9 : 0, lineHeight: 1.45 }}>{children}</div>
      {onAccept && (
        <div style={{ display: "flex", gap: 7 }}>
          <Button size="sm" variant="ai" icon={<Icon.Check s={12} c="white"/>} onClick={onAccept}>Accept</Button>
          {onEdit && <Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>}
          {onReject && <Button size="sm" variant="ghost" onClick={onReject}>Dismiss</Button>}
        </div>
      )}
    </div>
  );
}

/* ---------- EmptyState (illustration-free) ---------- */
function EmptyState({ icon, title, sub, action }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "56px 24px", gap: 6 }}>
      {icon && <div style={{ width: 48, height: 48, borderRadius: 12, background: T.surface2, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6, color: T.inkFaint }}>{icon}</div>}
      <div style={{ fontSize: 16, fontWeight: 650, fontFamily: T.display, color: T.ink, letterSpacing: "-0.01em" }}>{title}</div>
      {sub && <div style={{ fontSize: 13, color: T.inkMuted, maxWidth: 380, lineHeight: 1.5 }}>{sub}</div>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

/* ---------- SectionTitle ---------- */
function SectionTitle({ children, sub, right, dot, size = "md" }) {
  const dotColor = dot === "buyer" ? T.blue : dot === "supplier" ? T.green : dot === "ai" ? T.ai : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: sub ? 4 : 0 }}>
      {dotColor && <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }}/>}
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: T.display, fontWeight: 650, letterSpacing: "-0.01em", color: T.ink, fontSize: size === "lg" ? 22 : size === "sm" ? 14 : 17 }}>{children}</div>
        {sub && <div style={{ fontSize: 12.5, color: T.inkMuted, marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/* ---------- Annotation note (toggleable callout) ---------- */
function Note({ n, title, children, side = "right", tone = "ink" }) {
  const [open, setOpen] = React.useState(false);
  const show = window.PL_NOTES_ON;
  if (!show) return null;
  const c = tone === "buyer" ? T.blue : tone === "supplier" ? T.green : tone === "ai" ? T.ai : tone === "danger" ? T.danger : "#0B1A2F";
  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span style={{ width: 18, height: 18, borderRadius: "50%", background: c, color: "white", fontSize: 10.5, fontWeight: 700, fontFamily: T.mono, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "help", boxShadow: "0 1px 3px rgba(11,26,47,0.25)", flexShrink: 0 }}>{n}</span>
      {open && (
        <span style={{ position: "absolute", zIndex: 80, top: "50%", transform: "translateY(-50%)", [side === "right" ? "left" : "right"]: 26, width: 250, background: T.navy, color: T.navyText, borderRadius: 8, padding: "10px 12px", boxShadow: "0 12px 32px rgba(11,26,47,0.32)", textAlign: "left" }}>
          {title && <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "white", marginBottom: 3 }}>{title}</span>}
          <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.5, color: T.navyText }}>{children}</span>
        </span>
      )}
    </span>
  );
}

window.PL = { T, Mark, LinkSpine, Icon, ConfidenceChip, SrcChip, Pill, Button, Card, Toggle, Picker, Tabs, AiSuggestion, EmptyState, SectionTitle, Note };
