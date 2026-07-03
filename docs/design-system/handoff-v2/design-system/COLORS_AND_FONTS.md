# ProcuLink — Colors & Fonts (authoritative quick reference)

The exact values the app renders, pulled from the live source (`v2/redesign/core.jsx`).
Verified July 2026. If any other file in this folder disagrees, **this and
`tokens/tokens.json` win.**

Machine-readable copies (all consistent with this): `tokens/tokens.json` ·
`tokens/tokens.ts` · `tokens/tokens.css` (`--pl-*` vars) · `tokens/tailwind.config.ts` ·
`shadcn-theme.css` (HSL for shadcn) · `tailwind.preset.ts`.

---

## Fonts

| Role | Family | Weights | Stack (verbatim) |
|---|---|---|---|
| **UI / body** | Inter | 400 · 500 · 600 · 700 | `"Inter", -apple-system, system-ui, sans-serif` |
| **Display / headings** | Bricolage Grotesque | 600 · 700 · 800 | `"Bricolage Grotesque", "Inter", system-ui, sans-serif` |
| **Mono / data** | JetBrains Mono | 400 · 500 · 600 · 700 | `"JetBrains Mono", ui-monospace, monospace` |

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
```

- **Display** is for titles/KPIs only — 1–2 per screen, tracking −0.02 to −0.025em.
- **Mono** for every technical value: PO numbers, SKUs, field paths, payloads, %s, and
  any column of figures (with `font-variant-numeric: tabular-nums`).
- Bold in body copy = weight **600**, never 700.

## Type scale (px)

`10 xs · 11.5 sm · 12.5 body-s · 13 body · 14 body-l · 16 h4 · 18 h3 · 22 h2 · 32 h1 · 36 display-s · 48 display`
Floor for live UI text **11.5**; table cells **12.5**.

---

## Colors

Semantic law — **blue = buyer/source · green = supplier/output · amber = warn ·
red = blocker · violet = AI · navy = chrome.** Never decorative; a blue thing means
"buyer side."

### Brand — buyer / source (blue)
| Token | Hex |
|---|---|
| `blue` | `#1E66C9` |
| `blueDeep` | `#0F4FA8` |
| `blueSoft` | `#EAF0F8` |
| `blueSoft2` | `#DCE8F7` |

### Brand — supplier / output (green)
| Token | Hex |
|---|---|
| `green` | `#2E8E3A` |
| `greenDeep` | `#1E6D29` |
| `greenSoft` | `#E9F1EA` |
| `greenSoft2` | `#D8EBDA` |

### Chrome (navy — sidebar + topbar only)
| Token | Hex |
|---|---|
| `navy` | `#0B1A2F` |
| `navySurface` | `#14253D` |
| `navyBorder` | `#1F3252` |
| `navyText` | `#C8D1E0` |
| `navyMuted` | `#7C8DA6` |

### Surfaces & ink
| Token | Hex |
|---|---|
| `bg` | `#F6F7FA` |
| `surface` | `#FFFFFF` |
| `surface2` | `#F1F3F7` |
| `border` | `#E5E8EE` |
| `borderStrong` | `#CBD0DA` |
| `borderFaint` | `#EEF0F4` |
| `ink` | `#0B1A2F` |
| `inkMuted` | `#5E6779` |
| `inkFaint` | `#98A0AE` |

### Status
| Token | Hex | Meaning |
|---|---|---|
| `amber` | `#B36D14` | warning / uncertain |
| `amberSoft` | `#FAF1DD` | warning bg |
| `danger` | `#B43838` | blocker / failure |
| `dangerSoft` | `#FAE6E6` | blocker bg |
| `ai` | `#6F4FCE` | AI suggestion |
| `aiSoft` | `#F0EAFB` | AI bg |
| `aiBorder` | `#D9CCF4` | AI border |

Status is **never** color-only — always a dot/icon **and** a word. `-soft` bg + `-deep`
(or the base) fg for badges; solid brand color only on the element that *acts*.

### Gradient (the "bridge spine" — the one place blue→green is decorative)
`linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)`

---

## Elevation ramp (one ladder — no ad-hoc shadows)

| Token / `--pl-` var | Value | Use |
|---|---|---|
| `shadowSm` | `0 1px 2px rgba(11,26,47,0.05)` | chips, inputs |
| `shadow` | `0 1px 3px rgba(11,26,47,0.05), 0 1px 2px rgba(11,26,47,0.04)` | resting cards, lists |
| `shadowMd` | `0 6px 16px rgba(11,26,47,0.09), 0 2px 5px rgba(11,26,47,0.05)` | hover-lift, popovers |
| `shadowLg` | `0 16px 40px rgba(11,26,47,0.14), 0 4px 12px rgba(11,26,47,0.07)` | drawers, ⌘K palette |
| `shadowXl` | `0 28px 68px rgba(11,26,47,0.20), 0 10px 24px rgba(11,26,47,0.10)` | modals |

Radius: control **6–8**, card **12–14**, pill **full**.
Motion: ease `cubic-bezier(0.16,1,0.3,1)`; 130ms hover / 200ms overlay / 260ms page-in;
honor `prefers-reduced-motion`.

---

## Focus ring (global)
`outline: 2px solid #1E66C9; outline-offset: 2px;` **plus** a soft halo
`box-shadow: 0 0 0 4px rgba(30,102,201,0.15)`.
