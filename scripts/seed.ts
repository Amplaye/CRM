import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// Tell the admin SDK to use the emulator
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const app = initializeApp({ projectId: "demo-tableflow-ai" });
const db = getFirestore(app);
const auth = getAuth(app);

const tenants = [
  {
    id: "tenant-picnic",
    name: "PICNIC",
    created_at: Date.now(),
    settings: { timezone: "Europe/Madrid", currency: "EUR", ai_enabled_channels: ["whatsapp", "voice"] }
  },
  {
    id: "tenant-trattoria",
    name: "Trattoria Napoletana",
    created_at: Date.now(),
    settings: { timezone: "Europe/Rome", currency: "EUR", ai_enabled_channels: ["whatsapp"] }
  }
];

const users = [
  { uid: "admin-user", email: "admin@tableflow.ai", password: "password123", name: "Platform Admin", role: "platform_admin" },
  { uid: "picnic-owner", email: "owner@picnic.com", password: "password123", name: "Sarah Owner", role: "user" },
  { uid: "trattoria-mgr", email: "manager@trattoria.com", password: "password123", name: "Marco Manager", role: "user" },
  { uid: "picnic-host", email: "host@picnic.com", password: "password123", name: "Host Team", role: "user" }
];

async function seed() {
  console.log("Starting Phase 2 DB seeding to Emulators...");

  // 1. Create Users
  for (const u of users) {
    try {
      await auth.createUser({ uid: u.uid, email: u.email, password: u.password, displayName: u.name });
    } catch (e: any) {
      if (e.code !== "auth/uid-already-exists") throw e;
    }
    await db.collection("users").doc(u.uid).set({
      id: u.uid, email: u.email, name: u.name, global_role: u.role, created_at: Date.now()
    });
  }

  // 2. Create Tenants
  for (const t of tenants) {
    await db.collection("tenants").doc(t.id).set(t);
  }

  // 3. Create Tenant Memberships (Roles tested)
  await db.collection("tenant_members").doc("tenant-picnic_picnic-owner").set({
    id: "tenant-picnic_picnic-owner", tenant_id: "tenant-picnic", user_id: "picnic-owner", role: "owner", created_at: Date.now()
  });
  await db.collection("tenant_members").doc("tenant-picnic_picnic-host").set({
    id: "tenant-picnic_picnic-host", tenant_id: "tenant-picnic", user_id: "picnic-host", role: "host", created_at: Date.now()
  });

  // 4. Seeding Data for PICNIC - 200 Guests
  const picnicGuests = Array.from({length: 200}).map((_, i) => ({
    id: `guest-picnic-${i}`, tenant_id: "tenant-picnic", name: `Guest ${i}`,
    phone: `+346001230${String(i).padStart(2, '0')}`, visit_count: Math.floor(Math.random() * 15),
    no_show_count: Math.random() > 0.9 ? 1 + Math.floor(Math.random() * 3) : 0, 
    cancellation_count: Math.floor(Math.random() * 2),
    tags: Math.random() > 0.85 ? ["VIP"] : (Math.random() > 0.9 ? ["At Risk"] : []), 
    notes: Math.random() > 0.8 ? "Prefers terrace seating" : "", 
    created_at: Date.now(), updated_at: Date.now()
  }));

  const batchSize = 100;
  for (let i = 0; i < picnicGuests.length; i += batchSize) {
     const batch = db.batch();
     for(const g of picnicGuests.slice(i, i + batchSize)) {
        batch.set(db.collection("guests").doc(g.id), g);
     }
     await batch.commit();
  }

  // Baseline Metrics for Analytics (Before AI vs After AI)
  await db.collection("baseline_metrics").doc("tenant-picnic").set({
     tenant_id: "tenant-picnic",
     pre_ai: {
        avg_monthly_covers: 3200,
        avg_monthly_no_shows: 85,
        avg_monthly_unanswered_calls: 150,
        avg_response_time_minutes: 45
     },
     post_ai: {
        avg_monthly_covers: 3500,
        avg_monthly_no_shows: 25,
        avg_monthly_unanswered_calls: 5,
        avg_response_time_minutes: 1
     }
  });

  // 5. Richer Reservations
  const statuses = ["confirmed", "seated", "completed", "cancelled", "no_show", "pending_confirmation"];
  const sources = ["ai_chat", "ai_voice", "web", "staff", "walk_in"];

  const picnicReservations = Array.from({length: 300}).map((_, i) => {
    // Skew recency, more confirmed, some no shows
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const source = sources[Math.floor(Math.random() * sources.length)];
    return {
      id: `res-picnic-${i}`, tenant_id: "tenant-picnic", guest_id: `guest-picnic-${i % 200}`,
      date: "2026-03-25", time: `${18 + (i % 5)}:00`, party_size: (i % 6) + 2,
      status: status,
      source: source,
      created_by_type: source.startsWith("ai") ? "ai" : "staff",
      notes: Math.random() > 0.8 ? "Birthday celebration" : "", 
      allergies: Math.random() > 0.9 ? ["Gluten"] : [],
      created_at: Date.now() - (Math.random() * 10000000), 
      updated_at: Date.now()
    }
  });

  for (let i = 0; i < picnicReservations.length; i += batchSize) {
     const batch = db.batch();
     for(const r of picnicReservations.slice(i, i + batchSize)) {
        batch.set(db.collection("reservations").doc(r.id), r);
     }
     await batch.commit();
  }

  console.log("Phase 2 Seeding complete.");
}

seed().catch(console.error);
