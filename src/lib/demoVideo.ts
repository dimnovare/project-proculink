/**
 * The narrated home page demo, on R2 behind assets.proculink.eu.
 *
 * Bump `?v=` whenever the file under these keys is replaced: Cloudflare's edge keeps
 * the previous file for up to 4 hours, and the query string is part of its cache key.
 * next.config.ts passes `src` to the CSP, so media-src and img-src allow this origin.
 */
export const DEMO_VIDEO = {
  src: "https://assets.proculink.eu/marketing/walkthrough.mp4?v=2",
  poster: "https://assets.proculink.eu/marketing/walkthrough-poster.jpg?v=2",
} as const;
