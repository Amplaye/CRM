import { NextResponse } from "next/server";
import { auth, db } from "@/lib/firebase/admin";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch (e) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    
    const uid = decodedToken.uid;
    const body = await req.json();
    const { tenantId } = body;

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    // Verify membership
    const membersRef = db.collection("tenant_members");
    const snapshot = await membersRef
      .where("user_id", "==", uid)
      .where("tenant_id", "==", tenantId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: "Not a member of this tenant" }, { status: 403 });
    }

    const membership = snapshot.docs[0].data();
    const role = membership.role;

    // Preserve existing custom claims if any (e.g. platform_admin) by fetching the user record
    const userRecord = await auth.getUser(uid);
    const existingClaims = userRecord.customClaims || {};

    // Set custom claims
    await auth.setCustomUserClaims(uid, {
      ...existingClaims,
      active_tenant_id: tenantId,
      tenant_role: role,
    });

    return NextResponse.json({ success: true, role });
  } catch (error: any) {
    console.error("Error setting tenant claims:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
