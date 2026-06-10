"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { InfoHotspot } from "@/components/ui/InfoHotspot";

// Settings → Gestionale. Owner-set targets/budgets the food-cost and P&L screens
// read (food-cost target %, monthly labor budget) plus a quick "labor cost per
// day/shift" entry that writes labor_cost rows (the P&L's only manual input).
// Mirrors the instant-save idiom of FeaturesTab.
export function ManagementTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant } = useTenant();
  const supabase = createClient();

  const [targetPct, setTargetPct] = useState("30");
  const [laborBudget, setLaborBudget] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initedFor = useRef<string | null>(null);

  // labor entry
  const [workDate, setWorkDate] = useState("");
  const [shift, setShift] = useState<"lunch" | "dinner" | "all">("all");
  const [cost, setCost] = useState("");
  const [laborStatus, setLaborStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    refreshActiveTenant();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenant || initedFor.current === tenant.id) return;
    initedFor.current = tenant.id;
    const m = (tenant.settings as any)?.management || {};
    setTargetPct(String(m.food_cost_target_pct ?? 30));
    setLaborBudget(m.labor_budget_monthly != null ? String(m.labor_budget_monthly) : "");
  }, [tenant]);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const saveTargets = async () => {
    if (!tenant) return;
    setStatus("saving");
    // Empty/invalid target must fall back to the 30% default, never 0 — a 0%
    // target would flag every dish as over-budget on the Food cost screen.
    const rawPct = targetPct.trim();
    const parsedPct = rawPct === "" ? NaN : Number(rawPct.replace(",", "."));
    const pct = Number.isFinite(parsedPct) && parsedPct > 0 ? Math.min(parsedPct, 100) : 30;
    if (String(pct) !== targetPct) setTargetPct(String(pct)); // reflect the normalized value
    const budget = laborBudget.trim() === "" ? null : Number(laborBudget.replace(",", "."));
    const management = {
      ...((tenant.settings as any)?.management || {}),
      food_cost_target_pct: pct,
      labor_budget_monthly: budget != null && Number.isFinite(budget) && budget >= 0 ? budget : null,
    };
    const newSettings = { ...(tenant.settings || {}), management };
    const { error } = await supabase.from("tenants").update({ settings: newSettings }).eq("id", tenant.id);
    if (error) {
      setStatus("error");
      return;
    }
    setStatus("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setStatus("idle"), 2000);
    await refreshActiveTenant();
  };

  const saveLabor = async () => {
    if (!tenant || !workDate || cost.trim() === "") return;
    setLaborStatus("saving");
    const c = Number(cost.replace(",", "."));
    const { error } = await supabase
      .from("labor_cost")
      .upsert(
        { tenant_id: tenant.id, work_date: workDate, shift, cost: Number.isFinite(c) ? c : 0 },
        { onConflict: "tenant_id,work_date,shift" },
      );
    if (error) {
      setLaborStatus("error");
      return;
    }
    setLaborStatus("saved");
    setCost("");
    setTimeout(() => setLaborStatus("idle"), 2000);
  };

  const inputCls = "px-3 py-2 text-sm border-2 rounded-lg text-black";
  const inputStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-black">{t("settings_management_title" as keyof Dictionary) || "Controllo gestione"}</h2>
          <p className="mt-1 text-sm text-black">{t("settings_management_desc" as keyof Dictionary) || "Obiettivi e budget letti dalle schermate Food cost e Conto economico."}</p>
        </div>
        <div className="h-5 flex items-center" aria-live="polite">
          {status === "saving" && <span className="text-sm text-black">…</span>}
          {status === "saved" && <span className="text-sm text-green-600">{t("settings_saved" as keyof Dictionary) || "Salvato"}</span>}
          {status === "error" && <span className="text-sm text-red-600">{t("settings_save_error" as keyof Dictionary) || "Errore"}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg border-2" style={inputStyle}>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-black flex items-center gap-1.5">
            {t("settings_management_target" as keyof Dictionary) || "Target food cost %"}
            <InfoHotspot
              title={t("settings_management_target" as keyof Dictionary) || "Target food cost %"}
              body={t("settings_management_target_help" as keyof Dictionary) || "La percentuale massima del prezzo di un piatto che vuoi spendere in ingredienti. La schermata Food cost segna in rosso i piatti che la superano."}
              example={t("settings_management_target_example" as keyof Dictionary) || "Es: un piatto venduto a 12€ con 3,60€ di ingredienti ha un food cost del 30%. Con target 30%, sopra i 3,60€ il piatto va in rosso."}
            />
          </span>
          <input type="number" value={targetPct} onChange={(e) => setTargetPct(e.target.value)} onBlur={saveTargets} className={inputCls} style={inputStyle} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-black flex items-center gap-1.5">
            {t("settings_management_labor_budget" as keyof Dictionary) || "Budget personale (mensile)"}
            <InfoHotspot
              align="end"
              title={t("settings_management_labor_budget" as keyof Dictionary) || "Budget personale (mensile)"}
              body={t("settings_management_labor_budget_help" as keyof Dictionary) || "Quanto prevedi di spendere ogni mese per il personale (stipendi e contributi). Nel Conto economico il costo reale viene confrontato con questo tetto."}
              example={t("settings_management_labor_budget_example" as keyof Dictionary) || "Es: budget 5.000€. Se a fine mese il costo personale è 5.400€, la voce «Costo personale» diventa rossa: sei oltre budget di 400€."}
            />
          </span>
          <input type="number" value={laborBudget} onChange={(e) => setLaborBudget(e.target.value)} onBlur={saveTargets} placeholder="€" className={inputCls} style={inputStyle} />
        </label>
      </div>

      <div className="p-4 rounded-lg border-2 space-y-3" style={inputStyle}>
        <h3 className="text-sm font-bold text-black flex items-center gap-1.5">
          {t("settings_management_labor_entry" as keyof Dictionary) || "Costo personale per giorno/turno"}
          <InfoHotspot
            title={t("settings_management_labor_entry" as keyof Dictionary) || "Costo personale per giorno/turno"}
            body={t("settings_management_labor_entry_help" as keyof Dictionary) || "Registra quanto è costato il personale in un giorno e turno preciso. È l'unico dato che inserisci a mano: serve al Conto economico per il margine per turno."}
            example={t("settings_management_labor_entry_example" as keyof Dictionary) || "Es: 14/06 · Cena · 320€. Il sistema lo somma al food cost di quella sera e ti dice se la cena ha guadagnato o perso."}
          />
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-black">{t("settings_management_date" as keyof Dictionary) || "Data"}</span>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className={inputCls} style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-black">{t("settings_management_shift" as keyof Dictionary) || "Turno"}</span>
            <select value={shift} onChange={(e) => setShift(e.target.value as any)} className={inputCls + " cursor-pointer"} style={inputStyle}>
              <option value="all">{t("pl_all" as keyof Dictionary) || "Intera giornata"}</option>
              <option value="lunch">{t("pl_lunch" as keyof Dictionary) || "Pranzo"}</option>
              <option value="dinner">{t("pl_dinner" as keyof Dictionary) || "Cena"}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-black">{t("settings_management_cost" as keyof Dictionary) || "Costo €"}</span>
            <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} className={inputCls} style={inputStyle} />
          </label>
          <button
            onClick={saveLabor}
            disabled={!workDate || cost.trim() === ""}
            className="px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            {t("save" as keyof Dictionary) || "Salva"}
          </button>
          <div className="h-9 flex items-center" aria-live="polite">
            {laborStatus === "saved" && <span className="text-sm text-green-600">{t("settings_saved" as keyof Dictionary) || "Salvato"}</span>}
            {laborStatus === "error" && <span className="text-sm text-red-600">{t("settings_save_error" as keyof Dictionary) || "Errore"}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
