"use client";

// Staff page: weekly rota (turni) + time-off / swap requests + team management.
// Owner/manager plan shifts and decide requests; a waiter (host) sees the
// posted rota, can hand a shift to a colleague and ask for time off.
// Reads go straight through RLS (members read the whole rota); every write
// goes through /api/staff/* (service role + role checks).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarClock, ChevronLeft, ChevronRight, Plus, X, Sun, Moon, Clock,
  CheckCircle2, XCircle, Hourglass, Users, Lock, Send,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { hasActivePlan } from "@/lib/billing/entitlements";
import { StaffTab } from "@/components/settings/StaffTab";

type DbRole = "owner" | "manager" | "host";
type Member = { id: string; user_id: string; role: DbRole; name: string; email: string };
type Shift = {
  id: string;
  member_id: string;
  work_date: string;
  band: "lunch" | "dinner" | "all";
  start_time: string;
  end_time: string;
  role_note: string | null;
  status: "scheduled" | "cancelled";
};
type ShiftRequest = {
  id: string;
  member_id: string;
  type: "time_off" | "swap";
  work_date: string;
  target_shift_id: string | null;
  target_member_id: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

const CARD = "rounded-2xl border bg-white/70";
const CARD_STYLE = { borderColor: "#eaddcb" } as const;
const pad = (n: number) => String(n).padStart(2, "0");
const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (t: string) => String(t).slice(0, 5);

/** Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const wd = (out.getDay() + 6) % 7; // 0 = Monday
  out.setDate(out.getDate() - wd);
  return out;
}

const DAY_KEYS = [
  "settings_day_mon", "settings_day_tue", "settings_day_wed", "settings_day_thu",
  "settings_day_fri", "settings_day_sat", "settings_day_sun",
] as const;

export default function StaffPage() {
  const { t } = useLanguage();
  const { activeTenant, activeRole } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const tk = (k: string) => t(k as keyof Dictionary);

  const isManager = activeRole === "owner" || activeRole === "manager" || activeRole === "platform_admin";
  const isOwner = activeRole === "owner" || activeRole === "platform_admin";

  const [tab, setTab] = useState<"shifts" | "requests" | "team">("shifts");
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [members, setMembers] = useState<Member[]>([]);
  const [myMemberId, setMyMemberId] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [shiftModal, setShiftModal] = useState<
    | { mode: "create"; memberId: string; date: string }
    | { mode: "edit"; shift: Shift }
    | null
  >(null);
  const [requestModal, setRequestModal] = useState<
    | { type: "time_off" }
    | { type: "swap"; shift: Shift }
    | null
  >(null);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);
  const weekFrom = dateStr(weekDays[0]);
  const weekTo = dateStr(weekDays[6]);
  const todayStr = dateStr(new Date());

  // ── Members (same two-query pattern as StaffTab) ──
  useEffect(() => {
    if (!activeTenant?.id) return;
    let cancelled = false;
    (async () => {
      const [{ data: tmRows }, { data: { user } }] = await Promise.all([
        supabase.from("tenant_members").select("id, user_id, role").eq("tenant_id", activeTenant.id),
        supabase.auth.getUser(),
      ]);
      const userIds = (tmRows || []).map((r: any) => r.user_id as string);
      let usersById = new Map<string, { email: string; name: string }>();
      if (userIds.length > 0) {
        const { data: userRows } = await supabase.from("users").select("id, email, name").in("id", userIds);
        usersById = new Map((userRows || []).map((u: any) => [u.id, { email: u.email || "", name: u.name || "" }]));
      }
      if (cancelled) return;
      const rows: Member[] = (tmRows || []).map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        role: r.role as DbRole,
        name: usersById.get(r.user_id)?.name || "",
        email: usersById.get(r.user_id)?.email || "",
      }));
      rows.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
      setMembers(rows);
      setMyMemberId(rows.find((m) => m.user_id === user?.id)?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [activeTenant?.id, supabase]);

  // ── Shifts for the visible week + requests ──
  const refresh = useCallback(async () => {
    if (!activeTenant?.id) return;
    const [{ data: shiftRows }, { data: reqRows }] = await Promise.all([
      supabase
        .from("staff_shifts")
        .select("*")
        .eq("tenant_id", activeTenant.id)
        .gte("work_date", weekFrom)
        .lte("work_date", weekTo)
        .order("start_time"),
      supabase
        .from("shift_requests")
        .select("*")
        .eq("tenant_id", activeTenant.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setShifts((shiftRows || []) as Shift[]);
    setRequests((reqRows || []) as ShiftRequest[]);
    setLoading(false);
  }, [activeTenant?.id, supabase, weekFrom, weekTo]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const memberName = useCallback(
    (id: string | null) => {
      const m = members.find((x) => x.id === id);
      return m ? m.name || m.email || "—" : "—";
    },
    [members],
  );

  const shiftsFor = useCallback(
    (memberId: string, date: string) =>
      shifts.filter((s) => s.member_id === memberId && s.work_date === date && s.status === "scheduled"),
    [shifts],
  );

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  // ── Guards ──
  if (!hasActivePlan(activeTenant?.settings)) {
    return (
      <div className="p-6 lg:p-8">
        <div className={`${CARD} p-8 max-w-lg mx-auto text-center`} style={CARD_STYLE}>
          <Lock className="w-8 h-8 mx-auto mb-3" style={{ color: "#c4956a" }} />
          <p className="text-black font-bold">{tk("staff_page_title")}</p>
          <p className="text-sm text-black mt-2">{tk("staff_plan_locked")}</p>
          <Link href="/settings?tab=payments" className="inline-block mt-4 px-4 py-2 rounded-lg text-white text-sm font-bold" style={{ background: "#c4956a" }}>
            {tk("nav_settings")}
          </Link>
        </div>
      </div>
    );
  }

  const bandIcon = (band: Shift["band"]) =>
    band === "lunch" ? <Sun className="w-3 h-3" /> : band === "dinner" ? <Moon className="w-3 h-3" /> : <Clock className="w-3 h-3" />;

  const bandColors: Record<Shift["band"], { bg: string; fg: string }> = {
    lunch: { bg: "rgba(245,158,11,0.14)", fg: "#92400e" },
    dinner: { bg: "rgba(124,92,60,0.16)", fg: "#5b4632" },
    all: { bg: "rgba(122,133,96,0.16)", fg: "#4a5138" },
  };

  const statusChip = (status: ShiftRequest["status"]) => {
    const map = {
      pending: { icon: <Hourglass className="w-3.5 h-3.5" />, label: tk("staff_status_pending"), color: "#92400e", bg: "rgba(245,158,11,0.12)" },
      approved: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: tk("staff_status_approved"), color: "#047857", bg: "rgba(5,150,105,0.1)" },
      rejected: { icon: <XCircle className="w-3.5 h-3.5" />, label: tk("staff_status_rejected"), color: "#dc2626", bg: "rgba(220,38,38,0.08)" },
    } as const;
    const s = map[status];
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold" style={{ color: s.color, background: s.bg }}>
        {s.icon} {s.label}
      </span>
    );
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-2">
            <CalendarClock className="w-6 h-6" /> {tk("staff_page_title")}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#8b6540" }}>{tk("staff_page_subtitle")}</p>
        </div>
        {tab === "shifts" && !isManager && myMemberId && (
          <button
            onClick={() => setRequestModal({ type: "time_off" })}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white/70"
            style={{ borderColor: "#c4956a" }}
          >
            <Send className="w-4 h-4" /> {tk("staff_request_time_off")}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-xl border overflow-hidden bg-white/70" style={{ borderColor: "#c4956a" }}>
        {([
          ["shifts", tk("staff_tab_shifts"), null],
          ["requests", tk("staff_tab_requests"), pendingCount > 0 ? pendingCount : null],
          ...(isOwner ? ([["team", tk("staff_tab_team"), null]] as const) : []),
        ] as Array<[string, string, number | null]>).map(([key, label, badge]) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={`px-4 py-2 text-sm cursor-pointer inline-flex items-center gap-1.5 ${tab === key ? "text-white font-bold" : "text-black"}`}
            style={tab === key ? { background: "#c4956a" } : undefined}
          >
            {label}
            {badge != null && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold flex items-center justify-center"
                style={{ background: tab === key ? "rgba(255,255,255,0.3)" : "#dc2626", color: "#fff" }}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "team" && isOwner && (
        <div className={`${CARD} p-4 sm:p-6`} style={CARD_STYLE}>
          <StaffTab />
        </div>
      )}

      {tab === "requests" && (
        <div className={`${CARD} overflow-hidden`} style={CARD_STYLE}>
          {requests.length === 0 ? (
            <p className="p-6 text-sm text-black">{tk("staff_requests_empty")}</p>
          ) : (
            <div className="divide-y" style={{ borderColor: "#f0e5d4" }}>
              {requests.map((r) => (
                <div key={r.id} className="p-4 flex flex-wrap items-center gap-3 justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-black">
                      {memberName(r.member_id)}
                      <span className="font-medium"> · {r.type === "time_off" ? tk("staff_type_time_off") : tk("staff_type_swap")}</span>
                      <span className="font-medium"> · {r.work_date}</span>
                    </p>
                    {r.type === "swap" && (
                      <p className="text-xs text-black mt-0.5">→ {memberName(r.target_member_id)}</p>
                    )}
                    {r.reason && <p className="text-xs italic mt-0.5" style={{ color: "#8b6540" }}>“{r.reason}”</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {statusChip(r.status)}
                    {isManager && r.status === "pending" && (
                      <>
                        <button
                          onClick={async () => {
                            await fetch("/api/staff/requests", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ tenant_id: activeTenant!.id, request_id: r.id, action: "approve" }),
                            });
                            void refresh();
                          }}
                          className="px-3 py-1.5 rounded-lg text-white text-xs font-bold cursor-pointer"
                          style={{ background: "#059669" }}
                        >
                          {tk("staff_approve")}
                        </button>
                        <button
                          onClick={async () => {
                            await fetch("/api/staff/requests", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ tenant_id: activeTenant!.id, request_id: r.id, action: "reject" }),
                            });
                            void refresh();
                          }}
                          className="px-3 py-1.5 rounded-lg text-white text-xs font-bold cursor-pointer bg-red-500"
                        >
                          {tk("staff_reject")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "shifts" && (
        <>
          {/* Week navigation */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-xl border overflow-hidden bg-white/70" style={{ borderColor: "#c4956a" }}>
              <button onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() - 7); return d; })}
                className="px-3 py-2 cursor-pointer text-black" aria-label="prev week">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => setWeekStart(mondayOf(new Date()))} className="px-3 py-2 text-sm font-bold cursor-pointer text-black">
                {tk("staff_today")}
              </button>
              <button onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() + 7); return d; })}
                className="px-3 py-2 cursor-pointer text-black" aria-label="next week">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <span className="text-sm font-bold text-black tabular-nums">
              {weekDays[0].getDate()}/{pad(weekDays[0].getMonth() + 1)} — {weekDays[6].getDate()}/{pad(weekDays[6].getMonth() + 1)}
            </span>
          </div>

          {/* Rota grid — horizontally scrollable on mobile */}
          <div className={`${CARD} overflow-hidden`} style={CARD_STYLE}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr style={{ background: "rgba(252,246,237,0.9)" }}>
                    <th className="text-left text-xs font-bold text-black uppercase tracking-wide px-3 py-2.5 sticky left-0 z-10 w-40"
                      style={{ background: "#fcf6ed" }}>
                      <Users className="w-4 h-4 inline mr-1" style={{ color: "#c4956a" }} />
                    </th>
                    {weekDays.map((d, i) => {
                      const isToday = dateStr(d) === todayStr;
                      return (
                        <th key={i} className="text-center text-xs font-bold uppercase tracking-wide px-2 py-2.5"
                          style={{ color: isToday ? "#c4956a" : "#000" }}>
                          {tk(DAY_KEYS[i])} {d.getDate()}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {members.length === 0 && (
                    <tr><td colSpan={8} className="p-6 text-sm text-black">{loading ? "…" : tk("staff_no_members")}</td></tr>
                  )}
                  {members.map((m) => (
                    <tr key={m.id} className="border-t" style={{ borderColor: "#f0e5d4" }}>
                      <td className="px-3 py-2 sticky left-0 z-10 w-40" style={{ background: "#fcf6ed" }}>
                        <p className="text-sm font-bold text-black truncate max-w-[140px]">{m.name || m.email || "—"}</p>
                        <p className="text-[11px]" style={{ color: "#8b6540" }}>
                          {m.role === "owner" ? "Admin" : m.role === "manager" ? tk("team_role_responsabile") : tk("team_role_staff")}
                        </p>
                      </td>
                      {weekDays.map((d, i) => {
                        const ds = dateStr(d);
                        const cellShifts = shiftsFor(m.id, ds);
                        return (
                          <td key={i} className="align-top px-1.5 py-1.5 min-w-[96px]"
                            style={ds === todayStr ? { background: "rgba(196,149,106,0.06)" } : undefined}>
                            <div className="space-y-1">
                              {cellShifts.map((s) => {
                                const mine = m.id === myMemberId;
                                const clickable = isManager || mine;
                                return (
                                  <button
                                    key={s.id}
                                    disabled={!clickable}
                                    onClick={() =>
                                      isManager
                                        ? setShiftModal({ mode: "edit", shift: s })
                                        : mine
                                          ? setRequestModal({ type: "swap", shift: s })
                                          : undefined
                                    }
                                    className={`w-full text-left rounded-lg px-2 py-1 ${clickable ? "cursor-pointer" : "cursor-default"}`}
                                    style={{ background: bandColors[s.band].bg, color: bandColors[s.band].fg }}
                                  >
                                    <span className="flex items-center gap-1 text-[11px] font-bold tabular-nums">
                                      {bandIcon(s.band)} {hhmm(s.start_time)}–{hhmm(s.end_time)}
                                    </span>
                                    {s.role_note && <span className="block text-[10px] truncate">{s.role_note}</span>}
                                  </button>
                                );
                              })}
                              {isManager && (
                                <button
                                  onClick={() => setShiftModal({ mode: "create", memberId: m.id, date: ds })}
                                  className="w-full rounded-lg border border-dashed py-1 text-black/40 hover:text-black cursor-pointer flex items-center justify-center"
                                  style={{ borderColor: "#e2d5bf" }}
                                  aria-label={tk("staff_add_shift")}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* ── Shift create/edit modal (manager) ── */}
      {shiftModal && activeTenant && (
        <ShiftModal
          t={tk}
          tenantId={activeTenant.id}
          members={members}
          modal={shiftModal}
          onClose={() => setShiftModal(null)}
          onSaved={() => { setShiftModal(null); void refresh(); }}
          onError={setError}
        />
      )}

      {/* ── Waiter request modal ── */}
      {requestModal && myMemberId && activeTenant && (
        <RequestModal
          t={tk}
          tenantId={activeTenant.id}
          myMemberId={myMemberId}
          members={members}
          modal={requestModal}
          onClose={() => setRequestModal(null)}
          onSaved={() => { setRequestModal(null); void refresh(); }}
        />
      )}
    </div>
  );
}

/* ────────────────────────── modals ────────────────────────── */

const OVERLAY = "fixed inset-0 z-50 flex items-center justify-center p-4";
const PANEL = "relative bg-white rounded-2xl w-full max-w-md p-5 border-2";
const INPUT = "w-full rounded-lg border px-3 py-2 text-sm text-black bg-white outline-none";
const INPUT_STYLE = { borderColor: "#e2d5bf" } as const;

function ShiftModal({
  t, tenantId, members, modal, onClose, onSaved, onError,
}: {
  t: (k: string) => string;
  tenantId: string;
  members: Member[];
  modal: { mode: "create"; memberId: string; date: string } | { mode: "edit"; shift: Shift };
  onClose: () => void;
  onSaved: () => void;
  onError: (e: string | null) => void;
}) {
  const editing = modal.mode === "edit" ? modal.shift : null;
  const [memberId, setMemberId] = useState(modal.mode === "edit" ? modal.shift.member_id : modal.memberId);
  const [date, setDate] = useState(modal.mode === "edit" ? modal.shift.work_date : modal.date);
  const [band, setBand] = useState<Shift["band"]>(editing?.band ?? "dinner");
  const [start, setStart] = useState(editing ? hhmm(editing.start_time) : "19:00");
  const [end, setEnd] = useState(editing ? hhmm(editing.end_time) : "23:30");
  const [note, setNote] = useState(editing?.role_note ?? "");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Band presets so two taps schedule a standard shift.
  const applyBand = (b: Shift["band"]) => {
    setBand(b);
    if (b === "lunch") { setStart("12:00"); setEnd("16:00"); }
    else if (b === "dinner") { setStart("19:00"); setEnd("23:30"); }
    else { setStart("12:00"); setEnd("23:30"); }
  };

  const save = async () => {
    setBusy(true);
    setLocalError(null);
    const payload: Record<string, unknown> = {
      tenant_id: tenantId,
      member_id: memberId,
      work_date: date,
      band,
      start_time: start,
      end_time: end,
      role_note: note,
    };
    const res = await fetch("/api/staff/shifts", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing ? { ...payload, shift_id: editing.id } : payload),
    });
    setBusy(false);
    if (res.ok) {
      onError(null);
      onSaved();
    } else {
      const body = await res.json().catch(() => ({}));
      setLocalError(body?.error === "shift_conflict" ? t("staff_conflict") : body?.error || "error");
    }
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    await fetch("/api/staff/shifts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, shift_id: editing.id }),
    });
    setBusy(false);
    onSaved();
  };

  return (
    <div className={OVERLAY} role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={PANEL} style={{ borderColor: "#c4956a" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-black">{editing ? t("staff_edit_shift") : t("staff_add_shift")}</h3>
          <button onClick={onClose} className="text-black/50 hover:text-black cursor-pointer" aria-label="close"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-black mb-1">{t("staff_tab_team")}</label>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name || m.email || m.id.slice(0, 6)}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-black mb-1">{t("settings_management_date")}</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-bold text-black mb-1">{t("staff_band")}</label>
              <select value={band} onChange={(e) => applyBand(e.target.value as Shift["band"])} className={INPUT} style={INPUT_STYLE}>
                <option value="lunch">{t("staff_band_lunch")}</option>
                <option value="dinner">{t("staff_band_dinner")}</option>
                <option value="all">{t("staff_band_all")}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-black mb-1">{t("staff_start")}</label>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-bold text-black mb-1">{t("staff_end")}</label>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-black mb-1">{t("staff_note")}</label>
            <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 60))} placeholder={t("staff_note_ph")} className={INPUT} style={INPUT_STYLE} />
          </div>
          {localError && <p className="text-xs text-red-600">{localError}</p>}
          <div className="flex gap-2 pt-1">
            {editing && (
              <button onClick={remove} disabled={busy}
                className="px-3 py-2 rounded-lg border border-red-500 text-red-600 text-sm font-bold cursor-pointer disabled:opacity-50">
                {t("staff_delete")}
              </button>
            )}
            <button onClick={save} disabled={busy || !memberId || !date}
              className="flex-1 py-2 rounded-lg text-white text-sm font-bold cursor-pointer disabled:opacity-50"
              style={{ background: "#c4956a" }}>
              {busy ? "…" : t("staff_save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RequestModal({
  t, tenantId, myMemberId, members, modal, onClose, onSaved,
}: {
  t: (k: string) => string;
  tenantId: string;
  myMemberId: string;
  members: Member[];
  modal: { type: "time_off" } | { type: "swap"; shift: Shift };
  onClose: () => void;
  onSaved: () => void;
}) {
  const isSwap = modal.type === "swap";
  const [date, setDate] = useState(isSwap ? modal.shift.work_date : "");
  const [colleague, setColleague] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const colleagues = members.filter((m) => m.id !== myMemberId);

  const send = async () => {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/staff/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        type: modal.type,
        work_date: date,
        reason,
        ...(isSwap ? { target_shift_id: modal.shift.id, target_member_id: colleague } : {}),
      }),
    });
    setBusy(false);
    if (res.ok) onSaved();
    else {
      const body = await res.json().catch(() => ({}));
      setErr(body?.error || "error");
    }
  };

  return (
    <div className={OVERLAY} role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={PANEL} style={{ borderColor: "#c4956a" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-black">
            {isSwap ? t("staff_request_swap") : t("staff_request_time_off")}
          </h3>
          <button onClick={onClose} className="text-black/50 hover:text-black cursor-pointer" aria-label="close"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          {isSwap ? (
            <>
              <p className="text-sm text-black">
                {modal.shift.work_date} · {hhmm(modal.shift.start_time)}–{hhmm(modal.shift.end_time)}
              </p>
              <div>
                <label className="block text-xs font-bold text-black mb-1">{t("staff_request_colleague")}</label>
                <select value={colleague} onChange={(e) => setColleague(e.target.value)} className={INPUT} style={INPUT_STYLE}>
                  <option value="">—</option>
                  {colleagues.map((m) => (
                    <option key={m.id} value={m.id}>{m.name || m.email || m.id.slice(0, 6)}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-bold text-black mb-1">{t("settings_management_date")}</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-black mb-1">{t("staff_request_reason")}</label>
            <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} className={INPUT} style={INPUT_STYLE} />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button
            onClick={send}
            disabled={busy || !date || (isSwap && !colleague)}
            className="w-full py-2 rounded-lg text-white text-sm font-bold cursor-pointer disabled:opacity-50"
            style={{ background: "#c4956a" }}
          >
            {busy ? "…" : t("staff_send")}
          </button>
        </div>
      </div>
    </div>
  );
}
