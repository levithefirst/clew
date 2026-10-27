import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms", description: "The short terms for using Clew." };

export default function Terms() {
  return (
    <LegalPage title="Terms" updated="27 October 2026">
      <p>Clew is a hackathon project, provided as is, with no warranty.</p>
      <h2>Not financial advice</h2>
      <p>
        Clew reports what differed between a failed transaction and a later successful one. It doesn’t know why a retry worked, and its suggestions aren’t instructions. Check any transaction yourself before you sign it. You are responsible for what you send on-chain.
      </p>
      <h2>Accounts</h2>
      <p>Signing in is optional. Don’t try to break, overload or misuse the site or the services behind it.</p>
      <h2>Third parties</h2>
      <p>Clew relies on Tatum, Walrus Memory, Google, GitHub and Vercel. Their own terms apply when you use them.</p>
      <h2>Changes</h2>
      <p>These terms may change as the project evolves. The date above shows the latest version.</p>
    </LegalPage>
  );
}
