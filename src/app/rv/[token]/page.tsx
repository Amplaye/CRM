import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyReviewToken } from "@/lib/reviews/token";
import { getFeatures, type TenantSettings } from "@/lib/types/tenant-settings";
import { ReviewForm } from "./ReviewForm";

// Public certified-review page — the /rv/<token> target of the post-visit
// follow-up. The signed token proves the reservation existed (no login), so
// every review collected here is from a real diner. After a 4-5 star submit the
// form offers the tenant's public Google review link (settings.review_url).
// Same public-page pattern as /m/<slug>: service-role read, no auth.

export const dynamic = "force-dynamic";

export default async function ReviewPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const payload = verifyReviewToken(token);

  const supabase = createServiceRoleClient();
  const tenant = payload
    ? (
        await supabase
          .from("tenants")
          .select("id, name, slug, settings")
          .eq("slug", payload.s)
          .maybeSingle()
      ).data
    : null;

  const settings = (tenant?.settings ?? {}) as TenantSettings & { review_url?: string };
  const enabled = tenant ? getFeatures(settings).reviews_enabled : false;

  // Reservation must exist and belong to the token's tenant.
  const reservation =
    payload && tenant
      ? (
          await supabase
            .from("reservations")
            .select("id, date, language, guest_id, guests(name)")
            .eq("id", payload.r)
            .eq("tenant_id", tenant.id)
            .maybeSingle()
        ).data
      : null;

  const existing =
    reservation && tenant
      ? (
          await supabase
            .from("reviews")
            .select("rating, comment")
            .eq("reservation_id", reservation.id)
            .maybeSingle()
        ).data
      : null;

  const valid = !!(payload && tenant && enabled && reservation);
  const lang = ((reservation?.language || "es").slice(0, 2)) as "es" | "it" | "en" | "de";
  const guestName =
    ((reservation?.guests as { name?: string | null } | null)?.name || "").split(" ")[0] || "";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: "#fcf6ed" }}>
      <div className="max-w-md w-full rounded-2xl border-2 p-8" style={{ borderColor: "#c4956a", background: "#fff" }}>
        {valid ? (
          <ReviewForm
            token={token}
            tenantName={tenant!.name || ""}
            guestName={guestName}
            lang={lang}
            reviewUrl={(settings.review_url || "").trim()}
            brandColor={settings.menu_branding?.brand_color || "#c4956a"}
            initialRating={existing?.rating ?? 0}
            initialComment={existing?.comment ?? ""}
          />
        ) : (
          <div className="text-center">
            <h1 className="text-xl font-bold text-black">Enlace no válido · Link non valido</h1>
            <p className="mt-2 text-sm text-black">
              El enlace de la reseña ha caducado o no es correcto. · Il link della recensione è scaduto o non è corretto.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
