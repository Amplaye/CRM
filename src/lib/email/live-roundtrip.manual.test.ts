// Live round-trip against the REAL Supabase project — not part of the unit suite
// (it writes rows). Run explicitly:
//   npx vitest run src/lib/email/live-roundtrip.manual.test.ts --config vitest.live.mts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { encryptEmailSecret, resolveEmailApiKey } from "./credentials";
import { getEmailUsageThisMonth } from "./usage";

const T = "a085e5bb-11f3-47f9-96da-c6cfdbff2ea0"; // BALI Rest
const KEY = process.env.RESEND_API_KEY!;

describe("email BYO-key live round-trip", () => {
  it("encrypts → stores → resolves → counts → cleans up", async () => {
    const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const before = await getEmailUsageThisMonth(T, svc);
    console.log("PRIMA  (nessuna chiave):", JSON.stringify(before));
    expect(before.ownKey).toBe(false);
    expect(before.marketing.limit).toBeNull(); // pool condiviso → nessun limite mostrato

    await svc.from("email_secrets").upsert(
      { tenant_id: T, provider: "resend", secret_enc: encryptEmailSecret({ api_key: KEY }) },
      { onConflict: "tenant_id,provider" },
    );
    const resolved = await resolveEmailApiKey(svc, T);
    console.log("RISOLTA dal DB cifrato :", resolved === KEY ? "identica ✅" : "MISMATCH ❌");
    expect(resolved).toBe(KEY);

    await svc.from("email_send_log").insert({ tenant_id: T, kind: "marketing", own_key: true });
    const after = await getEmailUsageThisMonth(T, svc);
    console.log("DOPO   (chiave + 1 invio):", JSON.stringify(after));
    expect(after.ownKey).toBe(true);
    expect(after.marketing).toEqual({ sent: before.marketing.sent + 1, limit: 1000 });
    expect(after.transactional.limit).toBe(3000);

    await svc.from("email_secrets").delete().eq("tenant_id", T);
    await svc.from("email_send_log").delete().eq("tenant_id", T);
    const cleaned = await getEmailUsageThisMonth(T, svc);
    console.log("CLEANUP                :", JSON.stringify(cleaned));
    expect(cleaned.ownKey).toBe(false);
  }, 60_000);
});
