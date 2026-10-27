# Clew — web

Landing page for Clew. It is a separate Next.js app and does not touch the core in `..`.

```bash
cd web
npm install
npm run dev        # http://localhost:3141
npm run build && npm start
npm run data       # regenerate data/clew.json from ../memories.json, ../demo-output.txt, ../fixtures/pairs.json
```

- All data is static and comes from `data/clew.json`, which is generated from the core's real Mainnet memories and the demo run. The web app makes no live Tatum or Walrus calls and needs no secrets.
- Sign-in is optional. Copy `.env.example` to `.env.local` and set `AUTH_SECRET` plus the Google and/or GitHub OAuth IDs. A provider that isn't configured shows a "not configured" notice, and nothing on the page is gated behind sign-in.
