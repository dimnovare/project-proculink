import { AppClerkProvider } from "@/components/auth/AppClerkProvider";
import AppShell from "./AppShell";

// Server layout: the Clerk provider lives here, not in the root layout, so the public pages load no sign-in code.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppClerkProvider>
      <AppShell>{children}</AppShell>
    </AppClerkProvider>
  );
}
