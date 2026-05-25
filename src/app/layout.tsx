import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProcuLink — Procurement Hub",
  description: "Upload buyer orders, resolve mappings, transform and deliver to suppliers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const body = publishableKey
    ? <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>
    : children;

  return (
    <html lang="en">
      <body>
        {body}
      </body>
    </html>
  );
}
