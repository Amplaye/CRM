"use client";

import { Plus, Power, Trash2, History, X, Save, AlertTriangle, Bot } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import type { AutomationRule, AutomationRun, AutomationTrigger, AutomationActionType } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

type TriggerOpt = { value: AutomationTrigger; key: keyof Dictionary; disabled?: boolean };
const TRIGGER_OPTIONS: TriggerOpt[] = [
  { value: "on_reservation_created", key: "auto_trigger_reservation_created" },
  { value: "on_reservation_cancelled", key: "auto_trigger_reservation_cancelled" },
  { value: "on_ai_escalation", key: "auto_trigger_ai_escalation" },
  { value: "on_waitlist_match", key: "auto_trigger_waitlist_match" },
  { value: "schedule", key: "auto_trigger_schedule", disabled: true },
];

type ActionOpt = { value: AutomationActionType; key: keyof Dictionary; disabled?: boolean };
const ACTION_OPTIONS: ActionOpt[] = [
  { value: "send_sms", key: "auto_action_send_sms" },
  { value: "notify_staff", key: "auto_action_notify_staff" },
  { value: "update_status", key: "auto_action_update_status" },
  { value: "send_email", key: "auto_action_send_email", disabled: true },
];

const STATUS_OPTIONS = [
  "confirmed",
  "pending_confirmation",
  "escalated",
  "seated",
  "completed",
  "no_show",
  "cancelled",
];

interface RuleFormState {
  id?: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  action_type: AutomationActionType;
  message: string;
  to_override: string;
  phones: string;
  status: string;
  cond_source: string;
  cond_min_party: string;
  is_active: boolean;
}

const EMPTY_FORM: RuleFormState = {
  name: "",
  description: "",
  trigger: "on_reservation_created",
  action_type: "send_sms",
  message: "",
  to_override: "",
  phones: "",
  status: "escalated",
  cond_source: "",
  cond_min_party: "",
  is_active: true,
};

function ruleToForm(r: AutomationRule): RuleFormState {
  const p = (r.action.payload || {}) as any;
  const c = (r.condition || {}) as any;
  return {
    id: r.id,
    name: r.name,
    description: r.description || "",
    trigger: r.trigger,
    action_type: r.action.type,
    message: p.message || "",
    to_override: p.to || "",
    phones: Array.isArray(p.phones) ? p.phones.join("\n") : "",
    status: p.status || "escalated",
    cond_source: c.source || "",
    cond_min_party: c.party_size_gte ? String(c.party_size_gte) : "",
    is_active: r.is_active,
  };
}

function formToPayload(f: RuleFormState) {
  const action: any = { type: f.action_type, payload: {} };
  if (f.action_type === "send_sms") {
    action.payload = { message: f.message, ...(f.to_override.trim() ? { to: f.to_override.trim() } : {}) };
  } else if (f.action_type === "notify_staff") {
    const phones = f.phones.split(/[\n,]/).map((p) => p.trim()).filter(Boolean);
    action.payload = { phones, message: f.message };
  } else if (f.action_type === "update_status") {
    action.payload = { status: f.status };
  } else if (f.action_type === "send_email") {
    action.payload = {};
  }
  const condition: any = {};
  if (f.cond_source) condition.source = f.cond_source;
  if (f.cond_min_party) condition.party_size_gte = parseInt(f.cond_min_party, 10);
  return {
    name: f.name.trim(),
    description: f.description.trim(),
    trigger: f.trigger,
    action,
    condition: Object.keys(condition).length > 0 ? condition : null,
    is_active: f.is_active,
  };
}

