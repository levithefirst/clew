import { AUTH_STATUS } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

/** Shared shell for the short Privacy and Terms pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader auth={AUTH_STATUS} />
      <main id="main" className="mx-auto w-full max-w-[42rem] px-5 pb-24 pt-12 sm:px-8 sm:pt-16">
        <h1 className="text-[2rem] leading-tight text-ink">{title}</h1>
        <p className="mt-2 text-small text-ink-4">Last updated {updated}</p>
        <div className="mt-8 space-y-5 text-body-sm text-ink-3 text-pretty [&_h2]:mt-9 [&_h2]:text-[1.25rem] [&_h2]:text-ink [&_strong]:font-[560] [&_strong]:text-ink-2">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
