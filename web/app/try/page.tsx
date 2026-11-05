import type { Metadata } from "next";
import { AUTH_STATUS } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { TryIt } from "@/components/try-it";

export const metadata: Metadata = {
  title: "Try it",
  description: "Paste a failed transaction and see what Clew says with and without its Walrus memory.",
};

/** The same box as the home page, on its own address for sharing. */
export default function Try() {
  return (
    <>
      <SiteHeader auth={AUTH_STATUS} />
      <main id="main">
        <TryIt heading="h1" />
      </main>
      <SiteFooter />
    </>
  );
}