export default function AutomationsPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const supabase = createClient();

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RuleFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [logsFor, setLogsFor] = useState<AutomationRule | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  useEffect(() => {
    if (!tenant) return;

    const fetchRules = async () => {
      const { data, error } = await supabase
        .from("automation_rules")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: true });

      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }
      setRules((data || []) as AutomationRule[]);
      setLoading(false);
    };

    fetchRules();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("automation_rules_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "automation_rules", filter: `tenant_id=eq.${tenant.id}` },
        () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => fetchRules(), 400);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [tenant?.id]);

  const toggleRule = async (rule: AutomationRule) => {
    await supabase
      .from("automation_rules")
      .update({ is_active: !rule.is_active, updated_at: new Date().toISOString() })
      .eq("id", rule.id);
  };

  const handleSave = async () => {
    if (!editing || !tenant) return;
    if (!editing.name.trim()) return;
    setSaving(true);
    const payload = formToPayload(editing);
    try {
      if (editing.id) {
        await supabase
          .from("automation_rules")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", editing.id);
      } else {
        await supabase
          .from("automation_rules")
          .insert({ ...payload, tenant_id: tenant.id });
      }
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rule: AutomationRule) => {
    const confirmText = (t as any)("auto_delete_confirm") || "Eliminare questa automazione?";
    if (!confirm(confirmText)) return;
    await supabase.from("automation_rules").delete().eq("id", rule.id);
  };

  const openLogs = async (rule: AutomationRule) => {
    setLogsFor(rule);
    setRunsLoading(true);
    const { data } = await supabase
      .from("automation_runs")
      .select("*")
      .eq("rule_id", rule.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setRuns((data || []) as AutomationRun[]);
    setRunsLoading(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">{t("auto_h1_title")}</h1>
          <p className="mt-1 text-sm text-black">{t("auto_h1_subtitle")}</p>
        </div>
        <button
          onClick={() => setEditing({ ...EMPTY_FORM })}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-black text-white text-sm font-semibold hover:bg-zinc-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("auto_create_btn")}
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-xl border-2 p-6 h-[200px]" style={{ background: "rgba(252,246,237,0.6)", borderColor: "#c4956a" }} />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-zinc-300 p-10 text-center">
          <Bot className="w-10 h-10 text-zinc-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-black">{t("auto_empty_title")}</h2>
          <p className="mt-1 text-sm text-zinc-600 max-w-md mx-auto">{t("auto_empty_desc")}</p>
          <button
            onClick={() => setEditing({ ...EMPTY_FORM })}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-black text-white text-sm font-semibold hover:bg-zinc-800"
          >
            <Plus className="w-4 h-4" />
            {t("auto_create_btn")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onToggle={() => toggleRule(rule)}
              onEdit={() => setEditing(ruleToForm(rule))}
              onDelete={() => handleDelete(rule)}
              onLogs={() => openLogs(rule)}
              t={t as any}
            />
          ))}
        </div>
      )}

      {editing && (
        <RuleModal
          form={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          saving={saving}
          t={t as any}
        />
      )}

      {logsFor && (
        <LogsModal
          rule={logsFor}
          runs={runs}
          loading={runsLoading}
          onClose={() => {
            setLogsFor(null);
            setRuns([]);
          }}
          t={t as any}
        />
      )}
    </div>
  );
}

