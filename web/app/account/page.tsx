import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, AUTH_STATUS } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Avatar } from "@/components/avatar";
import { GitHubIcon, GoogleIcon } from "@/components/brand-icons";
import { Welcome, NextSteps, SignOutButton } from "@/components/account-view";
import { WELCOMED_COOKIE } from "@/lib/site";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

const PROVIDER = {
  google: { label: "Google", Icon: GoogleIcon },
  github: { label: "GitHub", Icon: GitHubIcon },
} as const;

export default async function Account() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/account");
  const u = session.user;
  const p = u.provider ? PROVIDER[u.provider] : null;
  const firstVisit = !(await cookies()).has(WELCOMED_COOKIE);

  return (
    <>
      <SiteHeader auth={AUTH_STATUS} />
      <main id="main" className="mx-auto w-full max-w-[44rem] px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
        {firstVisit && <Welcome name={u.name?.split(" ")[0]} />}

        <section aria-labelledby="profile-h" className="card overflow-hidden">
          <div className="flex items-center gap-4 px-5 py-6 sm:px-7">
            <Avatar src={u.image} name={u.name ?? u.email} className="size-14 text-body" />
            <div className="min-w-0">
              <h1 id="profile-h" className="truncate text-[1.375rem] leading-tight text-ink">{u.name ?? "Your account"}</h1>
              {u.email && <p className="mt-0.5 truncate text-small text-ink-3">{u.email}</p>}
            </div>
          </div>
          <dl className="border-t text-small">
            <div className="flex items-center justify-between gap-4 px-5 py-3.5 sm:px-7">
              <dt className="text-ink-4">Signed in with</dt>
              <dd className="flex items-center gap-2 font-[540] text-ink-2">
                {p ? <><p.Icon className="size-4" /> {p.label}</> : "OAuth"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-t px-5 py-3.5 sm:px-7">
              <dt className="text-ink-4">What we store</dt>
              <dd className="text-right text-ink-3">Name, email, avatar, in a signed cookie. Nothing else.</dd>
            </div>
          </dl>
          <div className="flex justify-end border-t px-5 py-3.5 sm:px-7">
            <SignOutButton />
          </div>
        </section>

        <NextSteps />
      </main>
      <SiteFooter />
    </>
  );
}
