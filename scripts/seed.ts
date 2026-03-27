import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://azhlnybiqlkbhbboyvud.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function seed() {
  console.log("Starting Supabase seeding...");

  // 1. Create auth users via Supabase Admin API
  const usersToCreate = [
    { email: "admin@baliflow.com", password: "password123", name: "Platform Admin", global_role: "platform_admin" },
    { email: "owner@picnic.com", password: "password123", name: "Sarah Owner", global_role: "user" },
    { email: "manager@trattoria.com", password: "password123", name: "Marco Manager", global_role: "user" },
    { email: "host@picnic.com", password: "password123", name: "Host Team", global_role: "user" }
  ];

  const createdUsers: Record<string, string> = {};

  for (const u of usersToCreate) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { name: u.name }
    });

    if (error) {
      console.warn(`User ${u.email} may already exist:`, error.message);
      // Try to find existing user
      const { data: list } = await supabase.auth.admin.listUsers();
      const existing = list?.users?.find(usr => usr.email === u.email);
      if (existing) createdUsers[u.email] = existing.id;
      continue;
    }

    createdUsers[u.email] = data.user.id;

    // Update user profile with global_role
    await supabase.from("users").update({ global_role: u.global_role, name: u.name }).eq("id", data.user.id);
  }

  console.log("Users created:", Object.keys(createdUsers));

  // 2. Create Tenants
  const { data: tenant1 } = await supabase.from("tenants").insert({
    name: "PICNIC",
    business_type: "restaurant",
    settings: { timezone: "Europe/Madrid", currency: "EUR", ai_enabled_channels: ["whatsapp", "voice"] }
  }).select("id").single();

  const { data: tenant2 } = await supabase.from("tenants").insert({
    name: "Trattoria Napoletana",
    business_type: "restaurant",
    settings: { timezone: "Europe/Rome", currency: "EUR", ai_enabled_channels: ["whatsapp"] }
  }).select("id").single();

  if (!tenant1 || !tenant2) {
    console.error("Failed to create tenants");
    return;
  }

  console.log("Tenants created:", tenant1.id, tenant2.id);

  // 3. Create Tenant Memberships
  if (createdUsers["owner@picnic.com"]) {
    await supabase.from("tenant_members").insert({
      tenant_id: tenant1.id, user_id: createdUsers["owner@picnic.com"], role: "owner"
    });
  }
  if (createdUsers["host@picnic.com"]) {
    await supabase.from("tenant_members").insert({
      tenant_id: tenant1.id, user_id: createdUsers["host@picnic.com"], role: "host"
    });
  }
  if (createdUsers["manager@trattoria.com"]) {
    await supabase.from("tenant_members").insert({
      tenant_id: tenant2.id, user_id: createdUsers["manager@trattoria.com"], role: "manager"
    });
  }
  // Give admin access to both
  if (createdUsers["admin@baliflow.com"]) {
    await supabase.from("tenant_members").insert([
      { tenant_id: tenant1.id, user_id: createdUsers["admin@baliflow.com"], role: "owner" },
      { tenant_id: tenant2.id, user_id: createdUsers["admin@baliflow.com"], role: "owner" }
    ]);
  }

  // 4. Seed 200 Guests for PICNIC
  const guests = Array.from({ length: 200 }).map((_, i) => ({
    tenant_id: tenant1.id,
    name: `Guest ${i}`,
    phone: `+346001230${String(i).padStart(2, "0")}`,
    visit_count: Math.floor(Math.random() * 15),
    no_show_count: Math.random() > 0.9 ? 1 + Math.floor(Math.random() * 3) : 0,
    cancellation_count: Math.floor(Math.random() * 2),
    tags: Math.random() > 0.85 ? ["VIP"] : Math.random() > 0.9 ? ["At Risk"] : [],
    notes: Math.random() > 0.8 ? "Prefers terrace seating" : ""
  }));

  const { data: insertedGuests } = await supabase.from("guests").insert(guests).select("id");
  const guestIds = insertedGuests?.map(g => g.id) || [];

  console.log(`Seeded ${guestIds.length} guests`);

  // 5. Seed 300 Reservations for PICNIC
  const statuses = ["confirmed", "seated", "completed", "cancelled", "no_show", "pending_confirmation"];
  const sources = ["ai_chat", "ai_voice", "web", "staff", "walk_in"];

  const reservations = Array.from({ length: 300 }).map((_, i) => {
    const source = sources[Math.floor(Math.random() * sources.length)];
    return {
      tenant_id: tenant1.id,
      guest_id: guestIds[i % guestIds.length],
      date: "2026-03-25",
      time: `${18 + (i % 5)}:00`,
      party_size: (i % 6) + 2,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      source,
      created_by_type: source.startsWith("ai") ? "ai" : "staff",
      notes: Math.random() > 0.8 ? "Birthday celebration" : "",
      allergies: Math.random() > 0.9 ? ["Gluten"] : []
    };
  });

  // Insert in batches of 100
  for (let i = 0; i < reservations.length; i += 100) {
    await supabase.from("reservations").insert(reservations.slice(i, i + 100));
  }

  console.log("Seeded 300 reservations");
  console.log("Seeding complete!");
}

seed().catch(console.error);
