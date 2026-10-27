import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy", description: "What Clew stores about you, and what it doesn't." };

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="27 October 2026">
      <p>Clew is a hackathon project. You can use the whole site without an account, and we keep as little as possible.</p>
      <h2>If you sign in</h2>
      <p>
        Signing in with Google or GitHub gives us your <strong>name, email and avatar URL</strong>, plus which provider you used. They live in an encrypted session cookie in your browser. We don’t run a user database, so nothing is stored on our side. Signing out deletes the cookie.
      </p>
      <h2>Cookies</h2>
      <p>
        Only what makes the site work: the sign-in session and its short-lived security cookies, a cookie that remembers you’ve seen the welcome message, and your light/dark theme choice in local storage. No advertising or tracking cookies.
      </p>
      <h2>On-chain data</h2>
      <p>
        The examples on this site are public Mainnet transactions read through Tatum RPC. The memories are stored in Walrus Memory. Neither contains anything about you as a site visitor.
      </p>
      <h2>Hosting</h2>
      <p>The site is hosted on Vercel, which keeps standard request logs for a short time.</p>
      <h2>Contact</h2>
      <p>
        Questions? Open an issue on the project’s{" "}
        <a href="https://github.com/levithefirst/clew" className="text-ink-2 underline underline-offset-2 hover:text-ink">GitHub repository</a>.
      </p>
    </LegalPage>
  );
}
