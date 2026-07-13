"use client";

// Gift-card management (Fase 5): the owner sees vouchers sold — code, value,
// remaining balance, status, buyer/recipient — plus the public purchase link
// to share. Read-only via RLS member read; purchases and redemptions are
// written by the webhook and the pay route.

import { hasActivePlan } from "@/lib/billing/entitlements";
import { getFeatures } from "@/lib/types/tenant-settings";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { formatGiftCents } from "@/lib/gift-cards/gift-cards";
import { GiftDesignEditor } from "@/components/gift-cards/GiftDesignEditor";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Gift } from "lucide-react";
import Link from "next/link";

const CARD = { borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" } as const;

interface GiftRow {
  id: string;
  code: string;
  amount_cents: number;
  balance_cents: number;
  currency: string;
  buyer_email: string | null;
  recipient_email: string | null;
  recipient_name: string | null;
  status: "active" | "redeemed" | "expired";
  created_at: string;
}

export default function GiftCardsPage() {
  const { t } = useLanguage();
  const { activeTenant, activeRole } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<GiftRow[]>([]);
  const [loading, setLoading] = useState(true);

  const planActive = hasActivePlan(activeTenant?.settings);
  const enabled = getFeatures(activeTenant?.settings).gift_cards_enabled;
  // Designing the cards the public page sells is an owner/manager job — the same
  // bar as editing the site. A host reading the sold-vouchers list sees no editor.
  const canEdit =
    activeRole === "owner" || activeRole === "manager" || activeRole === "platform_admin";

  useEffect(() => {
    if (!activeTenant || !enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("gift_cards")
        .select("id, code, amount_cents, balance_cents, currency, buyer_email, recipient_email, recipient_name, status, created_at")
        .eq("tenant_id", activeTenant.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (!cancelled) {
        setRows((data || []) as GiftRow[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTenant, enabled, supabase]);

  if (!planActive || !enabled) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-2xl font-bold text-black">{t("gift_title")}</h1>
        <div className="mt-4 rounded-xl border-2 p-6 max-w-xl" style={CARD}>
          <p className="text-sm text-black">{t("gift_disabled_hint")}</p>
          <Link
            href="/settings?tab=features"
            className="mt-3 inline-block text-sm font-semibold text-white rounded-lg px-4 py-2"
            style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}
          >
            {t("reviews_disabled_cta")}
          </Link>
        </div>
      </div>
    );
  }

  const publicUrl = activeTenant ? `/g/${activeTenant.slug}` : "#";
  const soldCents = rows.reduce((s, r) => s + r.amount_cents, 0);
  const openCents = rows.filter((r) => r.status === "active").reduce((s, r) => s + r.balance_cents, 0);

  const STATUS_LABEL: Record<GiftRow["status"], string> = {
    active: t("gift_status_active"),
    redeemed: t("gift_status_redeemed"),
    expired: t("gift_status_expired"),
  };

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <Gift className="w-6 h-6" />
            {t("gift_title")}
          </h1>
          <p className="text-sm text-black mt-1">{t("gift_desc")}</p>
        </div>
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #c4956a, #a0764e)" }}
        >
          <ExternalLink className="w-4 h-4" />
          {t("gift_open_page")}
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border-2 p-4" style={CARD}>
          <p className="text-xs font-semibold text-black">{t("gift_kpi_count")}</p>
          <p className="text-2xl font-bold text-black">{rows.length}</p>
        </div>
        <div className="rounded-xl border-2 p-4" style={CARD}>
          <p className="text-xs font-semibold text-black">{t("gift_kpi_sold")}</p>
          <p className="text-2xl font-bold text-black">{formatGiftCents(soldCents)}</p>
        </div>
        <div className="rounded-xl border-2 p-4" style={CARD}>
          <p className="text-xs font-semibold text-black">{t("gift_kpi_open")}</p>
          <p className="text-2xl font-bold text-black">{formatGiftCents(openCents)}</p>
        </div>
      </div>

      <GiftDesignEditor canEdit={canEdit} />

      {loading ? (
        <p className="text-sm text-black">…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-black">{t("gift_none")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border-2" style={{ borderColor: "#c4956a" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ background: "rgba(252,246,237,0.85)" }}>
                <th className="px-4 py-3 font-bold text-black">{t("gift_col_code")}</th>
                <th className="px-4 py-3 font-bold text-black">{t("gift_col_value")}</th>
                <th className="px-4 py-3 font-bold text-black">{t("gift_col_balance")}</th>
                <th className="px-4 py-3 font-bold text-black">{t("gift_col_status")}</th>
                <th className="px-4 py-3 font-bold text-black">{t("gift_col_recipient")}</th>
                <th className="px-4 py-3 font-bold text-black">{t("gift_col_date")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t-2" style={{ borderColor: "rgba(196,149,106,0.35)" }}>
                  <td className="px-4 py-3 font-mono font-semibold text-black">{r.code}</td>
                  <td className="px-4 py-3 text-black">{formatGiftCents(r.amount_cents, r.currency)}</td>
                  <td className="px-4 py-3 text-black">{formatGiftCents(r.balance_cents, r.currency)}</td>
                  <td className="px-4 py-3 text-black">{STATUS_LABEL[r.status]}</td>
                  <td className="px-4 py-3 text-black">
                    {r.recipient_name || r.recipient_email || r.buyer_email || "—"}
                  </td>
                  <td className="px-4 py-3 text-black">{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
