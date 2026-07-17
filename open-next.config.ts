// OpenNext (Cloudflare) config for tableflow-ai (BaliFlow CRM).
//
// No incrementalCache override is set on purpose: every dynamic page in this
// app declares `export const revalidate = 0` and there is no unstable_cache /
// revalidateTag usage, so there is no ISR/static content to persist. Adding an
// R2/KV incremental cache would only add a binding + bucket to provision for
// zero benefit. If a future page introduces `revalidate > 0`, wire
// r2IncrementalCache here (and add the NEXT_INC_CACHE_R2_BUCKET binding in
// wrangler.jsonc) at that point.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
