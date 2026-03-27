const admin = require("firebase-admin");
const path = require("path");

// Initialize Firebase Admin
// Make sure you have the emulator running or proper credentials configured
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "demo-tableflow-ai";

admin.initializeApp({
  projectId: "demo-tableflow-ai" // standard local emulator project
});

const db = admin.firestore();
const auth = admin.auth();

const usersToSeed = [
  {
    email: "admin@tableflow.ai",
    password: "password123",
    name: "System Administrator",
    globalRole: "platform_admin",
    tenantMemberships: [] // Admins don't strictly need memberships to read things, but can be added.
  },
  {
    email: "owner@oceanview.com",
    password: "password123",
    name: "Oceanview Owner",
    globalRole: "user",
    tenantMemberships: [
      { tenantId: "tenant_oceanview", role: "owner" }
    ]
  },
  {
    email: "manager@oceanview.com",
    password: "password123",
    name: "Oceanview Manager",
    globalRole: "user",
    tenantMemberships: [
      { tenantId: "tenant_oceanview", role: "manager" }
    ]
  },
  {
    email: "host@oceanview.com",
    password: "password123",
    name: "Oceanview Host",
    globalRole: "user",
    tenantMemberships: [
      { tenantId: "tenant_oceanview", role: "host" }
    ]
  },
  {
    email: "manager@mountainpizza.com",
    password: "password123",
    name: "Mountain Pizza Manager",
    globalRole: "user",
    tenantMemberships: [
      { tenantId: "tenant_mountain", role: "manager" }
    ]
  },
  {
    email: "readonly@partner.com",
    password: "password123",
    name: "Accounting Firm",
    globalRole: "user",
    tenantMemberships: [
      { tenantId: "tenant_oceanview", role: "readonly" },
      { tenantId: "tenant_mountain", role: "readonly" }
    ]
  }
];

const tenantsToSeed = [
  {
    id: "tenant_oceanview",
    name: "Oceanview Grill",
    settings: { timezone: "America/New_York", currency: "USD", ai_enabled_channels: ["whatsapp", "voice"] },
    created_at: Date.now()
  },
  {
    id: "tenant_mountain",
    name: "Mountain Pizza & Lodge",
    settings: { timezone: "America/Denver", currency: "USD", ai_enabled_channels: ["whatsapp"] },
    created_at: Date.now()
  }
];

async function seed() {
  console.log("Starting Auth and Multi-Tenant Seeding...");

  // Seed Tenants
  for (const tenant of tenantsToSeed) {
    await db.collection("tenants").doc(tenant.id).set(tenant);
    console.log(`✅ Seeded Tenant: ${tenant.name}`);
  }

  // Seed Users
  for (const userData of usersToSeed) {
    let authUser;
    try {
      authUser = await auth.getUserByEmail(userData.email);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        authUser = await auth.createUser({
          email: userData.email,
          password: userData.password,
          displayName: userData.name,
        });
      } else {
        throw e;
      }
    }

    if (userData.globalRole === "platform_admin") {
       await auth.setCustomUserClaims(authUser.uid, { role: "platform_admin" });
    }

    // Write to users collection
    await db.collection("users").doc(authUser.uid).set({
      id: authUser.uid,
      email: userData.email,
      name: userData.name,
      global_role: userData.globalRole,
      created_at: Date.now()
    });

    // Write to tenant_members collection
    for (const membership of userData.tenantMemberships) {
       const memId = `${membership.tenantId}_${authUser.uid}`;
       await db.collection("tenant_members").doc(memId).set({
         id: memId,
         tenant_id: membership.tenantId,
         user_id: authUser.uid,
         role: membership.role,
         created_at: Date.now()
       });
    }

    console.log(`✅ Seeded User: ${userData.email} [${userData.globalRole}]`);
  }

  console.log("Seeding complete! You can now log in using the demo creds.");
  process.exit(0);
}

seed().catch(console.error);
