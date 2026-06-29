"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Bot, AlertTriangle, MessageSquare, Calendar,
  Phone, TrendingUp, UserX, Zap, Clock, Lightbulb, DollarSign, ShieldCheck, Eye,
  CheckCircle2, XCircle, AlertCircle, Package, LogIn, Sliders, StickyNote, Trash2, Save, CreditCard, ExternalLink,
} from "lucide-react";
import { TENANT_STATUSES, type TenantStatus } from "@/lib/tenants/status";
import { getRawFeatures, type TenantFeatures } from "@/lib/types/tenant-settings";
import { entitlementFor, hasActivePlan } from "@/lib/billing/entitlements";

// All per-tenant feature flags the admin can toggle (Italian admin copy). The
// management module shows its entitlement reason (manual / paid / grace) inline.
const FEATURE_TOGGLES: Array<{ flag: keyof TenantFeatures; title: string; hint: string }> = [
  { flag: "management_enabled", title: "Gestionale — Inventario, Food Cost, P&L", hint: "Pagine di controllo gestione (vendite POS, food cost, conto economico, inventario, fatture)." },
  { flag: "waitlist_enabled", title: "Lista d'attesa", hint: "Raccoglie i clienti quando è pieno e avvisa al liberarsi di un tavolo." },
  { flag: "double_shift", title: "Doppio turno", hint: "Aperto sia a pranzo che a cena." },
  { flag: "multi_room", title: "Più sale", hint: "Sale / aree separate nella mappa tavoli." },
  { flag: "multi_language", title: "Multilingua", hint: "Il bot risponde ai clienti in più lingue." },
  { flag: "events_enabled", title: "Eventi / gruppi", hint: "Serate speciali, eventi privati, grandi gruppi." },
  { flag: "terrace", title: "Terrazza", hint: "Posti all'aperto." },
  { flag: "pet_friendly", title: "Pet friendly", hint: "Animali ammessi." },
  { flag: "reminders_enabled", title: "Promemoria", hint: "Promemoria prenotazione il giorno prima (template WhatsApp)." },
  { flag: "followup_enabled", title: "Follow-up post-visita", hint: "Ringraziamento / richiesta recensione dopo la visita (template marketing)." },
  { flag: "commercial_info_enabled", title: "Info commerciali", hint: "Il bot risponde su listini, menù fissi, buffet dalle voci KB 'commerciale'." },
];

// Paid services the admin can manually force on/off per tenant (payment disputes).
// `key` is "plan" (core-CRM access) or an add-on id. The override lives in
// settings.manual_entitlements and WINS over billing.
const ENTITLEMENT_OVERRIDES: Array<{ key: string; title: string; hint: string }> = [
  { key: "plan", title: "Accesso CRM (piano)", hint: "Prenotazioni, sala, ospiti, conversazioni, analisi — l'intero CRM." },
  { key: "smart_inventory", title: "Gestionale", hint: "Inventario, food cost, conto economico, POS, fatture." },
  { key: "voice_vapi", title: "Voce — Vapi", hint: "Segretaria vocale AI (tier base)." },
  { key: "voice_retell", title: "Voce — Retell", hint: "Segretaria vocale AI (tier premium)." },
  { key: "website_design", title: "Sito web", hint: "Pacchetto realizzazione sito." },
];

const POS_PROVIDERS = ["mock", "cassa_in_cloud", "tilby", "ipratico", "nempos", "deliverect", "loyverse"];

interface ClientNote { id: string; content: string; author: string; created_at: string; }

const STATUS_BADGE: Record<TenantStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  trial: "bg-blue-50 text-blue-700 border-blue-200",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  suspended: "bg-red-50 text-red-700 border-red-200",
  archived: "bg-zinc-100 text-black border-zinc-300",
};

interface HealthWorkflow {
  func: string;
  name: string;
  id?: string;
  state: "active" | "covered" | "optional" | "down";
  coveredBy?: string;
}
interface TenantHealth {
  overall: "ok" | "warn" | "fail";
  checks: Array<{
    key: string;
    label: string;
    state: "ok" | "warn" | "fail";
    detail: string;
    workflows?: HealthWorkflow[];
  }>;
}

interface TenantDetail {
  tenant: { id: string; name: string; status: TenantStatus; created_at: string; archived_at?: string | null; purge_after?: string | null; settings?: Record<string, any> | null };
  kpis: {
    aiRevenue7: number;
    aiRevenue30: number;
    aiPct: number;
    totalBookings30: number;
    totalBookings7: number;
    aiCount: number;
    noShows: number;
    escalations: number;
    escalationRate: number;
  };
  recentReservations: any[];
  recentConversations: any[];
  recentIncidents: any[];
  recentLogs: any[];
}

const sourceIcon = (s: string) => {
  switch (s) {
    case "ai_chat": return <MessageSquare className="w-3.5 h-3.5 text-[#c4956a]" />;
    case "ai_voice": return <Phone className="w-3.5 h-3.5 text-indigo-500" />;
    default: return <Calendar className="w-3.5 h-3.5 text-black" />;
  }
};

