import { appIcon } from "@/lib/pwa/appIcon";

export const dynamic = "force-static";

export function GET(): Promise<Response> {
  return appIcon(192);
}