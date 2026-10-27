import { Logo } from "@/components/logo";
import { ThemeSwitch } from "@/components/theme-toggle";
import { SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-[72rem] flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center lg:px-12">
        <div className="flex flex-col gap-2">
          <a href="/#top" aria-label="Clew home" className="self-start rounded-md">
            <Logo />
          </a>
          <p className="text-small text-ink-4">Built for the Tatum × Walrus Memory Total Recall hackathon.</p>
          <p className="text-label text-ink-4">
            © 2026 Clew · <a href="/privacy" className="hover:text-ink">Privacy</a> · <a href="/terms" className="hover:text-ink">Terms</a>
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-small text-ink-3 md:ml-auto">
          <a href="/#how" className="hover:text-ink">How it works</a>
          <a href="/#same-failure" className="hover:text-ink">Before / after</a>
          <a href="/#example" className="hover:text-ink">Example</a>
          <a href={SITE.repo} target="_blank" rel="noreferrer" className="hover:text-ink">GitHub</a>
          <a href={SITE.tatum} target="_blank" rel="noreferrer" className="hover:text-ink">Tatum</a>
          <a href={SITE.walrus} target="_blank" rel="noreferrer" className="hover:text-ink">Walrus Memory</a>
        </nav>
        <ThemeSwitch />
      </div>
    </footer>
  );
}
