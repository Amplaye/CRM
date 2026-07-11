import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { hasActivePlan } from "@/lib/billing/entitlements";
import type { TenantSettings } from "@/lib/types/tenant-settings";
import { BOOKING_STRINGS, resolveSiteLocale } from "@/lib/site/booking-strings";
import { distinctRooms } from "@/lib/site/data";
import BookingWidget from "./BookingWidget";

// Public booking widget (Fase 7) — the "Prenota" button of the micro-site and
// the deep-link target for Instagram/Facebook bios. Same guest-page contract
// as /m /s /g: service-role read, no auth, tenant-locale copy inline. Booking
// goes through /api/public/book which reuses the full AI booking pipeline
// (availability, table fit, WhatsApp confirmation, deposit link).

type Params = { slug: string };

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BookingPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const sb = createServiceRoleClient();

  const { data: tenant } = (await sb
    .from("tenants")
    .select("id,name,slug,status,settings")
    .eq("slug", slug)
    .maybeSingle()) as { data: { id: string; name: string; slug: string; status: string; settings: TenantSettings } | null };

  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) notFound();
  if (!hasActivePlan(tenant.settings)) notFound();

  const { data: tableRows } = await sb
    .from("restaurant_tables")
    .select("zone")
    .eq("tenant_id", tenant.id)
    .eq("status", "active");
  const rooms = distinctRooms((tableRows || []) as { zone: string | null }[]);

  const ui = BOOKING_STRINGS[resolveSiteLocale(tenant.settings?.crm_locale)];
  const accent =
    tenant.settings?.site_branding?.brand_color || tenant.settings?.menu_branding?.brand_color || "#c4956a";

  return (
    <div
      className="min-h-screen px-4 py-10"
      style={{ background: "#fcf6ed", ["--accent" as string]: accent } as CSSProperties}
    >
      <div className="mx-auto max-w-lg">
        <h1 className="text-center text-3xl font-bold text-black">{ui.title}</h1>
        <p className="mt-2 text-center text-black">{tenant.name}</p>
        <BookingWidget slug={tenant.slug} accent={accent} rooms={rooms} strings={ui} />
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const sb = createServiceRoleClient();
  const { data } = (await sb
    .from("tenants")
    .select("name")
    .eq("slug", slug)
    .maybeSingle()) as { data: { name: string } | null };
  return {
    title: data?.name ? `Prenota — ${data.name}` : "Prenota",
  };
}
