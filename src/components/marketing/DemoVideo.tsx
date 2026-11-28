"use client";

import { useEffect, useRef, useState } from "react";
import { DEMO_VIDEO } from "@/lib/demoVideo";

/**
 * The home page demo. A browser fetches a video's poster at once, wherever the video sits,
 * and this 200 kB picture is far below the fold: on a slow phone it shared the line with the
 * page's own CSS and scripts and held back the first paint of the hero (audit F-18).
 * So the poster is set only when the video comes within a screen of view.
 */
export function DemoVideo({ label }: { label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: "100% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={ref} src={DEMO_VIDEO.src} poster={near ? DEMO_VIDEO.poster : undefined} width={1920} height={1080}
      controls playsInline preload="none" className="h-auto w-full rounded-card-lg border border-border bg-navy"
      aria-label={label}
    />
  );
}
