# Per-tool videos → Help integration (design, NOT implemented)

How the per-tool walkthrough videos (`scripts/demo-video/tools/`) plug into the
existing help system. **This is a design document only — no frontend change has
been made.** Implement it after the founder approves the two pilot videos and
they are hosted.

---

## The shape of the existing help system (what we hook into)

1. **`HELP_ARTICLES` registry** — `src/lib/help-articles.ts`. One typed entry
   per help-center article (`slug/title/blurb/category/keywords/readMin`).
   Registry order drives the prev/next pager; Fuse search and the sitemap read
   it too.
2. **Article pages** — `src/app/(marketing)/help/<slug>/page.mdx`. Every MDX
   article is automatically wrapped by **`HelpArticleShell`**
   (`src/components/help/HelpArticleShell.tsx`, wired as the MDX `wrapper` in
   `src/mdx-components.tsx`). The shell already does
   `getArticleBySlug(slug)` — it has the registry entry in hand.
3. **`SECTION_GUIDES`** — `src/lib/section-guides.ts`. One entry per in-app
   screen; its `articleSlugs` already link each screen's "?" slideover to
   related articles, and slugs that don't resolve are **silently skipped**.
4. **Precedent for env-gated video** — the main walkthrough (`/watch`) renders
   only when `NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL` is set
   (`walkthroughConfigured()` in `src/lib/walkthrough.ts`).

## Proposal — registry-driven, offer⇔works

### 1. Two optional fields on `HelpArticle`

```ts
export interface HelpArticle {
  // …existing fields…
  /** Hosted per-tool walkthrough video (mp4). Set ONLY once uploaded + verified. */
  videoUrl?: string;
  /** Poster frame for the video element. */
  videoPosterUrl?: string;
}
```

### 2. One render site: `HelpArticleShell`

The shell renders a `<video>` block between the category eyebrow and the MDX
prose **iff `article.videoUrl` is set**:

```tsx
{article?.videoUrl && (
  <video
    controls
    preload="metadata"
    poster={article.videoPosterUrl}
    src={article.videoUrl}
    className="mt-5 w-full rounded-[10px] border"
    style={{ borderColor: "#E2E6EE", background: "#0B1A2F" }}
  />
)}
```

Why this point:

- **Zero per-article boilerplate** — every MDX article gets the capability the
  moment its registry entry carries a `videoUrl`. No MDX edits.
- **Env-independent + offer⇔works** — the field is plain data in the registry,
  set only when a video is actually hosted (the founder-approved honesty rule:
  nothing dead ever renders). No env var needed per video; the registry IS the
  catalog of what exists.
- **Searchable surface** — `/help` cards can later show a small "▶ video" chip
  when `videoUrl` is present (optional follow-up, same data).

### 3. In-app discovery comes for free

`SECTION_GUIDES[].articleSlugs` already routes each screen's "?" slideover to
its articles. When an article gains a video, the screen's "Related reading" row
leads to a page whose video sits above the fold. Optional later enhancement
(NOT required): the slideover row shows a ▶ glyph when
`getArticleBySlug(slug)?.videoUrl` is set.

### 4. Hosting

Same pipeline as the main walkthrough — the **public** R2 bucket
(`proculink-public`, custom domain `assets.proculink.eu`), keys:

```
marketing/tools/<tool>.mp4          → https://assets.proculink.eu/marketing/tools/<tool>.mp4
marketing/tools/<tool>-poster.jpg   → …/tools/<tool>-poster.jpg
```

Upload with `wrangler r2 object put … --remote` (see `PRODUCTION.md` §Hosting
in this directory). **Never** the private `proculink` order-data bucket.

## Per-tab video map (~10 videos, the full library)

| # | Video id (`tools/<id>.json`) | Tab / screen | Article slug to carry `videoUrl` | Status |
|---|---|---|---|---|
| 1 | `upload` | Upload (`/upload`) | `first-upload` | **PILOT — built** |
| 2 | `review` | Inbox → order review (`/inbox/{id}`) | `item-codes` (or a new `review-and-resolve` article) | **PILOT — built** |
| 3 | `dashboard` | Dashboard (`/bridge`) | `dashboard-and-statuses` | future |
| 4 | `inbox` | Inbox list + statuses (`/inbox`) | `dashboard-and-statuses` (shares) or new `inbox-basics` | future |
| 5 | `suppliers` | Suppliers + catalog tab (`/library/suppliers`, detail) | `item-codes` | future |
| 6 | `po-mapping` | PO field mapping editor + starter templates | `mapping-basics` | future |
| 7 | `delivery` | Delivery config + test-fire (supplier → Delivery tab) | `delivery-setup` | future |
| 8 | `connections` | Versioned connections (`/connections`) | `connections` | future |
| 9 | `exceptions` | Exceptions + health (`/operations/exceptions`, `/health`) | `exceptions-and-stuck-orders` | future |
| 10 | `settings-integrations` | Settings: API keys / connectors / email intake | `api-and-integrations` (+ `email-polling`) | future |
| 11 (opt.) | `output-mapping` | "Edit output mapping" power editor | `output-mapping-editor` | future |

Rules for adding each future video:

1. Author `scripts/demo-video/tools/<id>.json` (beats + VO), record + assemble
   with the same pipeline (see `tools/PRODUCTION.md`).
2. Upload mp4 + poster to `marketing/tools/`.
3. Set `videoUrl`/`videoPosterUrl` on the ONE article in `HELP_ARTICLES`.
4. If the screen's `SECTION_GUIDES` entry doesn't already reference that
   article slug, add it to `articleSlugs`.

One video maps to ONE article (its canonical home). Other articles/screens
link to that article rather than duplicating the video.

## Explicitly out of scope here

- No `<video>` in the help slideover itself (keep the slideover light; it
  links out).
- No autoplay anywhere.
- No new env vars; the registry field is the single switch.
- `/watch` (the full product walkthrough) stays as is — per-tool videos
  complement it, not replace it.
