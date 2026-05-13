import { createServiceRoleClient } from "@/lib/supabase/server";

export type SystemLogCategory =
  | "booking_error"
  | "webhook_failure"
  | "message_failure"
  | "api_error"
  | "ai_error"
  | "automation"
  | "system";

export type SystemLogSeverity = "low" | "medium" | "high" | "critical";

export async function logSystemEvent(event: {
  tenant_id?: string;
  category: SystemLogCategory;
  severity: SystemLogSeverity;
  title: string;
  description?: string;
  metadata?: Record<string, any>;
}) {
  try {
    const supabase = createServiceRoleClient();
    await supabase.from("system_logs").insert({
      tenant_id: event.tenant_id || null,
      category: event.category,
      severity: event.severity,
      title: event.title,
      description: event.description || null,
      metadata: event.metadata || {},
      status: "open",
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Failed to log system event:", err);
  }
}
