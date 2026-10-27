import type { Metadata } from "next";
import { AUTH_STATUS } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { Mark } from "@/components/logo";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <>
      <SiteHeader auth={AUTH_STATUS} />
      <main id="main" className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-[72rem] flex-col items-start justify-center px-5 py-16 sm:px-8 lg:px-12">
        <Mark className="size-10" />
        <p className="mt-6 font-mono text-small text-ink-4">404</p>
        <h1 className="mt-2 text-[2rem] leading-tight text-ink sm:text-title">This thread doesn’t lead anywhere.</h1>
        <p className="mt-3 max-w-[30rem] text-body text-ink-3">The page you followed doesn’t exist. The way back is below.</p>
        <a href="/" className="mt-8 inline-flex h-11 items-center rounded-xl bg-brand-fill px-5 text-body-sm font-[580] text-on-brand hover:bg-brand-fill-hover">
          Back to Clew
        </a>
      </main>
    </>
  );
}
