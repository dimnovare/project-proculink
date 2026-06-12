import type { MetadataRoute } from "next";
import { HELP_ARTICLES } from "@/lib/help-articles";

const BASE_URL = "https://proculink.eu";

const routes = [
  "/",
  "/how-it-works",
  "/formats",
  "/pricing",
  "/security",
  "/help",
  // Help articles come straight from the registry — a hand list can't drift.
  ...HELP_ARTICLES.map((a) => `/help/${a.slug}`),
  "/watch",
  "/support",
  "/privacy",
  "/terms",
  "/dpa",
  "/aup",
  "/subprocessors",
  "/changelog",
  "/customers",
  "/one-pager",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${BASE_URL}${route}`,
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : route.startsWith("/help") ? 0.7 : 0.8,
  }));
}
