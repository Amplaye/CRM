"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import { Dictionary } from "@/lib/i18n/dictionaries/en";

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
    const pct = Number(targetPct.replace(",", "."));
    const budget = laborBudget.trim() === "" ? null : Number(laborBudget.replace(",", "."));
    const management = {
      ...((tenant.settings as any)?.management || {}),
      food_cost_target_pct: Number.isFinite(pct) ? pct : 30,
      labor_budget_monthly: budget != null && Number.isFinite(budget) ? budget : null,
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
          <p className="mt-1 text-sm text-black/70">{t("settings_management_desc" as keyof Dictionary) || "Obiettivi e budget letti dalle schermate Food cost e Conto economico."}</p>
        </div>
        <div className="h-5 flex items-center" aria-live="polite">
          {status === "saving" && <span className="text-sm text-black/40">…</span>}
          {status === "saved" && <span className="text-sm text-green-600">{t("settings_saved" as keyof Dictionary) || "Salvato"}</span>}
          {status === "error" && <span className="text-sm text-red-600">{t("settings_save_error" as keyof Dictionary) || "Errore"}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg border-2" style={inputStyle}>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-black">{t("settings_management_target" as keyof Dictionary) || "Target food cost %"}</span>
          <input type="number" value={targetPct} onChange={(e) => setTargetPct(e.target.value)} onBlur={saveTargets} className={inputCls} style={inputStyle} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-black">{t("settings_management_labor_budget" as keyof Dictionary) || "Budget personale (mensile)"}</span>
          <input type="number" value={laborBudget} onChange={(e) => setLaborBudget(e.target.value)} onBlur={saveTargets} placeholder="€" className={inputCls} style={inputStyle} />
        </label>
      </div>

      <div className="p-4 rounded-lg border-2 space-y-3" style={inputStyle}>
        <h3 className="text-sm font-bold text-black">{t("settings_management_labor_entry" as keyof Dictionary) || "Costo personale per giorno/turno"}</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-black/70">{t("settings_management_date" as keyof Dictionary) || "Data"}</span>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className={inputCls} style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-black/70">{t("settings_management_shift" as keyof Dictionary) || "Turno"}</span>
            <select value={shift} onChange={(e) => setShift(e.target.value as any)} className={inputCls + " cursor-pointer"} style={inputStyle}>
              <option value="all">{t("pl_all" as keyof Dictionary) || "Intera giornata"}</option>
              <option value="lunch">{t("pl_lunch" as keyof Dictionary) || "Pranzo"}</option>
              <option value="dinner">{t("pl_dinner" as keyof Dictionary) || "Cena"}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-black/70">{t("settings_management_cost" as keyof Dictionary) || "Costo €"}</span>
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
