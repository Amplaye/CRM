import { createServiceRoleClient } from "@/lib/supabase/server";
import { CheckCircle2, XCircle } from "lucide-react";

// Public deposit-checkout landing (?paid=1 success / ?paid=0 cancelled) — the
// success_url/cancel_url of the deposit Stripe Checkout. No auth (the guest is
// never a CRM user), service-role read of the tenant name only, same public
// pattern as /m/<slug>. Copy is multilingual on one page (es/it/en/de blocks
// would need the guest's lang, which Stripe doesn't echo back — so we show a
// compact bilingual line, like hotel receipts do).

export const dynamic = "force-dynamic";

export default async function DepositResultPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { slug } = await props.params;
  const { paid } = await props.searchParams;
  const ok = paid !== "0";

  const supabase = createServiceRoleClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("slug", slug)
    .maybeSingle();
  const name = tenant?.name || "";

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#fcf6ed" }}>
      <div className="max-w-md w-full text-center rounded-2xl border-2 p-10" style={{ borderColor: "#c4956a", background: "#fff" }}>
        {ok ? (
          <CheckCircle2 className="w-14 h-14 mx-auto text-emerald-600" />
        ) : (
          <XCircle className="w-14 h-14 mx-auto text-red-500" />
        )}
        <h1 className="mt-5 text-2xl font-bold text-black">
          {ok ? "¡Depósito recibido! · Caparra ricevuta!" : "Pago cancelado · Pagamento annullato"}
        </h1>
        <p className="mt-3 text-sm text-black leading-relaxed">
          {ok
            ? `Tu mesa está confirmada. ¡Te esperamos${name ? ` en ${name}` : ""}! · Il tuo tavolo è confermato. Ti aspettiamo${name ? ` da ${name}` : ""}!`
            : `El pago no se completó. Puedes volver a abrir el enlace para intentarlo de nuevo. · Il pagamento non è stato completato. Riapri il link per riprovare.`}
        </p>
        {name && <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-black">{name}</p>}
      </div>
    </div>
  );
}
