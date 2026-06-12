/**
 * Walkthrough-video availability — offer⇔works gate.
 *
 * The /watch page renders a real player only when the founder has configured
 * a video URL (self-hosted) or a Loom embed URL. Every surface that LINKS to
 * /watch must use this same gate so we never advertise a walkthrough that
 * isn't there.
 *
 * NOTE: the env vars are referenced statically (`process.env.NEXT_PUBLIC_…`)
 * so Next.js can inline them at build time for client components.
 */
export function walkthroughConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_WALKTHROUGH_VIDEO_URL ||
      process.env.NEXT_PUBLIC_WALKTHROUGH_LOOM_URL,
  );
}
