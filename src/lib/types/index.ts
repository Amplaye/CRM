export type GlobalRole = "platform_admin" | "user";
export type TenantRole = "owner" | "admin" | "manager" | "host" | "marketing" | "readonly";

export interface User {
  id: string; // Supabase Auth UID
  email: string;
  name: string;
  global_role: GlobalRole;
  created_at: number;
}

export interface Tenant {
  id: string;
  name: string;
  created_at: number;
  settings: {
    timezone: string;
    currency: string;
    ai_enabled_channels: string[]; // e.g., ['whatsapp', 'voice']
  };
}

export interface TenantMember {
  id: string; // e.g. tenantId_userId
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  created_at: number;
}

export interface AutomationRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  trigger: "on_reservation_created" | "on_reservation_cancelled" | "on_waitlist_match" | "on_ai_escalation" | "schedule";
  condition?: Record<string, any>;
  action: {
     type: "send_sms" | "send_email" | "update_status" | "notify_staff";
     payload: Record<string, any>;
  };
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface Incident {
  id: string;
  tenant_id: string;
  type: "complaint" | "ai_error" | "conflict" | "health_safety";
  title: string;
  description: string;
  status: "open" | "investigating" | "resolved";
  severity: "low" | "medium" | "critical";
  owner_id: string | null;
  linked_reservation_id?: string;
  linked_conversation_id?: string;
  created_at: number;
  updated_at: number;
}

export interface KnowledgeArticle {
  id: string;
  tenant_id: string;
  title: string;
  content: string;
  category: "policies" | "menu" | "troubleshooting" | "general";
  risk_tags: string[];
  status: "draft" | "published" | "archived";
  version: number;
  author_id: string;
  created_at: number;
  updated_at: number;
}

export interface Guest {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  email?: string;
  visit_count: number;
  no_show_count: number;
  cancellation_count: number;
  tags: string[];
  notes: string;
  dietary_notes?: string;
  accessibility_notes?: string;
  family_notes?: string;
  estimated_spend?: number;
  created_at: number;
  updated_at: number;
}

export type ReservationStatus = 
  | "inquiry"
  | "pending_confirmation"
  | "confirmed"
  | "seated"
  | "completed"
  | "cancelled"
  | "no_show"
  | "waitlist_offered"
  | "escalated";

export interface Reservation {
  id: string;
  tenant_id: string;
  guest_id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  party_size: number;
  status: ReservationStatus;
  source: "ai_chat" | "ai_voice" | "staff" | "web" | "walk_in";
  created_by_type: "ai" | "staff" | "guest";
  notes: string;
  allergies?: string[];
  tags?: string[];
  linked_conversation_id?: string;
  created_at: number;
  end_time?: string;
  shift?: 'lunch' | 'dinner';
  updated_at: number;
}

export interface RestaurantTable {
  id: string;
  tenant_id: string;
  name: string;
  seats: number;
  status: 'active' | 'inactive';
  position_x: number;
  position_y: number;
  created_at: number;
}

export interface ReservationTable {
  id: string;
  reservation_id: string;
  table_id: string;
  created_at: number;
}

export interface ReservationEvent {
  id: string;
  tenant_id: string;
  reservation_id: string;
  action: "created" | "status_changed" | "time_changed" | "party_size_changed" | "cancelled" | "note_added";
  previous_status?: ReservationStatus;
  new_status?: ReservationStatus;
  details?: string;
  changed_by_user_id: string; // ID of staff, or "ai_agent", or "system"
  created_at: number;
}

export type WaitlistStatus = "waiting" | "match_found" | "contacted" | "accepted" | "declined" | "expired" | "converted_to_booking";

export interface WaitlistEntry {
  id: string;
  tenant_id: string;
  guest_id: string;
  date: string; // YYYY-MM-DD
  target_time: string; // HH:mm
  party_size: number;
  acceptable_time_range: {
    start: string; // HH:mm
    end: string;   // HH:mm
  };
  contact_preference: "whatsapp" | "sms" | "call";
  priority_score: number; // e.g. 0-100 indicating VIP or urgency
  status: WaitlistStatus;
  matched_reservation_id?: string; // Links back to the suddenly available slot
  notes: string;
  created_at: number;
  updated_at: number;
}

export interface Conversation {
  id: string;
  tenant_id: string;
  guest_id: string;
  channel: "whatsapp" | "voice";
  intent: string; // e.g., 'booking_request', 'faq', 'modification'
  extracted_entities?: Record<string, any>;
  linked_reservation_id?: string;
  status: "active" | "resolved" | "escalated" | "abandoned";
  escalation_flag: boolean;
  sentiment: "positive" | "neutral" | "negative";
  summary: string;
  transcript: Array<{ role: "ai" | "user" | "system" | "staff"; content: string; timestamp: number }>;
  created_at: number;
  updated_at: number;
}



// --- PHASE 3: EXTERNAL AI INTEGRATION TYPES ---

export interface AuditEvent {
  id: string;
  tenant_id: string;
  action: "create_reservation" | "modify_reservation" | "cancel_reservation" | "create_waitlist" | "handoff" | "create_incident";
  entity_id: string; // The ID of the reservation/waitlist item created or modified
  idempotency_key?: string; // To prevent LLM retries from double-booking
  source: "ai_agent" | "system" | "staff";
  agent_id?: string; // Identifier for the specific AI system (e.g., "bland-ai-v1")
  details: Record<string, any>;
  created_at: number;
}

// API Payload Contracts (Strict definitions for LLM tool calling)

export interface CreateBookingRequest {
  tenant_id: string;
  guest_phone: string;
  guest_name?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  party_size: number;
  source: "ai_voice" | "ai_chat";
  idempotency_key: string; 
  notes?: string;
  linked_conversation_id?: string;
}

export interface ModifyBookingRequest {
  tenant_id: string;
  reservation_id: string;
  date?: string;
  time?: string;
  party_size?: number;
  status?: ReservationStatus;
  notes?: string;
}

export interface WebhookIngestionRequest {
  tenant_id: string;
  channel: "whatsapp" | "voice";
  guest_phone: string;
  message?: string;
  transcript?: Array<{ role: "user" | "ai" | "system"; content: string; timestamp: number }>;
  intent?: string;
  sentiment?: string;
  summary?: string;
}
