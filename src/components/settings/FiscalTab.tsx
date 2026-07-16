"use client";

import { useState, useEffect, useCallback } from "react";
import { Landmark, Loader2, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";

// Settings → Fiscale (Spain / VERI*FACTU).
//
// The screen exists to make ONE question impossible to get wrong: WHO ISSUES THE
// INVOICES for this NIF? There are exactly two lawful answers and one unlawful one,
// and the unlawful one is the status quo of most restaurants, so it is shown as a
// refusal rather than hidden:
//
//   • La nostra cassa  → we are the SIF. Every ticket is chained and filed.
//   • Un POS esterno   → their own till is the compliant SIF. Our cassa REFUSES to
//                        take money (it would be issuing invoices from a system that
//                        doesn't register them), and we import their sales only for
//                        analytics. Critically: we file NOTHING — otherwise AEAT
//                        gets the same sale twice, once from each system.
//   • Nessuno dei due  → non-compliant. The till says no, and says why.
//
// There is deliberately no "he bills from any POS and we file it for him" option:
// the register must be produced by the system that ISSUES, at the moment it issues.
// That combination doesn't exist in law, so it doesn't exist here.

const cardStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };
const softCardStyle = { borderColor: "#eaddcb", background: "rgba(255,255,255,0.5)" };

type SifMode = "native" | "external" | "none";

interface Obligado {
  id: string;
  nif: string;
  razon_social: string;
  domicilio: Record<string, string>;
  regimen: string;
  sif_mode: SifMode;
  mandate_signed: boolean;
  transport_linked: boolean;
}

interface Payload {
  obligado: Obligado | null;
  serie: string;
  chain: { records: number; pending: number };
  regimes: Array<{ key: string; label: string; impuesto: string | null; rates: number[] }>;
}

