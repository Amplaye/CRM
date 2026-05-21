import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { syncSystemLogToTrello } from "@/lib/trello-sync";

// Picnic tenant — Trello board "Picnic" only mirrors Picnic errors for now.
const PICNIC_TENANT_ID = "626547ff-bc44-4f35-8f42-0e97f1dcf0d5";

function assertWebhookSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.SYSTEM_LOGS_WEBHOOK_SECRET;
  if (!expected) {
    console.warn("[SECURITY] SYSTEM_LOGS_WEBHOOK_SECRET not set — accepting all requests");
    return null;
  }
  const provided = req.headers.get("x-webhook-secret") || "";
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const unauth = assertWebhookSecret(req);
  if (unauth) return unauth;

  try {
    const body = await req.json().catch(() => ({}));
    // Supabase Database Webhook payload shape:
    // { type: 'INSERT'|'UPDATE'|'DELETE', table, schema, record, old_record }
    const type: "INSERT" | "UPDATE" | "DELETE" = body.type;
    const record = body.record || null;
    const oldRecord = body.old_record || null;

    // Only mirror Picnic errors to the Picnic board.
    if (record && record.tenant_id && record.tenant_id !== PICNIC_TENANT_ID) {
      return NextResponse.json({ success: true, skipped: "non-picnic tenant" });
    }

    const result = await syncSystemLogToTrello(type, record, oldRecord);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error("trello-sync error:", err?.message);
    return NextResponse.json({ error: err?.message || "error" }, { status: 500 });
  }
}
