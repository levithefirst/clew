"use client";
import { SessionProvider as Provider } from "next-auth/react";

/** Client session for the header/menu. The landing page stays static; the session is fetched once on the client. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  return <Provider refetchOnWindowFocus={false}>{children}</Provider>;
}
