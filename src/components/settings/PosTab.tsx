"use client";

import { useEffect, useMemo, useState } from "react";
import { Plug, CheckCircle2, XCircle, RefreshCw, Loader2, KeyRound, Store } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { getPosProvider } from "@/lib/pos/pos-provider";
import { Dictionary } from "@/lib/i18n/dictionaries/en";

// Settings → Cassa. The self-service POS connection the owner uses instead of us
// running a script: pick the till, paste the access token, test it, save it (the
// app then reads the real till), and sync on demand. Only Loyverse is live today;
// the other brands are shown but disabled with a "coming soon" note, matching the
// onboarding wizard. Secrets go to /api/pos/connect (encrypted server-side); they
// never touch tenants.settings.

const POS_OPTIONS: Array<{ id: string; label: string; live: boolean }> = [
  { id: "loyverse", label: "Loyverse", live: true },
  { id: "cassa_in_cloud", label: "Cassa in Cloud", live: false },
  { id: "tilby", label: "Tilby", live: false },
  { id: "ipratico", label: "iPratico", live: false },
  { id: "nempos", label: "NemPOS", live: false },
  { id: "deliverect", label: "Deliverect", live: false },
];

interface ConnRow {
  provider: string;
  active: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
}

type Phase = "idle" | "testing" | "saving" | "syncing";

