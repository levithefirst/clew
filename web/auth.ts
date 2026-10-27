import NextAuth, { type DefaultSession } from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";

// Auth.js v5: Google + GitHub, enabled only when their env vars are set (see .env.example).
// The landing page never requires a session; with no env configured the buttons explain that sign-in isn't set up.
// Values are trimmed: a pasted secret with a trailing newline is the most common silent misconfiguration.
const v = (k: string) => process.env[k]?.trim() || undefined;
const SECRET = v("AUTH_SECRET");
export const AUTH_STATUS = {
  google: Boolean(SECRET && v("AUTH_GOOGLE_ID") && v("AUTH_GOOGLE_SECRET")),
  github: Boolean(SECRET && v("AUTH_GITHUB_ID") && v("AUTH_GITHUB_SECRET")),
};
export type AuthProviderId = keyof typeof AUTH_STATUS;

declare module "next-auth" {
  interface Session {
    user: { provider?: AuthProviderId } & DefaultSession["user"];
  }
}

const providers: Provider[] = [];
if (AUTH_STATUS.google) providers.push(Google({ clientId: v("AUTH_GOOGLE_ID"), clientSecret: v("AUTH_GOOGLE_SECRET") }));
if (AUTH_STATUS.github) providers.push(GitHub({ clientId: v("AUTH_GITHUB_ID"), clientSecret: v("AUTH_GITHUB_SECRET") }));

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  secret: SECRET,
  trustHost: true,
  session: { strategy: "jwt" },
  // Our own themed page for sign-in and for errors, instead of the bare "Server error" screen.
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    jwt({ token, account }) {
      if (account) token.provider = account.provider;
      return token;
    },
    session({ session, token }) {
      if (token.provider) session.user.provider = token.provider as AuthProviderId;
      return session;
    },
  },
  logger: {
    // The default logger drops error.cause, which is the only part that says *why* a callback failed.
    error(error) {
      const cause = error.cause instanceof Error ? error.cause : (error.cause as { err?: unknown } | undefined)?.err;
      console.error(`[auth][error] ${(error as { type?: string }).type ?? error.name}: ${error.message}${cause instanceof Error ? ` | cause ${cause.name}: ${cause.message}` : ""}`);
    },
  },
});