export function FiscalTab() {
  const { activeTenant } = useTenant();
  const { t } = useLanguage();
  const tenantId = activeTenant?.id;

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nif, setNif] = useState("");
  const [razon, setRazon] = useState("");
  const [via, setVia] = useState("");
  const [cp, setCp] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [regimen, setRegimen] = useState("iva_peninsular");
  const [sifMode, setSifMode] = useState<SifMode>("none");
  const [serie, setSerie] = useState("");

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/fiscal/obligado?tenant_id=${tenantId}`);
      const json: Payload = await res.json();
      setData(json);
      if (json.obligado) {
        setNif(json.obligado.nif);
        setRazon(json.obligado.razon_social || "");
        setVia(json.obligado.domicilio?.via || "");
        setCp(json.obligado.domicilio?.cp || "");
        setMunicipio(json.obligado.domicilio?.municipio || "");
        setRegimen(json.obligado.regimen);
        setSifMode(json.obligado.sif_mode);
      }
      setSerie(json.serie || "");
    } catch {
      setError(t("fiscal_load_error"));
    } finally {
      setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!tenantId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/fiscal/obligado", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          nif,
          razon_social: razon,
          domicilio: { via, cp, municipio, pais: "ES" },
          regimen,
          sif_mode: sifMode,
          serie,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.detail || json?.error || "error");
      setSaved(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-black">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  const pending = data?.chain.pending ?? 0;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ---- state of the chain ------------------------------------------- */}
      <div className="rounded-xl border p-5" style={cardStyle}>
        <div className="flex items-center gap-2 mb-3">
          <Landmark className="w-5 h-5 text-black" />
          <h2 className="text-lg font-bold text-black">{t("fiscal_title")}</h2>
        </div>
        <p className="text-sm text-black">{t("fiscal_intro")}</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3" style={softCardStyle}>
            <div className="text-2xl font-bold text-black">{data?.chain.records ?? 0}</div>
            <div className="text-sm text-black">{t("fiscal_chain_records")}</div>
          </div>
          <div className="rounded-lg border p-3" style={softCardStyle}>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-black">{pending}</span>
              {pending > 0 && <AlertTriangle className="w-4 h-4 text-black" />}
            </div>
            {/* Showing this is a legal duty, not a nicety: the venue must be able to
                see that it still owes the Agencia Tributaria N records. */}
            <div className="text-sm text-black">{t("fiscal_chain_pending")}</div>
          </div>
        </div>
      </div>

      {/* ---- WHO ISSUES — the question the whole module exists for ---------- */}
      <div className="rounded-xl border p-5" style={cardStyle}>
        <h3 className="font-bold text-black mb-1">{t("fiscal_mode_title")}</h3>
        <p className="text-sm text-black mb-4">{t("fiscal_mode_hint")}</p>

        {(["native", "external", "none"] as SifMode[]).map((m) => (
          <label
            key={m}
            className="flex items-start gap-3 rounded-lg border p-3 mb-2 cursor-pointer"
            style={softCardStyle}
          >
            <input
              type="radio"
              name="sif_mode"
              checked={sifMode === m}
              onChange={() => setSifMode(m)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium text-black">{t(`fiscal_mode_${m}` as never)}</span>
              <span className="block text-sm text-black">{t(`fiscal_mode_${m}_hint` as never)}</span>
            </span>
          </label>
        ))}

        {sifMode === "none" && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border p-3" style={softCardStyle}>
            <AlertTriangle className="w-4 h-4 mt-0.5 text-black shrink-0" />
            <span className="text-sm text-black">{t("fiscal_mode_none_warning")}</span>
          </div>
        )}
      </div>

      {/* ---- fiscal identity ------------------------------------------------ */}
      <div className="rounded-xl border p-5 space-y-3" style={cardStyle}>
        <h3 className="font-bold text-black">{t("fiscal_identity_title")}</h3>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-black">{t("fiscal_nif")}</span>
            <input
              value={nif}
              onChange={(e) => setNif(e.target.value.toUpperCase())}
              placeholder="B12345678"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-black"
              style={{ borderColor: "#eaddcb" }}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-black">{t("fiscal_razon_social")}</span>
            <input
              value={razon}
              onChange={(e) => setRazon(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-black"
              style={{ borderColor: "#eaddcb" }}
            />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label className="block col-span-2">
            <span className="text-sm font-medium text-black">{t("fiscal_address")}</span>
            <input
              value={via}
              onChange={(e) => setVia(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-black"
              style={{ borderColor: "#eaddcb" }}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-black">{t("fiscal_cp")}</span>
            <input
              value={cp}
              onChange={(e) => setCp(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-black"
              style={{ borderColor: "#eaddcb" }}
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-black">{t("fiscal_municipio")}</span>
          <input
            value={municipio}
            onChange={(e) => setMunicipio(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-black"
            style={{ borderColor: "#eaddcb" }}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-black">{t("fiscal_regime")}</span>
            {/* Canarias is IGIC, not VAT — a different tax with different rates and a
                different AEAT code. It is picked explicitly, never inferred from "ES". */}
            <select
              value={regimen}
              onChange={(e) => setRegimen(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-black"
              style={{ borderColor: "#eaddcb" }}
            >
              {(data?.regimes || []).map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-black">{t("fiscal_serie")}</span>
            <input
              value={serie}
              onChange={(e) => setSerie(e.target.value)}
              placeholder="A-"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-black"
              style={{ borderColor: "#eaddcb" }}
            />
            {/* Only matters when two venues share one NIF: they share one chain, so
                their invoice numbers must not collide inside it. */}
            <span className="text-sm text-black">{t("fiscal_serie_hint")}</span>
          </label>
        </div>
      </div>

      {/* ---- the mandate ---------------------------------------------------- */}
      <div className="rounded-xl border p-5" style={cardStyle}>
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-5 h-5 text-black" />
          <h3 className="font-bold text-black">{t("fiscal_mandate_title")}</h3>
        </div>
        {/* AEAT does not accept a ticked box in the terms of service as authorization
            to file on someone's behalf: it takes a qualified electronic (or wet)
            signature, and the evidence has to be kept. So this is a status, not a
            checkbox — the signing happens with the transport provider. */}
        <p className="text-sm text-black">{t("fiscal_mandate_hint")}</p>
        <div className="mt-3 flex items-center gap-2 text-sm text-black">
          {data?.obligado?.mandate_signed ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              {t("fiscal_mandate_signed")}
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4" />
              {t("fiscal_mandate_missing")}
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border p-3 text-sm text-black" style={softCardStyle}>
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !nif}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-white disabled:opacity-50 cursor-pointer"
          style={{ background: "#c4956a" }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {t("save")}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm text-black">
            <CheckCircle2 className="w-4 h-4" />
            {t("settings_saved")}
          </span>
        )}
      </div>
    </div>
  );
}
