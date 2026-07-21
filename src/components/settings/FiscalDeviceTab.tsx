"use client";

import { useMemo, useState } from "react";
import { Receipt, CheckCircle2, XCircle, Loader2, Plug, HelpCircle } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { getFiscalDriver, FISCAL_BRANDS } from "@/lib/cassa/fiscal-device/registry";
import { DEFAULT_VAT_REPARTO_MAP, type FiscalBrand, type FiscalDeviceConfig } from "@/lib/cassa/fiscal-device/types";

// Settings → Registratore fiscale (IT only). The "collega in 3 tocchi" wizard:
// pick brand, enter the RT's LAN address, test the connection, save.
//
// ⚠️ KEY DIFFERENCE from PosTab: "Prova connessione" runs IN THE BROWSER — it
// calls the driver directly against the device on the restaurant LAN. The
// Cloudflare Worker (edge) can't reach the LAN, so this must not go through a
// server route. Only the config (no secrets) is persisted via /api/cassa/settings.

const VAT_RATES = ["4", "5", "10", "22"] as const;

export function FiscalDeviceTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant } = useTenant();

  const existing = (tenant?.settings as any)?.cassa?.fiscal_device || {};

  const [enabled, setEnabled] = useState<boolean>(!!existing.enabled);
  const [brand, setBrand] = useState<FiscalBrand>(existing.brand || "axon");
  const [host, setHost] = useState<string>(existing.host || "");
  const [tls, setTls] = useState<boolean>(!!existing.tls);
  const [lottery, setLottery] = useState<boolean>(!!existing.lottery_enabled);
  const [repartoMap, setRepartoMap] = useState<Record<string, number>>(
    existing.vat_reparto_map && Object.keys(existing.vat_reparto_map).length
      ? existing.vat_reparto_map
      : DEFAULT_VAT_REPARTO_MAP,
  );

  const [phase, setPhase] = useState<"idle" | "testing" | "saving">("idle");
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const busy = phase !== "idle";
  const inputCls = "px-3 py-2 text-sm border-2 rounded-lg text-black w-full";
  const inputStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

  const cfg: FiscalDeviceConfig = useMemo(
    () => ({
      brand,
      transport: "lan_http",
      host: host.trim(),
      tls,
      vatRepartoMap: repartoMap,
      lotteryEnabled: lottery,
    }),
    [brand, host, tls, repartoMap, lottery],
  );

  async function runTest() {
    if (!host.trim()) return;
    setTest(null);
    setSaved(false);
    setPhase("testing");
    try {
      const res = await getFiscalDriver(brand).testConnection(cfg);
      if (res.ok) {
        const bits = [res.model, res.serial].filter(Boolean).join(" · ");
        setTest({
          ok: true,
          msg:
            (t("settings_rt_test_ok" as keyof Dictionary) || "Registratore collegato") +
            (bits ? ` — ${bits}` : ""),
        });
      } else {
        setTest({ ok: false, msg: res.error || t("settings_rt_test_fail" as keyof Dictionary) || "Non raggiungibile" });
      }
    } catch (e: any) {
      setTest({ ok: false, msg: e?.message || t("settings_rt_test_fail" as keyof Dictionary) || "Non raggiungibile" });
    } finally {
      setPhase("idle");
    }
  }

  async function save() {
    if (!tenant?.id) return;
    if (enabled && !host.trim()) {
      setTest({ ok: false, msg: t("settings_rt_host_required" as keyof Dictionary) || "Inserisci l'indirizzo del registratore" });
      return;
    }
    setSaved(false);
    setPhase("saving");
    try {
      const res = await fetch("/api/cassa/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenant.id,
          fiscal_device: {
            enabled,
            brand,
            transport: "lan_http",
            host: host.trim(),
            tls,
            vat_reparto_map: repartoMap,
            lottery_enabled: lottery,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTest({ ok: false, msg: data?.error || t("settings_rt_save_fail" as keyof Dictionary) || "Salvataggio non riuscito" });
      } else {
        setSaved(true);
        await refreshActiveTenant();
      }
    } catch (e: any) {
      setTest({ ok: false, msg: e?.message || t("settings_rt_save_fail" as keyof Dictionary) || "Salvataggio non riuscito" });
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-black flex items-center gap-2">
          <Receipt className="w-5 h-5" /> {t("settings_rt_title" as keyof Dictionary) || "Registratore fiscale"}
        </h2>
        <p className="mt-1 text-sm text-black">
          {t("settings_rt_desc" as keyof Dictionary) ||
            "Collega la cassa al tuo registratore telematico: da qui in poi ogni incasso stampa da solo il documento commerciale legale. Serve solo l'indirizzo del registratore in rete."}
        </p>
      </div>

      {/* Enable toggle */}
      <label className="flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer" style={{ borderColor: "#c4956a", background: "rgba(196,149,106,0.08)" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} className="mt-1 w-4 h-4 accent-[#c4956a]" />
        <div>
          <div className="font-bold text-black">{t("settings_rt_enable" as keyof Dictionary) || "Attiva il collegamento al registratore fiscale"}</div>
          <p className="mt-0.5 text-sm text-black">
            {t("settings_rt_enable_help" as keyof Dictionary) ||
              "Quando è attivo, la cassa emette il documento commerciale sul registratore invece dello scontrino di gestione."}
          </p>
        </div>
      </label>

      {/* Brand picker */}
      <div className="space-y-2">
        <span className="text-sm font-bold text-black">{t("settings_rt_brand" as keyof Dictionary) || "Marca del registratore"}</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {FISCAL_BRANDS.map((b) => (
            <button
              key={b.value}
              onClick={() => { setBrand(b.value); setTest(null); setSaved(false); }}
              className={`px-3 py-2.5 text-sm rounded-lg border-2 text-left transition-colors cursor-pointer hover:bg-[#c4956a]/10 ${brand === b.value ? "font-bold text-black" : "text-black"}`}
              style={{ borderColor: brand === b.value ? "#c4956a" : "#eaddcb", background: brand === b.value ? "rgba(196,149,106,0.12)" : undefined }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Address + options */}
      <div className="rounded-lg border-2 p-4 space-y-4" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-black flex items-center gap-1"><Plug className="w-4 h-4" /> {t("settings_rt_host" as keyof Dictionary) || "Indirizzo del registratore in rete"}</span>
          <input value={host} onChange={(e) => { setHost(e.target.value); setTest(null); setSaved(false); }} className={inputCls} style={inputStyle} placeholder={t("settings_rt_host_ph" as keyof Dictionary) || "es. 192.168.1.50"} autoComplete="off" />
          <span className="text-xs text-black flex items-center gap-1">
            <HelpCircle className="w-3.5 h-3.5 shrink-0" />
            {t("settings_rt_host_help" as keyof Dictionary) || "Non lo sai? Chiedilo a chi ti ha installato il registratore (CENTROCASSA): è l'indirizzo IP del device in rete."}
          </span>
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-black cursor-pointer">
            <input type="checkbox" checked={tls} onChange={(e) => { setTls(e.target.checked); setTest(null); }} className="w-4 h-4 accent-[#c4956a]" />
            {t("settings_rt_tls" as keyof Dictionary) || "Il registratore usa HTTPS"}
          </label>
          <label className="flex items-center gap-2 text-sm text-black cursor-pointer">
            <input type="checkbox" checked={lottery} onChange={(e) => setLottery(e.target.checked)} className="w-4 h-4 accent-[#c4956a]" />
            {t("settings_rt_lottery" as keyof Dictionary) || "Abilita lotteria degli scontrini"}
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runTest}
            disabled={busy || !host.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg border-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            style={{ borderColor: "#c4956a", color: "#8b6540" }}
          >
            {phase === "testing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
            {t("settings_rt_test" as keyof Dictionary) || "Prova connessione"}
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            {phase === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {t("settings_rt_save" as keyof Dictionary) || "Salva"}
          </button>
        </div>

        {test && (
          <div className={`flex items-start gap-2 text-sm rounded-lg p-3 ${test.ok ? "text-emerald-700" : "text-red-600"}`} style={{ background: test.ok ? "rgba(16,185,129,0.08)" : "rgba(220,38,38,0.06)" }}>
            {test.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{test.msg}</span>
          </div>
        )}
        {saved && !test && (
          <div className="flex items-start gap-2 text-sm rounded-lg p-3 text-emerald-700" style={{ background: "rgba(16,185,129,0.08)" }}>
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{t("settings_rt_saved" as keyof Dictionary) || "Impostazioni salvate"}</span>
          </div>
        )}
      </div>

      {/* VAT reparto mapping */}
      <div className="rounded-lg border-2 p-4 space-y-3" style={{ borderColor: "#eaddcb", background: "rgba(252,246,237,0.4)" }}>
        <div className="font-bold text-black">{t("settings_rt_reparto_title" as keyof Dictionary) || "Reparti IVA"}</div>
        <p className="text-sm text-black">
          {t("settings_rt_reparto_help" as keyof Dictionary) ||
            "Ogni aliquota IVA corrisponde a un reparto programmato sul registratore. I valori di default vanno bene per quasi tutti; cambiali solo se il tecnico ha programmato reparti diversi."}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {VAT_RATES.map((rate) => (
            <label key={rate} className="flex flex-col gap-1">
              <span className="text-xs font-bold text-black">IVA {rate}%</span>
              <input
                type="number"
                min={1}
                max={99}
                value={repartoMap[rate] ?? DEFAULT_VAT_REPARTO_MAP[rate] ?? ""}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  setRepartoMap((prev) => ({ ...prev, [rate]: Number.isFinite(n) ? n : 0 }));
                  setSaved(false);
                }}
                className="px-3 py-2 text-sm border-2 rounded-lg text-black w-full"
                style={inputStyle}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-black">
          {t("settings_rt_reparto_note" as keyof Dictionary) ||
            "Prerequisito: fatti confermare da CENTROCASSA che sul registratore i reparti abbiano le aliquote giuste (di solito servono 10% e 22%)."}
        </p>
      </div>
    </div>
  );
}
