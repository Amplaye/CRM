import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Public hosted menu page. No auth, no cookies, no JS framework needed for
// the content path. The CRM owner shares /m/<slug> as a QR target so the
// menu stays editable in the CRM while the QR sticker remains the same.
//
// We hide unavailable items so the restaurant can mark "esaurito" live
// without re-publishing.

type Params = { slug: string };

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  settings: { timezone?: string; currency?: string };
};

type CategoryRow = { id: string; name: string; sort_order: number };

type ItemRow = {
  id: string;
  category_id: string | null;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  allergens: string[];
  tags: string[];
  available: boolean;
  sort_order: number;
};

export default async function PublicMenuPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const sb = createServiceRoleClient();

  const { data: tenant } = (await sb
    .from("tenants")
    .select("id,name,slug,status,settings")
    .eq("slug", slug)
    .maybeSingle()) as { data: TenantRow | null };

  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) {
    notFound();
  }

  const [{ data: catsRaw }, { data: itemsRaw }] = await Promise.all([
    sb
      .from("menu_categories")
      .select("id,name,sort_order")
      .eq("tenant_id", tenant.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    sb
      .from("menu_items")
      .select(
        "id,category_id,name,description,price,currency,allergens,tags,available,sort_order"
      )
      .eq("tenant_id", tenant.id)
      .eq("available", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const cats = (catsRaw || []) as CategoryRow[];
  const items = (itemsRaw || []) as ItemRow[];

  const byCat = new Map<string | null, ItemRow[]>();
  for (const it of items) {
    const k = it.category_id;
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(it);
  }

  const groups = cats
    .map((c) => ({ category: c, items: byCat.get(c.id) || [] }))
    .concat(byCat.has(null) ? [{ category: null as unknown as CategoryRow, items: byCat.get(null) || [] }] : [])
    .filter((g) => g.items.length > 0);

  const isEmpty = groups.length === 0;

  return (
    <div style={{ background: "#fff8ef", minHeight: "100vh" }} className="font-sans text-black">
      <header
        className="px-5 py-8 text-center"
        style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)", color: "white" }}
      >
        <h1 className="text-3xl md:text-4xl font-black tracking-tight">{tenant.name}</h1>
        <p className="text-xs uppercase tracking-widest opacity-90 mt-2">Menu</p>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8">
        {isEmpty ? (
          <div className="text-center py-16">
            <p className="text-sm text-black/60">Menù in aggiornamento.</p>
          </div>
        ) : (
          <div className="space-y-10">
            {groups.map((g) => (
              <section key={g.category?.id || "uncat"}>
                <h2
                  className="text-lg font-black uppercase tracking-widest mb-4 pb-2 border-b-2"
                  style={{ borderColor: "#c4956a" }}
                >
                  {g.category?.name || "Altro"}
                </h2>
                <ul className="space-y-4">
                  {g.items.map((it) => (
                    <li key={it.id}>
                      <div className="flex justify-between items-baseline gap-4">
                        <h3 className="font-bold text-base">{it.name}</h3>
                        {it.price != null && (
                          <span className="text-sm font-bold whitespace-nowrap">
                            {it.price.toFixed(2)} {it.currency === "EUR" ? "€" : it.currency}
                          </span>
                        )}
                      </div>
                      {it.description && (
                        <p className="text-sm text-black/70 leading-relaxed mt-1">{it.description}</p>
                      )}
                      {(it.tags.length > 0 || it.allergens.length > 0) && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {it.tags.map((tg) => (
                            <span
                              key={tg}
                              className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800"
                            >
                              {tg}
                            </span>
                          ))}
                          {it.allergens.map((al) => (
                            <span
                              key={al}
                              className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-orange-100 text-orange-800"
                            >
                              {al.replace("_", " ")}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-black/40 py-6">
        Powered by <span className="font-bold">BaliFlow</span>
      </footer>
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
    title: data?.name ? `Menu — ${data.name}` : "Menu",
    description: data?.name ? `Il menu di ${data.name}` : "Menu del ristorante",
  };
}
