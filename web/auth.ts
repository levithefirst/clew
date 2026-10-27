import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";

// Auth.js v5 stub: Google + GitHub, enabled only when their env vars are set (see .env.example).
// The landing page never requires a session; with no env configured the buttons explain that sign-in isn't set up.
const env = process.env;
export const AUTH_STATUS = {
  google: Boolean(env.AUTH_SECRET && env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
  github: Boolean(env.AUTH_SECRET && env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET),
};
export type AuthProviderId = keyof typeof AUTH_STATUS;

const providers: Provider[] = [];
if (AUTH_STATUS.google) providers.push(Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET }));
if (AUTH_STATUS.github) providers.push(GitHub({ clientId: env.AUTH_GITHUB_ID, clientSecret: env.AUTH_GITHUB_SECRET }));

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  secret: env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt" },
});
