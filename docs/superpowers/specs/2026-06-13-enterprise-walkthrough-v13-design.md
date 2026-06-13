# Enterprise walkthrough video (v13) — design

**Date:** 2026-06-13 · **Status:** approved (founder), in build · **Owner:** demo-video pipeline

## Goal

A professional, enterprise-grade ~2 min walkthrough of ProcuLink for a B2B
audience. Intro + clean real-UI walkthrough + enterprise capability montage +
outro, with ElevenLabs voiceover and a fresh premium music bed.

**Hard constraint:** do NOT overwrite the live `/watch` video
(`assets.proculink.eu/marketing/walkthrough.mp4`, currently the v7 card cut) or
the 10 shipped per-tool videos. v13 ships as a NEW staged artifact only — no R2
upload, no env/registry change (same as the v9–v12 drafts).

## Decisions (founder)

- **Structure:** Hybrid — one end-to-end PO journey (spine) + a fast enterprise
  capability montage.
- **Length:** ~2 min.
- **Audio:** keep ElevenLabs **Daniel** (`onwK4e9ZLuTAKqWW03F9`) for brand
  consistency; generate a NEW premium-restrained enterprise music bed.
- **Trust signals (all four):** audit trail & proof of delivery · validation
  before send · integrations & ERP · security / no-egress.
- **Security beat:** option A — anchor on a real screen (Settings → SFTP tab,
  which shows real "secrets are encrypted" copy) plus a tasteful brand
  lower-third for the no-egress capability (no self-serve toggle exists to film).

## Pipeline (reuse the proven per-tool pipeline)

Real-UI Playwright capture in MOCK mode (port 8090) — the founder judged
real-UI footage better than the card cut. Reuses `generate-tool-vo.mjs`,
`make-tool-cards.mjs` (brand intro/outro variant via
`introTagline`/`outroHeadline`/`outroCta`), `assemble-tool.mjs`, and
`make-music-eleven.mjs`. New: `tools/walkthrough-v13.json` +
`tools/capture-walkthrough-v13.spec.ts`.

**Style rule carried from v12 (the founder's named v11 defect):** NO synthetic
cursor motion. The cursor is hidden and still except in the ~0.5 s window around
a real click; it moves only to perform a real click/type. The only motion is a
real action or a real UI state change. No decorative hovering/drift.

**Music isolation:** `assemble-tool.mjs` gains a backwards-compatible
`DEMO_MUSIC_FILE` env override so v13's fresh bed does not overwrite the shared
committed `assets/music.mp3` (used by all 10 tool videos).

## Storyboard (11 narrated beats + brand intro/outro cards)

| # | id | Screen (real UI) | Trust |
|---|----|------------------|-------|
| intro | — | Brand card: lockup + "The missing link between buyers and suppliers." | — |
| 1 | s1-upload | `/upload`: drop CSV → "Detected: CSV", PO# + line count | — |
| 2 | s2-review | `/inbox/ord-002`: triage fix queue (only lines needing a decision) | — |
| 3 | s3-accept | Accept the catalog-grounded AI suggestion (confidence + reason) | — |
| 4 | s4-type | Type a supplier code manually → Save ("remembered next time") | — |
| 5 | s5-validate | Send-readiness card: acceptance rules + conformance before send | validation |
| 6 | s6-convert | Full-document triptych: source / canonical / supplier output | — |
| 7 | s7-deliver | Send → Generating → Sent → Delivered + audit trail | audit + integrations |
| 8 | s8-integrations | `/settings` API Keys: ingress endpoint + one-time `plk_` key | integrations |
| 9 | s9-security | `/settings` SFTP tab "secrets are encrypted" + no-egress lower-third | security |
| 10 | s10-versioned | `/connections`: versioned revisions (Published/Draft) + rollback | reliability |
| outro | — | Brand card: "Connecting procurement." + "Start free at proculink.eu" (close VO over the card) | — |

Page loads: `/upload` → `/inbox/ord-002` → `/settings` (beats 8+9 share the
load, client-side tab switch) → `/connections`. Mock state resets per goto;
each screen stands alone.

## Voiceover (Daniel, calm; ~240 words)

1. Every supplier wants purchase orders in their own format. With ProcuLink you drop the file as-is — a CSV, a spreadsheet, a PDF, even EDI — and it detects the format and reads every line.
2. It opens in review, surfacing only the lines that need a decision — not the whole order.
3. When a supplier uses different item codes, ProcuLink suggests the match from that supplier's own catalog, with a confidence score and the reason. Accept it, and move on.
4. Prefer to decide yourself? Enter the code and save — and ProcuLink remembers it, so next time it won't ask.
5. Before anything is sent, the order is checked against this supplier's acceptance rules and format profile, so it isn't rejected at the other end.
6. Then ProcuLink converts the order into the exact format the supplier requires — with no template for you to maintain.
7. It delivers on the supplier's own channel — HTTP, SFTP, email, or straight into their ERP — then tracks it: generating, sent, delivered. Every step is recorded, so you can prove what went where, on every order.
8. And it fits your stack — bring orders in over a secure REST API with keys you manage, or push delivery events out with signed webhooks.
9. Credentials are encrypted, and for sensitive data, ProcuLink can run entirely inside your own environment.
10. Every supplier connection is versioned — test a change safely, publish it, and roll back if you ever need to.
11. (over outro) ProcuLink speaks every supplier's language, so your team doesn't have to. Start free today.

## Honesty (offer⇔works)

Every claim is on a real shipped screen when spoken. Adjustments made for
honesty: beat 8 drops the explicit "Zapier/Make" wording (the UI shows native
Zapier/Make as "coming soon") and claims only the shipped REST API + signed
webhooks. Beat 9's no-egress line is a real capability (RapidOcrNet self-hosted
OCR + AES-GCM credentials) but operator-config with no self-serve toggle, so it
is shown via the real "secrets are encrypted" copy + a brand lower-third, not a
faked control. The readiness card (beat 5) may read "Not validated yet" in mock,
so the VO says the order is *checked against* the rules, not that they passed.

## Music prompt

> Restrained, premium corporate underscore for an enterprise B2B software
> walkthrough. Warm, confident, trustworthy — soft felt piano with a subtle warm
> synth pad, gentle forward momentum, no drums-forward, no melody that competes
> with a voiceover. Modern, serious-optimistic, loopable, ~120 s.

Audition 2–3 takes; pick the most subordinate; bed at ~−19 to −22 dB under VO.
Fallback = existing committed bed.

## Produce

```
ELEVENLABS_STABILITY=0.6 ELEVENLABS_SPEED=1.03 node tools/generate-tool-vo.mjs walkthrough-v13
bun run demo:tools:capture capture-walkthrough-v13
ELEVENLABS_API_KEY=<key> node make-music-eleven.mjs out/v13-music.mp3 125000 "<prompt>"
DEMO_INTRO_SEC=3.2 DEMO_OUTRO_SEC=4.5 DEMO_MUSIC_FILE=<chosen> node tools/assemble-tool.mjs walkthrough-v13
node tools/verify-tool.mjs walkthrough-v13
```

Output: `tools/out/walkthrough-v13.mp4` + poster + srt. Review copy to
`C:\Users\Dmitri.MARKIT\Videos\ProcuLink\walkthrough-v13-DRAFT.mp4`. Verify:
1080p30 H.264+AAC, 0 decode errors, mean ≈ −22 dB, per-beat stills eyeballed.
