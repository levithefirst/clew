// web/lib/core is a generated copy of src/ (Vercel builds web/ on its own). It must never drift.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain .mjs without types
import { stale } from "../web/scripts/sync-core.mjs";

test("web/lib/core matches src/ (run `npm run sync-core` in web/ after editing src/)", () => {
  assert.deepEqual(stale(), []);
});
