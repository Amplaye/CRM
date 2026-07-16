"use client";

import { useEffect, useState } from "react";
import { QrCode, Loader2, CheckCircle2, XCircle, Unplug } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";

// Settings → Pagamenti → "Pagamento al tavolo (QR)": the venue's OWN Stripe key.
// Table-QR payments charge the guest on THIS account — the platform's Stripe is
// never used for a venue's takings. Same connect/disconnect UX as the tenant
// Resend key: the key is written, validated against Stripe, and never read back
// to the browser.

const tk = (k: string) => k as keyof Dictionary;

export function TablePayCard() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();

  const [connected, setConnected] = useState<boolean | null>(null);
  const [livemode, setLivemode] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/billing/table-pay?tenant_id=${tenant.id}`);
        const data = await res.json();
        if (cancelled) return;
        setConnected(!!data?.connected);
        setLivemode(data?.livemode ?? null);
      } catch {
        if (!cancelled) setConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant?.id]);

  async function save() {
    if (!tenant?.id || !apiKey.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/billing/table-pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenant.id, api_key: apiKey.trim() }),
      });
      const data = await res.json();
      if (data?.ok) {
        setConnected(true);
        setLivemode(!!data.livemode);
        setApiKey("");
        const extra = !data.livemode
          ? ` ${t(tk("settings_table_pay_testmode"))}`
          : data.charges_enabled === false
            ? ` ${t(tk("settings_table_pay_charges_disabled"))}`
            : "";
        setMsg({ ok: true, text: `${t(tk("settings_table_pay_saved"))}${extra}` });
      } else if (data?.error === "key_format") {
        setMsg({ ok: false, text: t(tk("settings_table_pay_key_format")) });
      } else if (data?.error === "key_rejected") {
        setMsg({ ok: false, text: t(tk("settings_table_pay_key_rejected")) });
      } else {
        setMsg({ ok: false, text: data?.error || "Error" });
      }
    } catch {
      setMsg({ ok: false, text: t(tk("settings_table_pay_key_rejected")) });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!tenant?.id || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/billing/table-pay", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenant.id }),
      });
      const data = await res.json();
      if (data?.ok) {
        setConnected(false);
        setLivemode(null);
      }
    } catch {
      /* keep state */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-center gap-2">
        <QrCode className="w-5 h-5 text-black" />
        <h3 className="text-sm font-bold text-black">{t(tk("settings_table_pay_title"))}</h3>
      </div>
      <p className="text-xs text-black">{t(tk("settings_table_pay_desc"))}</p>

      {connected === null ? (
        <Loader2 className="w-4 h-4 animate-spin text-black" />
      ) : connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
            {t(tk("settings_table_pay_connected"))}
            {livemode === false ? " (TEST)" : ""}
          </span>
          <button
            onClick={disconnect}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-black cursor-pointer disabled:opacity-40"
          >
            <Unplug className="w-3.5 h-3.5" />
            {t(tk("settings_table_pay_disconnect"))}
          </button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t(tk("settings_table_pay_key_placeholder"))}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm text-black placeholder:text-gray-400 outline-none font-mono"
          />
          <button
            onClick={save}
            disabled={busy || !apiKey.trim()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer"
            style={{ background: "linear-gradient(135deg, #635bff, #4f46e5)" }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t(tk("settings_table_pay_save"))}
          </button>
        </div>
      )}

      {connected === false && msg === null ? (
        <p className="text-xs text-black">{t(tk("settings_table_pay_not_connected"))}</p>
      ) : null}

      {msg && (
        <div
          className={`flex items-start gap-2 text-sm rounded-lg p-3 ${msg.ok ? "text-emerald-700" : "text-red-600"}`}
          style={{ background: msg.ok ? "rgba(5,150,105,0.06)" : "rgba(220,38,38,0.06)" }}
        >
          {msg.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}
    </div>
  );
}
