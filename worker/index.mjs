// Custom Worker entrypoint for the OpenNext build.
//
// OpenNext generates `.open-next/worker.js` with ONLY a `fetch` handler (plus
// the Durable Object named exports). Cloudflare Cron Triggers invoke
// `scheduled()`, which that generated worker does not export — so this thin
// wrapper re-exports everything from the generated worker and adds a
// `scheduled` handler that runs the cron dispatcher. `main` in wrangler.jsonc
// points here, not at the generated file (which is regenerated every build).
//
// The dispatcher logic lives in src/lib/cron/dispatch.ts (pure + unit-tested);
// this file only wires it to the Cloudflare `scheduled` contract and the env.

import openNextWorker from "../.open-next/worker.js";
import { runCronTick } from "../src/lib/cron/dispatch";

// Durable Objects that OpenNext requires to be exported from the worker module.
// Re-exported verbatim from the generated worker so the class bindings resolve.
export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from "../.open-next/worker.js";

export default {
  fetch: openNextWorker.fetch,

  async scheduled(controller, env, ctx) {
    // The worker calls its own public HTTP endpoints (the /api/cron/* routes),
    // so baseUrl must be the deployed origin. Set CRON_BASE_URL to the preview
    // host during staging and to https://app.baliflowagency.com at cutover.
    const baseUrl = env.CRON_BASE_URL;
    const cronSecret = env.CRON_SECRET;
    if (!baseUrl || !cronSecret) {
      console.error("cron: missing CRON_BASE_URL or CRON_SECRET — skipping tick");
      return;
    }
    ctx.waitUntil(
      runCronTick({
        scheduledTime: controller.scheduledTime,
        baseUrl,
        cronSecret,
        fetchImpl: fetch,
      }).then((r) => {
        console.log(`cron tick hour=${r.hour}`, JSON.stringify(r.ran));
      }),
    );
  },
};
