import type { MetadataRoute } from "next";

const BASE_URL = "https://proculink.eu";

const routes = [
  "/",
  "/how-it-works",
  "/formats",
  "/pricing",
  "/security",
  "/help",
  "/help/ai-suggestions",
  "/help/billing-faq",
  "/help/delivery-config",
  "/help/email-polling",
  "/help/first-upload",
  "/help/mapping-basics",
  "/help/order-intake-options",
  "/help/troubleshooting",
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