export default function TenantDetailPage() {
  const { globalRole, switchTenant } = useTenant();
  const params = useParams();
  const tenantId = params?.id as string;
  const [data, setData] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<any[]>([]);
  const [health, setHealth] = useState<TenantHealth | null>(null);
  const [waSetup, setWaSetup] = useState<{
    setup: { phone_number_usage: string; setup_status: string; last_error: string | null } | null;
    connection: { phone_number_id: string | null; waba_id: string | null; connection_status: string; last_error: string | null } | null;
  } | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [danger, setDanger] = useState<null | "archive" | "purge">(null);
  const [confirmText, setConfirmText] = useState("");
  const [working, setWorking] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [featureSaving, setFeatureSaving] = useState<keyof TenantFeatures | null>(null);
  const [ovSaving, setOvSaving] = useState<string | null>(null);
  // Settings editor (nested settings the admin can override)
  const [sForm, setSForm] = useState<{
    timezone: string; crm_locale: string; voiceProvider: string; posProvider: string;
    botPaused: boolean; botPausedMessage: string;
    foodCostTargetPct: string; laborBudgetMonthly: string; costMethod: string;
  } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  // Client notes (folded in from the old /admin/clients page)
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [notesBusy, setNotesBusy] = useState(false);

  // Flip a single feature flag for this tenant (admin-only). Flags live in
  // settings.features (the nested object getFeatures() reads + the sidebar gates
  // on) — NOT at settings root. We merge the changed key into the full features
  // object, mirroring how Settings → Funzionalità persists, so reading and
  // writing hit the same place. The PATCH route merges this into tenants.settings.
  const toggleFeature = async (key: keyof TenantFeatures, value: boolean) => {
    if (!tenantId) return;
    setFeatureSaving(key);
    const currentSettings = data?.tenant.settings || {};
    // Merge onto the RAW flags, not the billing-derived ones: management_enabled
    // here is the MANUAL OVERRIDE bit. Using getFeatures() would persist the
    // add-on-derived `true` back into the raw flag when toggling anything else.
    const nextFeatures = { ...getRawFeatures(currentSettings as any), [key]: value };
    try {
      const res = await fetch("/api/admin/tenant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, settings: { features: nextFeatures } }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setData((prev) =>
        prev ? { ...prev, tenant: { ...prev.tenant, settings: { ...(prev.tenant.settings || {}), features: nextFeatures } } } : prev
      );
    } catch (err) {
      console.error(err);
    }
    setFeatureSaving(null);
  };

  // Set a manual entitlement override for this tenant. `value`: true = force on,
  // false = force off, null = auto (remove the override → follow billing). Writes
  // the WHOLE manual_entitlements object (the PATCH route merges shallowly at the
  // top level of settings, so nested objects must be sent complete).
  const setOverride = async (key: string, value: boolean | null) => {
    if (!tenantId) return;
    setOvSaving(key);
    const cur = ((data?.tenant.settings as any)?.manual_entitlements || {}) as { plan?: boolean; addons?: Record<string, boolean> };
    const next: { plan?: boolean; addons?: Record<string, boolean> } = {
      ...(cur.plan !== undefined ? { plan: cur.plan } : {}),
      addons: { ...(cur.addons || {}) },
    };
    if (key === "plan") {
      if (value === null) delete next.plan; else next.plan = value;
    } else {
      if (value === null) delete next.addons![key]; else next.addons![key] = value;
    }
    if (next.addons && Object.keys(next.addons).length === 0) delete next.addons;
    try {
      const res = await fetch("/api/admin/tenant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, settings: { manual_entitlements: next } }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setData((prev) =>
        prev ? { ...prev, tenant: { ...prev.tenant, settings: { ...(prev.tenant.settings || {}), manual_entitlements: next } } } : prev
      );
    } catch (err) {
      console.error(err);
    }
    setOvSaving(null);
  };

  const runArchive = async () => {
    setWorking(true); setActionMsg(null);
    try {
      const res = await fetch("/api/admin/tenant/archive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, confirm_name: confirmText }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setDownloadUrl(j.download_url || null);
      setActionMsg(`Archiviato. Cancellazione definitiva il ${new Date(j.purge_after).toLocaleDateString()}.`);
      setData((p) => (p ? { ...p, tenant: { ...p.tenant, status: "archived" } } : p));
      setDanger(null); setConfirmText("");
    } catch (e: any) { setActionMsg(e.message); }
    setWorking(false);
  };
  const runPurge = async () => {
    setWorking(true); setActionMsg(null);
    try {
      const res = await fetch("/api/admin/tenant/purge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, confirm_name: confirmText }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setActionMsg("Cliente cancellato definitivamente.");
      setDanger(null); setConfirmText("");
      setTimeout(() => { window.location.href = "/admin"; }, 1200);
    } catch (e: any) { setActionMsg(e.message); }
    setWorking(false);
  };
  const runRestore = async () => {
    setWorking(true); setActionMsg(null);
    try {
      const res = await fetch("/api/admin/tenant/restore", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setActionMsg("Ripristinato.");
      setData((p) => (p ? { ...p, tenant: { ...p.tenant, status: j.status } } : p));
    } catch (e: any) { setActionMsg(e.message); }
    setWorking(false);
  };

  const changeStatus = async (status: TenantStatus) => {
    if (!tenantId) return;
    setStatusSaving(true);
    try {
      const res = await fetch("/api/admin/tenant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setData((prev) => (prev ? { ...prev, tenant: { ...prev.tenant, status } } : prev));
    } catch (err) {
      console.error(err);
    }
    setStatusSaving(false);
  };

  useEffect(() => {
    if (!tenantId) return;
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const [detailRes, insightRes, healthRes, waRes] = await Promise.all([
          fetch(`/api/admin/tenant?id=${tenantId}`),
          fetch(`/api/insights?tenant_id=${tenantId}`),
          fetch(`/api/admin/tenant/health?id=${tenantId}`),
          fetch(`/api/whatsapp/setup?tenant_id=${tenantId}`),
        ]);
        const json = await detailRes.json();
        if (json.error) throw new Error(json.error);
        setData(json);
        const insightData = await insightRes.json();
        setInsights(insightData.all_insights || []);
        try {
          const h = await healthRes.json();
          if (!h.error) setHealth(h);
        } catch { /* health is best-effort; never blocks the page */ }
        try {
          const w = await waRes.json();
          if (w?.ok) setWaSetup({ setup: w.setup, connection: w.connection });
        } catch { /* WhatsApp setup is best-effort */ }
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    fetchDetail();
  }, [tenantId]);

  // Initialize the settings-editor form once, from the loaded tenant settings.
  useEffect(() => {
    if (!data?.tenant || sForm) return;
    const s = (data.tenant.settings || {}) as any;
    setSForm({
      timezone: s.timezone || "",
      crm_locale: s.crm_locale || "",
      voiceProvider: s.voice?.provider || "vapi",
      posProvider: s.pos?.provider || "mock",
      botPaused: !!s.bot_config?.bot_paused,
      botPausedMessage: s.bot_config?.bot_paused_message || "",
      foodCostTargetPct: s.management?.food_cost_target_pct != null ? String(s.management.food_cost_target_pct) : "",
      laborBudgetMonthly: s.management?.labor_budget_monthly != null ? String(s.management.labor_budget_monthly) : "",
      costMethod: s.management?.cost_method || "last",
    });
  }, [data?.tenant, sForm]);

  // Load client notes for this tenant.
  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/admin/client-notes?tenant_id=${tenantId}`)
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((j) => setNotes(j.notes || []))
      .catch(() => {});
  }, [tenantId]);

  // Enter the CRM AS this tenant (sets the impersonation cookie, then reloads).
  const enterAsTenant = () => { void switchTenant(tenantId); };

  // Save the nested settings. CRITICAL: the PATCH route shallow-merges at the top
  // level of `settings`, so each sub-object is read-modify-written (spread the
  // existing value) or sibling keys (e.g. bot_config thresholds) would be lost.
  const saveSettings = async () => {
    if (!tenantId || !sForm || !data) return;
    setSavingSettings(true); setSettingsMsg(null);
    const s = (data.tenant.settings || {}) as any;
    const settings: Record<string, any> = {
      timezone: sForm.timezone || undefined,
      crm_locale: sForm.crm_locale || undefined,
      voice: { ...(s.voice || {}), provider: sForm.voiceProvider },
      pos: { ...(s.pos || {}), provider: sForm.posProvider },
      bot_config: { ...(s.bot_config || {}), bot_paused: sForm.botPaused, bot_paused_message: sForm.botPausedMessage || undefined },
      management: {
        ...(s.management || {}),
        food_cost_target_pct: sForm.foodCostTargetPct === "" ? undefined : Number(sForm.foodCostTargetPct),
        labor_budget_monthly: sForm.laborBudgetMonthly === "" ? undefined : Number(sForm.laborBudgetMonthly),
        cost_method: sForm.costMethod,
      },
    };
    try {
      const res = await fetch("/api/admin/tenant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, settings }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setData((prev) => (prev ? { ...prev, tenant: { ...prev.tenant, settings: j.settings || { ...s, ...settings } } } : prev));
      setSettingsMsg("Salvato");
    } catch (e: any) { setSettingsMsg(e.message); }
    setSavingSettings(false);
  };

  const addNote = async () => {
    if (!tenantId || !newNote.trim()) return;
    setNotesBusy(true);
    try {
      const res = await fetch("/api/admin/client-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, content: newNote.trim() }),
      });
      const j = await res.json();
      if (res.ok && j.note) { setNotes((prev) => [j.note, ...prev]); setNewNote(""); }
    } catch { /* ignore */ }
    setNotesBusy(false);
  };

  const deleteNote = async (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await fetch("/api/admin/client-notes", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    }).catch(() => {});
  };

  if (globalRole !== "platform_admin") {
    return <div className="p-8 text-center text-black">Unauthorized</div>;
  }

  const cardStyle = { background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" };

  if (loading) {
    return <div className="p-12 text-center text-black animate-pulse">Loading tenant details...</div>;
  }

  if (!data) {
    return <div className="p-12 text-center text-black">Tenant not found</div>;
  }

  const { tenant, kpis, recentReservations, recentConversations, recentIncidents, recentLogs } = data;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin" className="p-2 hover:bg-[#c4956a]/10 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4 text-black" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-black">{tenant.name}</h1>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGE[tenant.status] || STATUS_BADGE.pending}`}>
              {tenant.status}
            </span>
          </div>
          <p className="text-xs text-black">Tenant since {new Date(tenant.created_at).toLocaleDateString()}</p>
        </div>
        {/* Lifecycle control: only trial/active receive AI traffic. */}
        <div className="flex items-center gap-2">
          {tenant.status !== "archived" && (
            <button
              onClick={enterAsTenant}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#c4956a] text-white text-xs font-bold hover:bg-[#8b6540] transition-colors"
              title="Entra nel CRM operando come questo ristorante"
            >
              <LogIn className="w-3.5 h-3.5" /> Entra come ristorante
            </button>
          )}
          <label className="text-[10px] text-black uppercase tracking-wider hidden sm:block">Status</label>
          <select
            value={tenant.status}
            disabled={statusSaving || tenant.status === "archived"}
            onChange={(e) => changeStatus(e.target.value as TenantStatus)}
            className="text-xs border-2 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#c4956a] disabled:opacity-50"
            style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
          >
            {TENANT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Activation health — the green/yellow/red light that tells you, at a
          glance, whether this tenant actually provisioned correctly (the
          chef-oraz incident showed "completed" while half-broken). */}
      {health && (
        <div
          className="rounded-xl p-4 border-2"
          style={{
            background:
              health.overall === "ok" ? "rgba(16,185,129,0.06)"
              : health.overall === "warn" ? "rgba(234,179,8,0.07)"
              : "rgba(239,68,68,0.07)",
            borderColor:
              health.overall === "ok" ? "#10b981"
              : health.overall === "warn" ? "#eab308"
              : "#ef4444",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            {health.overall === "ok" ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              : health.overall === "warn" ? <AlertCircle className="w-5 h-5 text-yellow-600" />
              : <XCircle className="w-5 h-5 text-red-600" />}
            <h2 className="text-sm font-bold text-black">
              {health.overall === "ok" ? "Attivazione completa — il cliente funziona"
                : health.overall === "warn" ? "Attivo, ma con avvisi da controllare"
                : "Attivazione INCOMPLETA — il bot non funziona del tutto"}
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {health.checks.map((c) => (
              <div key={c.key} className="flex items-start gap-2 text-xs">
                {c.state === "ok" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  : c.state === "warn" ? <AlertCircle className="w-3.5 h-3.5 text-yellow-600 mt-0.5 shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />}
                <span className="text-black">
                  <span className="font-medium">{c.label}:</span> {c.detail}
                </span>
              </div>
            ))}
          </div>

          {/* Verità viva: the n8n check carries the per-workflow breakdown straight
              from n8n. Listing each workflow with its live state is what removes
              the "10/14" guesswork — the admin shows exactly what runs, what a
              shared engine covers, and what (if anything) is genuinely down. */}
          {(() => {
            const n8n = health.checks.find((c) => c.key === "n8n");
            if (!n8n?.workflows?.length) return null;
            const order = { down: 0, active: 1, covered: 2, optional: 3 } as const;
            const sorted = [...n8n.workflows].sort((a, b) => order[a.state] - order[b.state]);
            const dot = (st: HealthWorkflow["state"]) =>
              st === "active" ? "bg-emerald-500"
              : st === "covered" ? "bg-sky-400"
              : st === "optional" ? "bg-zinc-300"
              : "bg-red-500";
            const label = (w: HealthWorkflow) =>
              w.state === "active" ? "attivo"
              : w.state === "covered" ? `coperto da ${w.coveredBy || "motore unico"}`
              : w.state === "optional" ? "opzionale — spento"
              : "SPENTO (core)";
            return (
              <details className="mt-3 pt-3 border-t border-black/10">
                <summary className="text-[11px] font-medium text-black cursor-pointer select-none">
                  Workflow n8n in tempo reale ({n8n.workflows.length})
                </summary>
                <div className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1">
                  {sorted.map((w) => (
                    <div key={w.name} className="flex items-center gap-2 text-[11px]">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot(w.state)}`} />
                      <span className="text-black truncate" title={w.name}>
                        {w.name.replace(/^\[[^\]]*\]\s*/, "")}
                      </span>
                      <span className={`ml-auto shrink-0 ${w.state === "down" ? "text-red-600 font-semibold" : "text-black/50"}`}>
                        {label(w)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            );
          })()}
          {health.overall === "fail" && (
            <p className="text-[11px] text-black mt-3 pt-3 border-t border-black/10">
              Per riparare: riapri l&apos;onboarding di questo cliente e premi invia — il provisioning si completa da dove si era interrotto, senza duplicati.
            </p>
          )}
        </div>
      )}

      {/* WhatsApp — stato della connessione Meta Embedded Signup di questo cliente.
          Mostra a colpo d'occhio se il numero è collegato, in corso o da seguire a
          mano (test WABA / business non verificato). Sola lettura: l'override
          manuale del concierge passa da /api/admin/whatsapp/manual. */}
      {(() => {
        const conn = waSetup?.connection;
        const st = waSetup?.setup;
        const connected = conn?.connection_status === "connected" && !!conn?.phone_number_id;
        const failed = st?.setup_status === "failed_needs_manual_help" || conn?.connection_status === "error";
        const started = !!st && st.setup_status !== "not_started";
        const color = connected ? "#10b981" : failed ? "#ef4444" : started ? "#eab308" : "#a8a29e";
        const label = connected
          ? "WhatsApp collegato — invia dal numero del cliente"
          : failed
            ? "WhatsApp da seguire a mano — onboarding bloccato"
            : started
              ? "WhatsApp in corso — collegamento non ancora completato"
              : "WhatsApp non collegato";
        return (
          <div className="rounded-xl p-4 border-2" style={{ background: `${color}11`, borderColor: color }}>
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-5 h-5" style={{ color }} />
              <h2 className="text-sm font-bold text-black">{label}</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-black">
              <div><span className="font-medium">Stato connessione:</span> {conn?.connection_status || "—"}</div>
              <div><span className="font-medium">Stato onboarding:</span> {st?.setup_status || "not_started"}</div>
              <div><span className="font-medium">phone_number_id:</span> <span className="font-mono">{conn?.phone_number_id || "—"}</span></div>
              <div><span className="font-medium">waba_id:</span> <span className="font-mono">{conn?.waba_id || "—"}</span></div>
              {st?.phone_number_usage && st.phone_number_usage !== "unknown" && (
                <div><span className="font-medium">Numero:</span> {st.phone_number_usage}</div>
              )}
            </div>
            {(conn?.last_error || st?.last_error) && (
              <p className="text-[11px] text-red-600 mt-2 pt-2 border-t border-black/10">
                {conn?.last_error || st?.last_error}
              </p>
            )}
          </div>
        );
      })()}

      {/* Funzionalità (feature flags) — admin attiva/disattiva moduli per cliente.
          Il modulo Gestionale (POS, food cost, P&L, inventario) è opt-in: finché è
          spento, il ristorante non vede le pagine Food Cost / PL / Inventario. */}
      {(() => {
        // RAW flags: the management toggle shows/sets the MANUAL OVERRIDE bit, not
        // the paid-add-on-derived value, so the admin sees the true state of the
        // switch they control (a paying tenant has access regardless of this).
        const features = getRawFeatures(tenant.settings as any);
        const FeatureToggle = ({
          flag, icon, title, hint, badge,
        }: { flag: keyof TenantFeatures; icon: React.ReactNode; title: string; hint: string; badge?: React.ReactNode }) => {
          const on = features[flag];
          const saving = featureSaving === flag;
          return (
            <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.06)" }}>
              <div className="mt-0.5">{icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-xs font-medium text-black">{title}</p>
                  {badge}
                </div>
                <p className="text-[10px] text-black mt-0.5">{hint}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                disabled={saving}
                onClick={() => toggleFeature(flag, !on)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  on ? "bg-emerald-500" : "bg-zinc-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    on ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          );
        };
        return (
          <div className="rounded-xl border-2 p-4" style={cardStyle}>
            <div className="flex items-center gap-2 mb-3">
              <Package className="w-4 h-4 text-[#c4956a]" />
              <h3 className="text-xs font-bold text-black uppercase tracking-wider">Funzionalità</h3>
            </div>
            <div className="space-y-2">
              {FEATURE_TOGGLES.map((f) => {
                let badge: React.ReactNode = null;
                if (f.flag === "management_enabled") {
                  const ent = entitlementFor(tenant.settings as any, "smart_inventory");
                  const map: Record<string, { label: string; cls: string }> = {
                    manual: { label: "override manuale", cls: "bg-blue-50 text-blue-700 border-blue-200" },
                    active: { label: "pagato", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                    grace: { label: "grazia", cls: "bg-amber-50 text-amber-700 border-amber-200" },
                    canceled: { label: "annullato", cls: "bg-zinc-100 text-zinc-600 border-zinc-300" },
                    expired: { label: "scaduto", cls: "bg-zinc-100 text-zinc-600 border-zinc-300" },
                    none: { label: "non attivo", cls: "bg-zinc-100 text-zinc-600 border-zinc-300" },
                  };
                  const b = map[ent.reason] || map.none;
                  badge = <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${b.cls}`}>{b.label}</span>;
                }
                return (
                  <FeatureToggle
                    key={f.flag}
                    flag={f.flag}
                    icon={<Package className="w-3.5 h-3.5 text-[#c4956a]" />}
                    title={f.title}
                    hint={f.hint}
                    badge={badge}
                  />
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Settings editor — key nested settings the admin can override per tenant.
          Each sub-object is read-modify-written on save (the PATCH route merges
          shallowly at the top level of settings). */}
      {sForm && (
        <div className="rounded-xl border-2 p-4" style={cardStyle}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#c4956a]" />
              <h3 className="text-xs font-bold text-black uppercase tracking-wider">Impostazioni</h3>
            </div>
            <div className="flex items-center gap-2">
              {settingsMsg && <span className="text-[11px] text-black">{settingsMsg}</span>}
              <button onClick={saveSettings} disabled={savingSettings}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors disabled:opacity-60">
                <Save className="w-3.5 h-3.5" /> {savingSettings ? "..." : "Salva"}
              </button>
            </div>
          </div>

          {/* Kill switch — highest-value control, surfaced first */}
          <div className="flex items-start gap-3 p-3 rounded-lg mb-3" style={{ background: sForm.botPaused ? "rgba(239,68,68,0.08)" : "rgba(196,149,106,0.06)" }}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-black">Bot in pausa (kill switch)</p>
              <p className="text-[10px] text-black mt-0.5">Quando attivo, il motore WhatsApp smette di gestire le richieste e risponde solo col messaggio di pausa.</p>
              {sForm.botPaused && (
                <input
                  value={sForm.botPausedMessage}
                  onChange={(e) => setSForm({ ...sForm, botPausedMessage: e.target.value })}
                  placeholder="Messaggio mostrato mentre il bot è in pausa"
                  className="mt-2 w-full border-2 rounded-lg px-2 py-1.5 text-xs text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                  style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
                />
              )}
            </div>
            <button type="button" role="switch" aria-checked={sForm.botPaused}
              onClick={() => setSForm({ ...sForm, botPaused: !sForm.botPaused })}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${sForm.botPaused ? "bg-red-500" : "bg-zinc-300"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${sForm.botPaused ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="text-xs text-black">
              Timezone
              <input value={sForm.timezone} onChange={(e) => setSForm({ ...sForm, timezone: e.target.value })}
                placeholder="Europe/Rome"
                className="mt-1 w-full border-2 rounded-lg px-2 py-1.5 text-xs text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }} />
            </label>
            <label className="text-xs text-black">
              Lingua CRM
              <select value={sForm.crm_locale} onChange={(e) => setSForm({ ...sForm, crm_locale: e.target.value })}
                className="mt-1 w-full border-2 rounded-lg px-2 py-1.5 text-xs text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
                <option value="">(default)</option>
                <option value="it">it</option><option value="es">es</option><option value="en">en</option><option value="de">de</option>
              </select>
            </label>
            <label className="text-xs text-black">
              Voce (provider)
              <select value={sForm.voiceProvider} onChange={(e) => setSForm({ ...sForm, voiceProvider: e.target.value })}
                className="mt-1 w-full border-2 rounded-lg px-2 py-1.5 text-xs text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
                <option value="vapi">vapi (base)</option><option value="retell">retell (premium)</option>
              </select>
            </label>
            <label className="text-xs text-black">
              POS (provider)
              <select value={sForm.posProvider} onChange={(e) => setSForm({ ...sForm, posProvider: e.target.value })}
                className="mt-1 w-full border-2 rounded-lg px-2 py-1.5 text-xs text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
                {POS_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="text-xs text-black">
              Food cost target %
              <input type="number" value={sForm.foodCostTargetPct} onChange={(e) => setSForm({ ...sForm, foodCostTargetPct: e.target.value })}
                placeholder="30"
                className="mt-1 w-full border-2 rounded-lg px-2 py-1.5 text-xs text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }} />
            </label>
            <label className="text-xs text-black">
              Budget personale / mese (€)
              <input type="number" value={sForm.laborBudgetMonthly} onChange={(e) => setSForm({ ...sForm, laborBudgetMonthly: e.target.value })}
                placeholder="5000"
                className="mt-1 w-full border-2 rounded-lg px-2 py-1.5 text-xs text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }} />
            </label>
            <label className="text-xs text-black">
              Metodo costo
              <select value={sForm.costMethod} onChange={(e) => setSForm({ ...sForm, costMethod: e.target.value })}
                className="mt-1 w-full border-2 rounded-lg px-2 py-1.5 text-xs text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
                <option value="last">ultimo prezzo</option><option value="avg">media ponderata</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {/* Billing (this tenant) — read-only mirror; money actions go to Stripe. */}
      {(() => {
        const b = (tenant.settings as any)?.billing || {};
        const hasBilling = b.plan || b.status || b.stripe_customer_id;
        return (
          <div className="rounded-xl border-2 p-4" style={cardStyle}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-[#c4956a]" />
                <h3 className="text-xs font-bold text-black uppercase tracking-wider">Abbonamento</h3>
              </div>
              {b.stripe_customer_id && (
                <a href={`https://dashboard.stripe.com/customers/${b.stripe_customer_id}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-black/70 hover:text-black transition-colors">
                  Apri su Stripe <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            {!hasBilling ? (
              <p className="text-xs text-black">Nessun abbonamento attivo per questo cliente.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
                <div><p className="text-black/60">Piano</p><p className="font-medium text-black capitalize">{b.plan || "—"}</p></div>
                <div><p className="text-black/60">Ciclo</p><p className="font-medium text-black">{b.cycle || "—"}</p></div>
                <div><p className="text-black/60">Stato</p><p className="font-medium text-black">{b.status || "—"}</p></div>
                <div><p className="text-black/60">Rinnovo</p><p className="font-medium text-black">{b.current_period_end ? new Date(b.current_period_end).toLocaleDateString() : "—"}</p></div>
                <div><p className="text-black/60">Add-on</p><p className="font-medium text-black">{(b.addons && b.addons.length) ? b.addons.join(", ") : "—"}</p></div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Manual entitlement overrides — force a paid service ON or OFF regardless
          of billing (payment disputes). Auto = follow the subscription. */}
      {(() => {
        const ov = ((tenant.settings as any)?.manual_entitlements || {}) as { plan?: boolean; addons?: Record<string, boolean> };
        const currentOf = (key: string): boolean | undefined =>
          key === "plan" ? ov.plan : ov.addons?.[key];
        const effectiveOf = (key: string): boolean =>
          key === "plan" ? hasActivePlan(tenant.settings as any) : entitlementFor(tenant.settings as any, key as any).active;
        const SEG: Array<{ v: boolean | null; label: string; on: string }> = [
          { v: null, label: "Auto", on: "bg-zinc-700 text-white" },
          { v: true, label: "Attivo", on: "bg-emerald-500 text-white" },
          { v: false, label: "Disattivo", on: "bg-red-500 text-white" },
        ];
        return (
          <div className="rounded-xl border-2 p-4" style={cardStyle}>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-[#c4956a]" />
              <h3 className="text-xs font-bold text-black uppercase tracking-wider">Override servizi a pagamento</h3>
            </div>
            <p className="text-[10px] text-black/70 mb-3">
              Forza manualmente un servizio attivo o disattivo, ignorando lo stato del pagamento. <b>Auto</b> segue l&apos;abbonamento. L&apos;override vince su Stripe/PayPal.
            </p>
            <div className="space-y-2">
              {ENTITLEMENT_OVERRIDES.map((s) => {
                const current = currentOf(s.key);
                const effective = effectiveOf(s.key);
                const saving = ovSaving === s.key;
                return (
                  <div key={s.key} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.06)" }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs font-medium text-black">{s.title}</p>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                          effective ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-zinc-100 text-zinc-600 border-zinc-300"
                        }`}>
                          {effective ? "attivo" : "bloccato"}
                          {current === undefined ? " · auto" : current ? " · forzato ON" : " · forzato OFF"}
                        </span>
                      </div>
                      <p className="text-[10px] text-black mt-0.5">{s.hint}</p>
                    </div>
                    <div className="inline-flex flex-shrink-0 rounded-lg border overflow-hidden" style={{ borderColor: "#e6d8c5" }}>
                      {SEG.map((seg) => {
                        const active = current === undefined ? seg.v === null : current === seg.v;
                        return (
                          <button
                            key={String(seg.v)}
                            type="button"
                            disabled={saving}
                            onClick={() => setOverride(s.key, seg.v)}
                            className={`px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                              active ? seg.on : "bg-white text-black/70 hover:bg-zinc-50"
                            }`}
                          >
                            {seg.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-4">
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <p className="text-xs text-black font-medium">AI Revenue (7d)</p>
          <p className="text-xl font-bold text-[#22c55e]">€{kpis.aiRevenue7.toLocaleString()}</p>
        </div>
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <p className="text-xs text-black font-medium">AI Revenue (30d)</p>
          <p className="text-xl font-bold text-[#22c55e]">€{kpis.aiRevenue30.toLocaleString()}</p>
        </div>
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <div className="flex items-center gap-1">
            <Bot className="w-3.5 h-3.5 text-[#c4956a]" />
            <p className="text-xs text-black font-medium">AI Handled</p>
          </div>
          <p className="text-xl font-bold text-black">{kpis.aiPct}%</p>
          <p className="text-[10px] text-black">{kpis.aiCount} AI / {kpis.totalBookings30 - kpis.aiCount} Staff</p>
        </div>
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <div className="flex items-center gap-1">
            <UserX className="w-3.5 h-3.5 text-red-400" />
            <p className="text-xs text-black font-medium">No-Shows (30d)</p>
          </div>
          <p className="text-xl font-bold text-black">{kpis.noShows}</p>
        </div>
        <div className="rounded-xl p-3 sm:p-4 border-2" style={cardStyle}>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-orange-400" />
            <p className="text-xs text-black font-medium">Escalation Rate</p>
          </div>
          <p className="text-xl font-bold text-black">{kpis.escalationRate}%</p>
          <p className="text-[10px] text-black">{kpis.escalations} escalated</p>
        </div>
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="rounded-xl border-2 p-4" style={cardStyle}>
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-bold text-black uppercase tracking-wider">Insights & Opportunities</h3>
          </div>
          <div className="space-y-2">
            {insights.map((ins: any, i: number) => {
              const iconMap: Record<string, any> = {
                revenue_opportunity: <DollarSign className="w-3.5 h-3.5 text-emerald-500" />,
                performance_drop: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
                ai_optimization: <Zap className="w-3.5 h-3.5 text-purple-500" />,
                loss_prevention: <ShieldCheck className="w-3.5 h-3.5 text-orange-500" />,
                hidden_value: <Eye className="w-3.5 h-3.5 text-indigo-500" />,
              };
              return (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: "rgba(196,149,106,0.06)" }}>
                  <div className="mt-0.5">{iconMap[ins.type] || <Lightbulb className="w-3.5 h-3.5 text-amber-500" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-black">{ins.title}</p>
                      {ins.estimated_value > 0 && (
                        <span className="text-xs font-bold text-[#22c55e]">€{ins.estimated_value.toLocaleString()}/mo</span>
                      )}
                    </div>
                    <p className="text-[10px] text-black mt-0.5">{ins.description}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    ins.confidence === "high" ? "bg-emerald-50 text-emerald-700" :
                    ins.confidence === "medium" ? "bg-yellow-50 text-yellow-700" :
                    "bg-zinc-50 text-black"
                  }`}>{ins.confidence}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Two columns: Reservations + Conversations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Recent Reservations */}
        <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#c4956a" }}>
            <h3 className="text-xs font-bold text-black uppercase tracking-wider">Recent Reservations</h3>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {recentReservations.length === 0 ? (
              <p className="p-4 text-xs text-black text-center">No recent reservations</p>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {recentReservations.map((r: any) => (
                  <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                    {sourceIcon(r.source)}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-black truncate">
                        {r.guests?.name || "Guest"} — {r.party_size}p
                      </p>
                      <p className="text-[10px] text-black">{r.date} {r.time}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      r.status === "confirmed" ? "bg-emerald-50 text-emerald-700" :
                      r.status === "no_show" ? "bg-red-50 text-red-700" :
                      r.status === "cancelled" ? "bg-zinc-100 text-black" :
                      "bg-yellow-50 text-yellow-700"
                    }`}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Conversations */}
        <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#c4956a" }}>
            <h3 className="text-xs font-bold text-black uppercase tracking-wider">Recent Conversations</h3>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {recentConversations.length === 0 ? (
              <p className="p-4 text-xs text-black text-center">No recent conversations</p>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {recentConversations.map((c: any) => (
                  <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                    {c.channel === "whatsapp" ? (
                      <MessageSquare className="w-3.5 h-3.5 text-[#c4956a]" />
                    ) : (
                      <Phone className="w-3.5 h-3.5 text-indigo-500" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-black truncate">{c.summary || "No summary"}</p>
                      <p className="text-[10px] text-black">{new Date(c.created_at).toLocaleString()}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      c.status === "escalated" ? "bg-red-50 text-red-700" :
                      c.status === "resolved" ? "bg-emerald-50 text-emerald-700" :
                      "bg-zinc-100 text-black"
                    }`}>
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Incidents + System Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Incidents */}
        <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#c4956a" }}>
            <h3 className="text-xs font-bold text-black uppercase tracking-wider">Incidents</h3>
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {recentIncidents.length === 0 ? (
              <p className="p-4 text-xs text-black text-center">No incidents</p>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {recentIncidents.map((inc: any) => (
                  <div key={inc.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        inc.severity === "critical" ? "bg-red-50 text-red-700 border-red-200" :
                        "bg-yellow-50 text-yellow-700 border-yellow-200"
                      }`}>{inc.severity}</span>
                      <span className="text-[10px] text-black">{inc.type.replace("_", " ")}</span>
                    </div>
                    <p className="text-xs font-medium text-black">{inc.title}</p>
                    <p className="text-[10px] text-black">{new Date(inc.created_at).toLocaleDateString()} — {inc.status}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* System Logs */}
        <div className="rounded-xl border-2 overflow-hidden" style={cardStyle}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#c4956a" }}>
            <h3 className="text-xs font-bold text-black uppercase tracking-wider">System Logs</h3>
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {recentLogs.length === 0 ? (
              <p className="p-4 text-xs text-black text-center">No system logs</p>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(196,149,106,0.15)" }}>
                {recentLogs.map((log: any) => (
                  <div key={log.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        log.severity === "critical" ? "bg-red-50 text-red-700 border-red-200" :
                        log.severity === "high" ? "bg-orange-50 text-orange-700 border-orange-200" :
                        "bg-yellow-50 text-yellow-700 border-yellow-200"
                      }`}>{log.severity}</span>
                      <span className="text-[10px] text-black">{log.category}</span>
                    </div>
                    <p className="text-xs font-medium text-black">{log.title}</p>
                    <p className="text-[10px] text-black">{new Date(log.created_at).toLocaleDateString()} — {log.status}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Client notes — folded in from the old /admin/clients page */}
      <div className="rounded-xl border-2 p-4" style={cardStyle}>
        <div className="flex items-center gap-2 mb-3">
          <StickyNote className="w-4 h-4 text-[#c4956a]" />
          <h3 className="text-xs font-bold text-black uppercase tracking-wider">Note cliente</h3>
        </div>
        <div className="flex gap-2 mb-3">
          <input value={newNote} onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
            placeholder="Aggiungi una nota (rinnovo contratto, upsell, richiesta...)"
            className="flex-1 border-2 rounded-lg px-2 py-1.5 text-xs text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
            style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }} />
          <button onClick={addNote} disabled={notesBusy || !newNote.trim()}
            className="px-3 py-1.5 rounded-lg bg-[#c4956a] text-white text-xs font-bold hover:bg-[#8b6540] transition-colors disabled:opacity-50">
            Aggiungi
          </button>
        </div>
        {notes.length === 0 ? (
          <p className="text-xs text-black">Nessuna nota.</p>
        ) : (
          <div className="space-y-2">
            {notes.map((n) => (
              <div key={n.id} className="group flex items-start justify-between gap-3 p-2.5 rounded-lg" style={{ background: "rgba(196,149,106,0.06)" }}>
                <div className="min-w-0">
                  <p className="text-xs text-black whitespace-pre-wrap break-words">{n.content}</p>
                  <p className="text-[10px] text-black/60 mt-0.5">{new Date(n.created_at).toLocaleString()}</p>
                </div>
                <button onClick={() => deleteNote(n.id)} className="opacity-0 group-hover:opacity-100 text-black/50 hover:text-red-600 transition-opacity flex-shrink-0" title="Elimina nota">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Danger Zone — platform_admin only (page already gates) */}
      <div className="rounded-xl border-2 border-red-300 bg-red-50/60 p-4 space-y-3">
        <div className="flex items-center gap-2 text-red-700 font-bold text-sm">
          <AlertTriangle className="w-4 h-4" /> Danger Zone
        </div>

        {actionMsg && <p className="text-xs font-medium text-black">{actionMsg}</p>}
        {downloadUrl && (
          <a href={downloadUrl} className="text-xs font-bold text-blue-700 underline" target="_blank" rel="noreferrer">
            ⬇︎ Scarica il backup dei dati (JSON)
          </a>
        )}

        {tenant.status === "archived" ? (
          <div className="space-y-2">
            <p className="text-xs text-black">
              Archiviato{tenant.archived_at ? ` il ${new Date(tenant.archived_at).toLocaleDateString()}` : ""}.
              {tenant.purge_after ? ` Cancellazione automatica il ${new Date(tenant.purge_after).toLocaleDateString()}.` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <button onClick={runRestore} disabled={working}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">
                Ripristina
              </button>
              <button onClick={() => { setDanger("purge"); setConfirmText(""); }} disabled={working}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50">
                Cancella adesso definitivamente
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setDanger("archive"); setConfirmText(""); }} disabled={working}
              className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-bold hover:bg-orange-700 disabled:opacity-50">
              Archivia &amp; rimuovi (recuperabile 90 giorni)
            </button>
            <button onClick={() => { setDanger("purge"); setConfirmText(""); }} disabled={working}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50">
              Cancella subito (salta l&apos;attesa)
            </button>
          </div>
        )}
      </div>

      {/* Typed-name confirm modal */}
      {danger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !working && setDanger(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {danger === "archive" ? "Archivia e rimuovi" : "Cancella definitivamente"}
            </h3>
            <p className="text-xs text-black">
              {danger === "archive"
                ? "Il cliente sparisce subito dal CRM e i suoi servizi si fermano. Recuperabile per 90 giorni, poi cancellato per sempre."
                : "Cancellazione IMMEDIATA e irreversibile: dati, workflow n8n, assistente vocale e accessi staff. Esiste un backup scaricabile."}
            </p>
            <p className="text-xs text-black">Scrivi il nome esatto del ristorante per confermare: <b>{tenant.name}</b></p>
            <input autoFocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              className="w-full border-2 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
              style={{ borderColor: "#fca5a5" }} placeholder={tenant.name} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setDanger(null)} disabled={working}
                className="px-3 py-1.5 rounded-lg border text-xs font-bold text-black disabled:opacity-50">Annulla</button>
              <button
                onClick={danger === "archive" ? runArchive : runPurge}
                disabled={working || confirmText.trim() !== tenant.name}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50">
                {working ? "..." : (danger === "archive" ? "Archivia" : "Cancella per sempre")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
