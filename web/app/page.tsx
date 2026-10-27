import { AUTH_STATUS } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { ExampleSection } from "@/components/example-section";
import { Cta } from "@/components/cta";
import { SiteFooter } from "@/components/site-footer";

export default function Page() {
  return (
    <>
      <SiteHeader auth={AUTH_STATUS} />
      <main id="main">
        <Hero />
        <HowItWorks />
        <ExampleSection />
        <Cta auth={AUTH_STATUS} />
      </main>
      <SiteFooter />
    </>
  );
}
