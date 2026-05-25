import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Sign-in is not configured</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Add the Clerk environment variables in Vercel to enable authentication.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <SignIn
        fallbackRedirectUrl="/bridge"
        signUpFallbackRedirectUrl="/bridge"
      />
    </div>
  );
}