export function PosTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant } = useTenant();
  const supabase = useMemo(() => createClient(), []);

  const activeProvider = getPosProvider(tenant?.settings);
  const [choice, setChoice] = useState<string>(activeProvider === "mock" ? "loyverse" : activeProvider);
  const [token, setToken] = useState("");
  const [storeId, setStoreId] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [conn, setConn] = useState<ConnRow | null>(null);

  // Load the existing connection row (status + last sync) for this tenant.
  const loadConn = async () => {
    if (!tenant?.id) return;
    const { data } = await supabase
      .from("pos_connections")
      .select("provider, active, last_sync_at, last_sync_status, last_error")
      .eq("tenant_id", tenant.id)
      .eq("active", true)
      .maybeSingle();
    setConn((data as ConnRow) || null);
    if (data?.provider) setChoice(data.provider);
  };

  useEffect(() => {
    loadConn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  const selected = POS_OPTIONS.find((o) => o.id === choice);
  const isLive = !!selected?.live;

  async function call(action: "test" | "save" | "sync") {
    if (!tenant?.id) return;
    setResult(null);
    setPhase(action === "test" ? "testing" : action === "save" ? "saving" : "syncing");
    try {
      const res = await fetch("/api/pos/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenant.id,
          action,
          ...(action !== "sync" ? { provider: choice, token: token.trim(), store_id: storeId.trim() || undefined } : {}),
        }),
      });
      const data = await res.json();
      if (action === "sync") {
        const r = data?.result;
        setResult({
          ok: !!data?.ok,
          msg: data?.ok
            ? (t("settings_pos_sync_ok" as keyof Dictionary) || "Sincronizzato")
                .replace("{n}", String(r?.upserted ?? 0))
            : data?.error || r?.error || (t("settings_pos_sync_err" as keyof Dictionary) || "Sincronizzazione non riuscita"),
        });
      } else {
        const test = data?.test;
        setResult({
          ok: !!data?.ok,
          msg: test?.detail || data?.error || (data?.ok ? "OK" : (t("settings_pos_test_err" as keyof Dictionary) || "Connessione non riuscita")),
        });
        if (action === "save" && data?.ok) {
          setToken("");
          await refreshActiveTenant();
          await loadConn();
        }
      }
    } catch (e: any) {
      setResult({ ok: false, msg: e?.message || "Errore" });
    } finally {
      setPhase("idle");
    }
  }

  const inputCls = "px-3 py-2 text-sm border-2 rounded-lg text-black w-full";
  const inputStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };
  const busy = phase !== "idle";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-black flex items-center gap-2">
          <Plug className="w-5 h-5" /> {t("settings_pos_title" as keyof Dictionary) || "Collega la cassa"}
        </h2>
        <p className="mt-1 text-sm text-black">
          {t("settings_pos_desc" as keyof Dictionary) ||
            "Collega il tuo registratore di cassa: incolla il token, prova la connessione e sincronizza. Da qui in poi il gestionale legge i dati reali della cassa e le modifiche (prezzi, giacenze, prodotti) tornano sulla cassa."}
        </p>
      </div>

      {/* Current connection status */}
      {conn && (
        <div className="rounded-lg border-2 p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
          <div className="flex items-center gap-2 text-sm">
            {conn.last_sync_status === "error" ? <XCircle className="w-5 h-5 text-red-600" /> : <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
            <div>
              <div className="font-bold text-black">
                {(t("settings_pos_connected" as keyof Dictionary) || "Collegato: {p}").replace("{p}", POS_OPTIONS.find((o) => o.id === conn.provider)?.label || conn.provider)}
              </div>
              <div className="text-xs text-black">
                {conn.last_sync_at
                  ? (t("settings_pos_last_sync" as keyof Dictionary) || "Ultima sincronizzazione: {d}").replace("{d}", new Date(conn.last_sync_at).toLocaleString())
                  : t("settings_pos_never_synced" as keyof Dictionary) || "Mai sincronizzato"}
                {conn.last_error ? ` · ${conn.last_error}` : ""}
              </div>
            </div>
          </div>
          <button
            onClick={() => call("sync")}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            {phase === "syncing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t("settings_pos_sync_now" as keyof Dictionary) || "Sincronizza ora"}
          </button>
        </div>
      )}

      {/* Provider picker */}
      <div className="space-y-2">
        <span className="text-sm font-bold text-black">{t("settings_pos_choose" as keyof Dictionary) || "Quale cassa usi?"}</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {POS_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => opt.live && setChoice(opt.id)}
              disabled={!opt.live}
              className={`px-3 py-2.5 text-sm rounded-lg border-2 text-left transition-colors ${choice === opt.id ? "font-bold text-black" : "text-black"} ${opt.live ? "cursor-pointer hover:bg-[#c4956a]/10" : "opacity-50 cursor-not-allowed"}`}
              style={{ borderColor: choice === opt.id ? "#c4956a" : "#eaddcb", background: choice === opt.id ? "rgba(196,149,106,0.12)" : undefined }}
            >
              {opt.label}
              {!opt.live && <span className="block text-[10px] text-black">{t("settings_pos_soon" as keyof Dictionary) || "presto"}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Token + store + actions */}
      {isLive ? (
        <div className="rounded-lg border-2 p-4 space-y-4" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-black flex items-center gap-1"><KeyRound className="w-4 h-4" /> {t("settings_pos_token" as keyof Dictionary) || "Token di accesso"}</span>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className={inputCls} style={inputStyle} placeholder={t("settings_pos_token_ph" as keyof Dictionary) || "Incolla qui il token della cassa"} autoComplete="off" />
            <span className="text-xs text-black">
              {t("settings_pos_token_help_loyverse" as keyof Dictionary) || "Loyverse: Back Office → Impostazioni → Token di accesso → Aggiungi. Si crea in un secondo."}
            </span>
          </label>
          <label className="flex flex-col gap-1 max-w-md">
            <span className="text-sm font-bold text-black flex items-center gap-1"><Store className="w-4 h-4" /> {t("settings_pos_store" as keyof Dictionary) || "ID negozio (opzionale)"}</span>
            <input value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputCls} style={inputStyle} placeholder={t("settings_pos_store_ph" as keyof Dictionary) || "Lascia vuoto per usare il negozio principale"} />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => call("test")}
              disabled={busy || !token.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg border-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              style={{ borderColor: "#c4956a", color: "#8b6540" }}
            >
              {phase === "testing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              {t("settings_pos_test" as keyof Dictionary) || "Prova connessione"}
            </button>
            <button
              onClick={() => call("save")}
              disabled={busy || !token.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              {phase === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {t("settings_pos_save" as keyof Dictionary) || "Salva e collega"}
            </button>
          </div>

          {result && (
            <div className={`flex items-start gap-2 text-sm rounded-lg p-3 ${result.ok ? "text-emerald-700" : "text-red-600"}`} style={{ background: result.ok ? "rgba(16,185,129,0.08)" : "rgba(220,38,38,0.06)" }}>
              {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{result.msg}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border-2 p-4 text-sm text-black" style={{ borderColor: "#eaddcb", background: "rgba(252,246,237,0.4)" }}>
          {t("settings_pos_not_live" as keyof Dictionary) ||
            "Questa cassa non è ancora collegabile in automatico. Per ora i dati restano demo; ti avvisiamo appena l'integrazione è pronta."}
        </div>
      )}
    </div>
  );
}