function RuleCard({
  rule,
  onToggle,
  onEdit,
  onDelete,
  onLogs,
  t,
}: {
  rule: AutomationRule;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLogs: () => void;
  t: (k: string) => string;
}) {
  const triggerLabel = (() => {
    const o = TRIGGER_OPTIONS.find((x) => x.value === rule.trigger);
    return o ? t(o.key as string) : rule.trigger;
  })();
  const actionLabel = (() => {
    const o = ACTION_OPTIONS.find((x) => x.value === rule.action.type);
    return o ? t(o.key as string) : rule.action.type;
  })();
  const lastRunDate = rule.last_run_at ? new Date(rule.last_run_at).toLocaleString() : null;

  return (
    <div
      className={`rounded-xl border-2 p-5 flex flex-col gap-3 transition-all ${rule.is_active ? "border-emerald-200" : ""}`}
      style={{
        background: "rgba(252,246,237,0.85)",
        borderColor: rule.is_active ? "#10b981" : "#c4956a",
        boxShadow: "0 10px 30px rgba(196,149,106,0.18)",
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-black truncate">{rule.name}</h3>
          {rule.description && <p className="text-xs text-zinc-700 mt-1 line-clamp-2">{rule.description}</p>}
        </div>
        <span className={`flex-shrink-0 inline-flex h-2.5 w-2.5 rounded-full ${rule.is_active ? "bg-emerald-500" : "bg-zinc-300"} mt-1.5`} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md bg-zinc-100 text-zinc-700 font-bold">
          {triggerLabel}
        </span>
        <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md bg-blue-50 text-blue-700 font-bold">
          {actionLabel}
        </span>
      </div>

      <div className="flex items-center justify-between text-[11px] text-zinc-600 pt-2 border-t border-zinc-100">
        <span>
          {(rule.run_count || 0)} {t("auto_runs_count")}
        </span>
        <span title={lastRunDate || ""}>
          {lastRunDate ? `${t("auto_last_run")}: ${lastRunDate}` : t("auto_never_run")}
        </span>
      </div>

      <div className="flex items-center gap-1.5 pt-1">
        <button
          onClick={onToggle}
          className={`flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-md transition-colors ${rule.is_active ? "bg-white border border-zinc-200 text-black hover:bg-zinc-50" : "bg-black text-white hover:bg-zinc-800"}`}
        >
          <Power className="w-3 h-3" />
          {rule.is_active ? t("auto_btn_disable") : t("auto_btn_activate")}
        </button>
        <button
          onClick={onEdit}
          className="px-2.5 py-1.5 text-xs font-bold rounded-md bg-white border border-zinc-200 text-black hover:bg-zinc-50"
        >
          {t("auto_edit")}
        </button>
        <button
          onClick={onLogs}
          className="px-2 py-1.5 rounded-md bg-white border border-zinc-200 text-black hover:bg-zinc-50"
          title={t("auto_view_logs")}
        >
          <History className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="px-2 py-1.5 rounded-md bg-white border border-zinc-200 text-red-600 hover:bg-red-50"
          title={t("auto_delete")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function RuleModal({
  form,
  onChange,
  onClose,
  onSave,
  saving,
  t,
}: {
  form: RuleFormState;
  onChange: (f: RuleFormState) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  t: (k: string) => string;
}) {
  const isEdit = !!form.id;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-black">
            {isEdit ? t("auto_modal_edit_title") : t("auto_modal_new_title")}
          </h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-zinc-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
              {t("auto_field_name")}
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black"
              placeholder="Es. Conferma WhatsApp"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
              {t("auto_field_description")}
            </label>
            <textarea
              value={form.description}
              onChange={(e) => onChange({ ...form, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
              {t("auto_field_trigger")}
            </label>
            <select
              value={form.trigger}
              onChange={(e) => onChange({ ...form, trigger: e.target.value as AutomationTrigger })}
              className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black"
            >
              {TRIGGER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {t(o.key as string)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
              {t("auto_field_action")}
            </label>
            <select
              value={form.action_type}
              onChange={(e) => onChange({ ...form, action_type: e.target.value as AutomationActionType })}
              className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black"
            >
              {ACTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {t(o.key as string)}
                </option>
              ))}
            </select>
          </div>

          {form.action_type === "send_sms" && (
            <>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  {t("auto_field_message")}
                </label>
                <textarea
                  value={form.message}
                  onChange={(e) => onChange({ ...form, message: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none font-mono"
                  placeholder={"Ciao {{guest_name}}, conferma per {{date}} {{time}} per {{party_size}} persone."}
                />
                <p className="mt-1 text-[11px] text-zinc-500">{t("auto_field_message_hint")}</p>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  {t("auto_field_to_override")}
                </label>
                <input
                  type="text"
                  value={form.to_override}
                  onChange={(e) => onChange({ ...form, to_override: e.target.value })}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder="+34..."
                />
                <p className="mt-1 text-[11px] text-zinc-500">{t("auto_field_to_hint")}</p>
              </div>
            </>
          )}

          {form.action_type === "notify_staff" && (
            <>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  {t("auto_field_phones")}
                </label>
                <textarea
                  value={form.phones}
                  onChange={(e) => onChange({ ...form, phones: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none font-mono"
                  placeholder={"+34600000000\n+34611111111"}
                />
                <p className="mt-1 text-[11px] text-zinc-500">{t("auto_field_phones_hint")}</p>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  {t("auto_field_message")}
                </label>
                <textarea
                  value={form.message}
                  onChange={(e) => onChange({ ...form, message: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none font-mono"
                  placeholder={"Nuova reservation: {{guest_name}} {{date}} {{time}} ({{party_size}} pax)"}
                />
                <p className="mt-1 text-[11px] text-zinc-500">{t("auto_field_message_hint")}</p>
              </div>
            </>
          )}

          {form.action_type === "update_status" && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
                {t("auto_field_status")}
              </label>
              <select
                value={form.status}
                onChange={(e) => onChange({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}

          {form.action_type === "send_email" && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-900">{t("auto_email_coming_soon")}</p>
            </div>
          )}

          <details className="border border-zinc-200 rounded-md">
            <summary className="px-3 py-2 text-xs font-bold uppercase tracking-wider cursor-pointer text-zinc-700">
              {t("auto_conditions")}
            </summary>
            <div className="p-3 space-y-3 border-t border-zinc-100">
              <p className="text-[11px] text-zinc-500">{t("auto_cond_help")}</p>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  {t("auto_cond_source")}
                </label>
                <select
                  value={form.cond_source}
                  onChange={(e) => onChange({ ...form, cond_source: e.target.value })}
                  className="w-full px-3 py-1.5 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black"
                >
                  <option value="">{t("auto_cond_any")}</option>
                  <option value="ai_agent">AI</option>
                  <option value="ai_voice">AI (voice)</option>
                  <option value="staff">Staff</option>
                  <option value="phone">Phone</option>
                  <option value="walk-in">Walk-in</option>
                  <option value="online">Online</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-700 mb-1">
                  {t("auto_cond_min_party")}
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.cond_min_party}
                  onChange={(e) => onChange({ ...form, cond_min_party: e.target.value })}
                  className="w-full px-3 py-1.5 border border-zinc-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  placeholder=""
                />
              </div>
            </div>
          </details>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => onChange({ ...form, is_active: e.target.checked })}
              className="w-4 h-4"
            />
            <span className="text-sm font-semibold text-black">{t("auto_active_checkbox")}</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-200 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-md bg-white border border-zinc-300 text-black hover:bg-zinc-50"
          >
            {t("auto_cancel")}
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.name.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-black text-white hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            {saving ? t("auto_saving") : t("auto_save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogsModal({
  rule,
  runs,
  loading,
  onClose,
  t,
}: {
  rule: AutomationRule;
  runs: AutomationRun[];
  loading: boolean;
  onClose: () => void;
  t: (k: string) => string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-black">{t("auto_logs_title")}</h2>
            <p className="text-xs text-zinc-600">{rule.name}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-zinc-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="py-10 text-center text-sm text-zinc-500">Loading…</div>
          ) : runs.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-500">{t("auto_logs_empty")}</div>
          ) : (
            <div className="space-y-1.5">
              {runs.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start gap-3 px-3 py-2 border border-zinc-100 rounded-md text-xs"
                >
                  <span
                    className={`flex-shrink-0 px-2 py-0.5 rounded font-bold uppercase tracking-wider text-[10px] ${
                      r.status === "success"
                        ? "bg-emerald-50 text-emerald-700"
                        : r.status === "failed"
                        ? "bg-red-50 text-red-700"
                        : "bg-zinc-100 text-zinc-700"
                    }`}
                  >
                    {t(`auto_status_${r.status}`)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-zinc-700">{new Date(r.created_at).toLocaleString()}</div>
                    {r.error && <div className="text-red-600 mt-0.5">{r.error}</div>}
                    {r.context && (
                      <div className="text-zinc-500 mt-0.5 truncate font-mono text-[10px]">
                        {(r.context as any).guest_name || ""}
                        {(r.context as any).date ? ` · ${(r.context as any).date}` : ""}
                        {(r.context as any).time ? ` ${(r.context as any).time}` : ""}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
