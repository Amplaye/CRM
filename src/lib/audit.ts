import { createServiceRoleClient } from "@/lib/supabase/server";

export async function logAuditEvent(event: {
  tenant_id: string;
  action: string;
  entity_id: string;
  idempotency_key?: string;
  source: "ai_agent" | "system" | "staff";
  agent_id?: string;
  details: Record<string, any>;
}) {
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("audit_events")
    .insert({
      ...event,
      created_at: new Date().toISOString(),
    });

  if (error) console.error("Failed to log audit event:", error);
}
