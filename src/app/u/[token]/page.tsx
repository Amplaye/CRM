import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyUnsubscribeToken } from "@/lib/marketing/unsubscribe";

// Public one-click unsubscribe (the footer link of every campaign email).
// Opening the page IS the action — no confirm step, per GDPR/e-mail marketing
// good practice: flips guests.marketing_opt_out and the guest never appears
// in a campaign audience again (filtered in resolveRecipients).

export const dynamic = "force-dynamic";

export default async function UnsubscribePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const payload = verifyUnsubscribeToken(token);

  let name = "";
  let ok = false;
  if (payload) {
    const svc = createServiceRoleClient();
    const [{ error }, { data: tenant }] = await Promise.all([
      svc.from("guests").update({ marketing_opt_out: true }).eq("id", payload.g).eq("tenant_id", payload.t),
      svc.from("tenants").select("name").eq("id", payload.t).maybeSingle(),
    ]);
    ok = !error;
    name = tenant?.name || "";
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#fcf6ed" }}>
      <div className="max-w-md w-full text-center rounded-2xl border-2 p-10" style={{ borderColor: "#c4956a", background: "#fff" }}>
        <h1 className="text-xl font-bold text-black">
          {ok ? "Baja confirmada · Disiscrizione confermata" : "Enlace no válido · Link non valido"}
        </h1>
        <p className="mt-3 text-sm text-black leading-relaxed">
          {ok
            ? `No recibirás más emails promocionales${name ? ` de ${name}` : ""}. · Non riceverai più email promozionali${name ? ` da ${name}` : ""}.`
            : "El enlace ha caducado o no es correcto. · Il link è scaduto o non è corretto."}
        </p>
        {name && <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-black">{name}</p>}
      </div>
    </div>
  );
}
