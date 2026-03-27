import { db } from './firebase/admin';
import { AuditEvent } from './types';

/**
 * Creates an immutable audit log entry for actions taken by the AI or staff.
 */
export async function logAuditEvent(tenantId: string, event: Omit<AuditEvent, 'id' | 'created_at' | 'tenant_id'>) {
   try {
      const ref = db.collection('audit_logs').doc();
      const auditLog: AuditEvent = {
         id: ref.id,
         tenant_id: tenantId,
         created_at: Date.now(),
         ...event
      };
      await ref.set(auditLog);
      return ref.id;
   } catch (error) {
      console.error("Failed to log audit event:", error);
      // We don't throw here to prevent blocking the main business logic
      // But in a strict production environment, we might want to alert on this.
      return null;
   }
}
