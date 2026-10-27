import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, AUTH_STATUS } from "@/auth";
import { AuthButtons } from "@/components/auth-buttons";
import { Mark } from "@/components/logo";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

// Auth.js error codes → one short, human line. Anything unknown falls back to "try again".
const ERRORS: Record<string, string> = {
  AccessDenied: "Sign-in was cancelled. You can try again any time.",
  Verification: "That sign-in link expired. Try again.",
  Configuration: "Sign-in didn’t complete. That’s usually a stale attempt. Try again.",
};

/** Same-origin paths only: never bounce a user to another site after sign-in. */
const safePath = (p?: string) => (p && p.startsWith("/") && !p.startsWith("//") ? p : "/account");

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const { error, callbackUrl } = await searchParams;
  const to = safePath(callbackUrl);
  if (await auth()) redirect(to);
  return (
    <>
      <SiteHeader auth={AUTH_STATUS} />
      <main id="main" className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-[72rem] items-center justify-center px-5 py-16 sm:px-8">
        <div className="card w-full max-w-[26rem] px-6 py-8 sm:px-8">
          <Mark className="size-9" />
          <h1 className="mt-5 text-[1.5rem] font-[620] leading-tight tracking-[-0.025em] text-ink">Sign in to Clew</h1>
          <p className="mt-2 text-body-sm text-ink-3 text-pretty">
            Optional. The demo works without an account.
          </p>
          {error && (
            <p role="alert" className="mt-5 rounded-lg border border-fail/30 bg-fail-soft px-3.5 py-2.5 text-small text-ink-2">
              {ERRORS[error] ?? "Something went wrong signing in. Try again."}
            </p>
          )}
          <AuthButtons status={AUTH_STATUS} size="lg" redirectTo={to} className="mt-6 flex-col items-stretch [&>button]:w-full" />
          <p className="mt-6 text-label text-ink-4">We only read your name, email and avatar. No wallet, no keys.</p>
        </div>
      </main>
    </>
  );
}
