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
  CheckCircle2, XCircle, Hourglass, Users, Lock, Send, CalendarRange, CopyPlus,
  Plane, Thermometer, UserMinus, CalendarOff, User, Repeat,
  DollarSign, ChevronUp, ChevronDown,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { createClient } from "@/lib/supabase/client";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";
import { hasActivePlan } from "@/lib/billing/entitlements";
import { bandPreset, datesInRange, type AbsenceKind } from "@/lib/staff/shift-rules";
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
  reason_kind: AbsenceKind | null;
  work_date: string;
  end_date: string | null;
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

// Short weekday labels for the bulk tool's day pills, Monday-first (0=Mon …
// 6=Sun). Deliberately short (not the full settings_day_* names) so the pills
// stay compact across locales.
const WEEKDAY_PILL_KEYS = [
  "staff_wd_mon", "staff_wd_tue", "staff_wd_wed", "staff_wd_thu",
  "staff_wd_fri", "staff_wd_sat", "staff_wd_sun",
] as const;

const ABSENCE_LABEL_KEY: Record<AbsenceKind, string> = {
  vacation: "staff_absence_vacation",
  sick: "staff_absence_sick",
  personal: "staff_absence_personal",
  other: "staff_absence_other",
};

export default function StaffPage() {
  const { t } = useLanguage();
  const { activeTenant, activeRole } = useTenant();
  const supabase = useMemo(() => createClient(), []);
  const tk = (k: string) => t(k as keyof Dictionary);

  const isManager = activeRole === "owner" || activeRole === "manager" || activeRole === "platform_admin";
  const isOwner = activeRole === "owner" || activeRole === "platform_admin";

  const [tab, setTab] = useState<"shifts" | "requests" | "team">("shifts");
  // A waiter opens the page to answer one question — "when do I work?" — so the
  // rota defaults to a personal list for them. The full team grid (7 columns ×
  // N members, unreadable on a phone) stays one tap away.
  const [rotaView, setRotaView] = useState<"mine" | "team">(isManager ? "team" : "mine");
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
  // Manager accelerators
  const [bulkOpen, setBulkOpen] = useState(false);
  const [absenceModal, setAbsenceModal] = useState<{ memberId?: string; date?: string } | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

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

  // Approved absences expanded to the set of (member, date) pairs they cover, so
  // the grid can show "off" on every day of a holiday range in one glance.
  const absenceByCell = useMemo(() => {
    const map = new Map<string, AbsenceKind>(); // key `${memberId}|${date}`
    for (const r of requests) {
      if (r.type !== "time_off" || r.status !== "approved") continue;
      for (const d of datesInRange(r.work_date, r.end_date ?? r.work_date)) {
        map.set(`${r.member_id}|${d}`, r.reason_kind ?? "other");
      }
    }
    return map;
  }, [requests]);

  const absenceFor = useCallback(
    (memberId: string, date: string) => absenceByCell.get(`${memberId}|${date}`) ?? null,
    [absenceByCell],
  );

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  // The signed-in member's own week, one entry per day — what the "mine" rota
  // view renders. Empty days are kept here and skipped at render time so the
  // "nothing this week" check stays a single pass.
  const myWeek = useMemo(
    () =>
      weekDays.map((date, idx) => {
        const ds = dateStr(date);
        return {
          idx,
          date,
          ds,
          shifts: myMemberId ? shiftsFor(myMemberId, ds) : [],
          absence: myMemberId ? absenceFor(myMemberId, ds) : null,
        };
      }),
    [weekDays, myMemberId, shiftsFor, absenceFor],
  );

  // Copy the previous week's rota onto the visible week (add-only).
  const copyPreviousWeek = useCallback(async () => {
    if (!activeTenant?.id) return;
    const prevStart = new Date(weekStart);
    prevStart.setDate(prevStart.getDate() - 7);
    setCopyBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/staff/shifts/copy-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: activeTenant.id,
          source_week_start: dateStr(prevStart),
          target_week_start: dateStr(weekStart),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlash(tk("staff_copy_error"));
      } else if (body.empty || (body.created === 0 && body.skipped === 0)) {
        setFlash(tk("staff_copy_empty"));
      } else {
        setFlash(tk("staff_copy_done").replace("{created}", String(body.created)).replace("{skipped}", String(body.skipped)));
        void refresh();
      }
    } catch {
      setFlash(tk("staff_copy_error"));
    } finally {
      setCopyBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant?.id, weekStart, refresh]);

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

  const absenceIcon = (k: AbsenceKind) =>
    k === "vacation" ? <Plane className="w-3 h-3" />
    : k === "sick" ? <Thermometer className="w-3 h-3" />
    : k === "personal" ? <UserMinus className="w-3 h-3" />
    : <CalendarOff className="w-3 h-3" />;

  const absenceStyle = (k: AbsenceKind): { bg: string; fg: string } =>
    k === "vacation" ? { bg: "rgba(37,99,235,0.12)", fg: "#1d4ed8" }
    : k === "sick" ? { bg: "rgba(220,38,38,0.10)", fg: "#b91c1c" }
    : k === "personal" ? { bg: "rgba(124,92,60,0.12)", fg: "#7c5c3c" }
    : { bg: "rgba(107,114,128,0.12)", fg: "#4b5563" };

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
                    <p className="text-sm font-bold text-black flex items-center flex-wrap gap-x-1">
                      {r.type === "time_off" && r.reason_kind && (
                        <span className="inline-flex items-center gap-1 mr-1" style={{ color: absenceStyle(r.reason_kind).fg }}>
                          {absenceIcon(r.reason_kind)}
                        </span>
                      )}
                      {memberName(r.member_id)}
                      <span className="font-medium"> · {r.type === "time_off"
                        ? (r.reason_kind ? tk(ABSENCE_LABEL_KEY[r.reason_kind]) : tk("staff_type_time_off"))
                        : tk("staff_type_swap")}</span>
                      <span className="font-medium"> · {r.end_date && r.end_date !== r.work_date ? `${r.work_date} → ${r.end_date}` : r.work_date}</span>
                    </p>
                    {r.type === "swap" && (
                      <p className="text-xs text-black mt-0.5">→ {memberName(r.target_member_id)}</p>
                    )}
                    {r.reason && <p className="text-xs italic mt-0.5" style={{ color: "#8b6540" }}>“{r.reason}”</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {statusChip(r.status)}
                    {/* Manager can delete an absence they recorded (approved time_off). */}
                    {isManager && r.status === "approved" && r.type === "time_off" && r.reason_kind && (
                      <button
                        onClick={async () => {
                          if (!confirm(tk("staff_absence_delete_confirm"))) return;
                          await fetch("/api/staff/absences", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ tenant_id: activeTenant!.id, request_id: r.id }),
                          });
                          void refresh();
                        }}
                        className="text-red-500 hover:text-red-700 cursor-pointer"
                        title={tk("staff_delete")}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
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
          {/* Week navigation + manager accelerators */}
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

            {/* Mine / Team switch — everyone with a membership row can flip it.
                A waiter lands on "mine"; a manager lands on the full grid. */}
            {myMemberId && (
              <div className="inline-flex rounded-xl border overflow-hidden bg-white/70" style={{ borderColor: "#c4956a" }}>
                {([
                  ["mine", tk("staff_view_mine"), <User key="i" className="w-4 h-4" />],
                  ["team", tk("staff_view_team"), <Users key="i" className="w-4 h-4" />],
                ] as Array<[typeof rotaView, string, React.ReactNode]>).map(([key, label, icon]) => (
                  <button
                    key={key}
                    onClick={() => setRotaView(key)}
                    className={`px-3 py-2 text-sm cursor-pointer inline-flex items-center gap-1.5 ${rotaView === key ? "text-white font-bold" : "text-black"}`}
                    style={rotaView === key ? { background: "#c4956a" } : undefined}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            )}

            {isManager && (
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <button
                  onClick={() => setBulkOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold rounded-xl text-white cursor-pointer"
                  style={{ background: "#c4956a" }}
                >
                  <CalendarRange className="w-4 h-4" /> {tk("staff_bulk_open")}
                </button>
                <button
                  onClick={copyPreviousWeek}
                  disabled={copyBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white/70 disabled:opacity-50"
                  style={{ borderColor: "#c4956a" }}
                  title={tk("staff_copy_prev_hint")}
                >
                  <CopyPlus className="w-4 h-4" /> {copyBusy ? "…" : tk("staff_copy_prev")}
                </button>
                <button
                  onClick={() => setAbsenceModal({})}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white/70"
                  style={{ borderColor: "#c4956a" }}
                >
                  <CalendarOff className="w-4 h-4" /> {tk("staff_absence_open")}
                </button>
              </div>
            )}
          </div>

          {flash && (
            <div className="rounded-xl border px-4 py-2.5 text-sm font-medium text-black bg-white/70 flex items-center justify-between gap-3" style={{ borderColor: "#c4956a" }}>
              <span>{flash}</span>
              <button onClick={() => setFlash(null)} className="text-black/50 hover:text-black cursor-pointer" aria-label="dismiss"><X className="w-4 h-4" /></button>
            </div>
          )}

          {/* Labor cost from the rota — managers only (wages are owner/manager). */}
          {isManager && (
            <LaborCostPanel
              t={tk}
              supabase={supabase}
              tenantId={activeTenant!.id}
              members={members}
              shifts={shifts}
              weekFrom={weekFrom}
              weekTo={weekTo}
              onFlash={setFlash}
            />
          )}

          {/* ── "My shifts": one card per day of the visible week, so a waiter on a
                 phone reads their week top-to-bottom instead of scrolling a grid
                 sideways. Tapping a shift opens the same swap request modal. ── */}
          {rotaView === "mine" && myMemberId && (
            <div className={`${CARD} overflow-hidden`} style={CARD_STYLE}>
              {myWeek.every((d) => d.shifts.length === 0 && !d.absence) ? (
                <p className="p-6 text-sm text-black">{loading ? "…" : tk("staff_my_week_empty")}</p>
              ) : (
                <div className="divide-y" style={{ borderColor: "#f0e5d4" }}>
                  {myWeek.map((day) => {
                    if (day.shifts.length === 0 && !day.absence) return null;
                    const isToday = day.ds === todayStr;
                    return (
                      <div
                        key={day.ds}
                        className="p-4 flex flex-wrap items-center gap-x-4 gap-y-2"
                        style={isToday ? { background: "rgba(196,149,106,0.06)" } : undefined}
                      >
                        <div className="w-28 shrink-0">
                          <p className="text-sm font-bold" style={{ color: isToday ? "#c4956a" : "#000" }}>
                            {tk(DAY_KEYS[day.idx])}
                          </p>
                          <p className="text-xs tabular-nums text-black">
                            {day.date.getDate()}/{pad(day.date.getMonth() + 1)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                          {day.absence && (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold"
                              style={{ background: absenceStyle(day.absence).bg, color: absenceStyle(day.absence).fg }}
                            >
                              {absenceIcon(day.absence)} {tk(ABSENCE_LABEL_KEY[day.absence])}
                            </span>
                          )}
                          {day.shifts.map((s) => (
                            <button
                              key={s.id}
                              onClick={() =>
                                isManager
                                  ? setShiftModal({ mode: "edit", shift: s })
                                  : setRequestModal({ type: "swap", shift: s })
                              }
                              className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 cursor-pointer"
                              style={{ background: bandColors[s.band].bg, color: bandColors[s.band].fg }}
                              title={tk("staff_type_swap")}
                            >
                              <span className="inline-flex items-center gap-1 text-sm font-bold tabular-nums">
                                {bandIcon(s.band)} {hhmm(s.start_time)}–{hhmm(s.end_time)}
                              </span>
                              {s.role_note && <span className="text-xs truncate max-w-[140px]">{s.role_note}</span>}
                              {!isManager && <Repeat className="w-3.5 h-3.5 opacity-60" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Rota grid — horizontally scrollable on mobile */}
          {rotaView === "team" && (
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
                        const absence = absenceFor(m.id, ds);
                        return (
                          <td key={i} className="align-top px-1.5 py-1.5 min-w-[96px]"
                            style={ds === todayStr ? { background: "rgba(196,149,106,0.06)" } : undefined}>
                            <div className="space-y-1">
                              {absence && (
                                <div className="w-full rounded-lg px-2 py-1 flex items-center gap-1 text-[11px] font-bold"
                                  style={{ background: absenceStyle(absence).bg, color: absenceStyle(absence).fg }}>
                                  {absenceIcon(absence)} {tk(ABSENCE_LABEL_KEY[absence])}
                                </div>
                              )}
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
          )}
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

      {/* ── Bulk assign panel (manager) ── */}
      {bulkOpen && activeTenant && (
        <BulkAssignPanel
          t={tk}
          tenantId={activeTenant.id}
          members={members}
          weekStart={weekStart}
          weekDays={weekDays}
          onClose={() => setBulkOpen(false)}
          onDone={(created, skipped) => {
            setBulkOpen(false);
            setFlash(tk("staff_bulk_done").replace("{created}", String(created)).replace("{skipped}", String(skipped)));
            void refresh();
          }}
        />
      )}

      {/* ── Absence modal (manager records ferie/malattia/imprevisto) ── */}
      {absenceModal && activeTenant && (
        <AbsenceModal
          t={tk}
          tenantId={activeTenant.id}
          members={members}
          preset={absenceModal}
          onClose={() => setAbsenceModal(null)}
          onSaved={(days) => {
            setAbsenceModal(null);
            setFlash(tk("staff_absence_done").replace("{days}", String(days)));
            void refresh();
          }}
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

/* ──────────────────── Bulk assign (manager) ──────────────────── */
// One band/time → many members × many weekdays of the visible week, in a single
// action. Replaces the "click every empty cell" grind. Cells that already have
// an overlapping shift are skipped server-side, so it's safe to re-run.
function BulkAssignPanel({
  t, tenantId, members, weekStart, weekDays, onClose, onDone,
}: {
  t: (k: string) => string;
  tenantId: string;
  members: Member[];
  weekStart: Date;
  weekDays: Date[];
  onClose: () => void;
  onDone: (created: number, skipped: number) => void;
}) {
  const [selMembers, setSelMembers] = useState<Set<string>>(() => new Set(members.map((m) => m.id)));
  const [selDays, setSelDays] = useState<Set<number>>(() => new Set([0, 1, 2, 3, 4])); // Mon–Fri default
  const [band, setBand] = useState<Shift["band"]>("dinner");
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("23:30");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const applyBand = (b: Shift["band"]) => {
    setBand(b);
    const p = bandPreset(b);
    setStart(p.start_time);
    setEnd(p.end_time);
  };

  const toggleMember = (id: string) =>
    setSelMembers((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleDay = (i: number) =>
    setSelDays((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const allMembersSelected = selMembers.size === members.length && members.length > 0;
  const toggleAllMembers = () =>
    setSelMembers(allMembersSelected ? new Set() : new Set(members.map((m) => m.id)));

  // Concrete dates for the picked weekdays in the visible week.
  const dates = useMemo(
    () => weekDays.filter((_, i) => selDays.has(i)).map((d) => dateStr(d)),
    [weekDays, selDays],
  );
  const pairCount = selMembers.size * dates.length;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/staff/shifts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          member_ids: [...selMembers],
          dates,
          band,
          start_time: start,
          end_time: end,
          role_note: note,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error === "shift_conflict" ? t("staff_conflict") : (body?.error || "error"));
        return;
      }
      onDone(body.created ?? 0, body.skipped ?? 0);
    } catch (e: any) {
      setErr(e?.message || "error");
    } finally {
      setBusy(false);
    }
  };

  const weekLabel = `${weekDays[0].getDate()}/${pad(weekDays[0].getMonth() + 1)} — ${weekDays[6].getDate()}/${pad(weekDays[6].getMonth() + 1)}`;

  return (
    <div className={OVERLAY} role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-lg border-2 max-h-[92vh] overflow-y-auto" style={{ borderColor: "#c4956a" }}>
        <div className="flex items-center justify-between p-5 pb-3 sticky top-0 bg-white z-10 border-b" style={{ borderColor: "#f0e5d4" }}>
          <div>
            <h3 className="text-lg font-bold text-black flex items-center gap-2"><CalendarRange className="w-5 h-5" /> {t("staff_bulk_title")}</h3>
            <p className="text-xs mt-0.5" style={{ color: "#8b6540" }}>{t("staff_bulk_week")} {weekLabel}</p>
          </div>
          <button onClick={onClose} className="text-black/50 hover:text-black cursor-pointer" aria-label="close"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 pt-4 space-y-4">
          {/* Members */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-black">{t("staff_bulk_members")}</label>
              <button onClick={toggleAllMembers} className="text-xs font-bold cursor-pointer" style={{ color: "#c4956a" }}>
                {allMembersSelected ? t("staff_bulk_none") : t("staff_bulk_all")}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => {
                const on = selMembers.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMember(m.id)}
                    className="px-2.5 py-1.5 rounded-lg border-2 text-sm font-medium cursor-pointer text-black"
                    style={on ? { borderColor: "#c4956a", background: "rgba(196,149,106,0.15)" } : { borderColor: "#e2d5bf", opacity: 0.7 }}
                  >
                    {on ? <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" style={{ color: "#c4956a" }} /> : null}
                    {m.name || m.email || m.id.slice(0, 6)}
                  </button>
                );
              })}
              {members.length === 0 && <span className="text-sm text-black">{t("staff_no_members")}</span>}
            </div>
          </div>

          {/* Weekdays */}
          <div>
            <label className="block text-xs font-bold text-black mb-1.5">{t("staff_bulk_days")}</label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_PILL_KEYS.map((k, i) => {
                const on = selDays.has(i);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className="min-w-[3rem] px-1 h-10 rounded-lg border-2 text-sm font-bold cursor-pointer text-black whitespace-nowrap"
                    style={on ? { borderColor: "#c4956a", background: "rgba(196,149,106,0.15)" } : { borderColor: "#e2d5bf", opacity: 0.6 }}
                  >
                    {t(k)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Band + times */}
          <div className="grid grid-cols-3 gap-3">
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

          {err && <p className="text-xs text-red-600">{err}</p>}

          <button
            onClick={submit}
            disabled={busy || pairCount === 0}
            className="w-full py-2.5 rounded-lg text-white text-sm font-bold cursor-pointer disabled:opacity-50"
            style={{ background: "#c4956a" }}
          >
            {busy ? "…" : pairCount === 0 ? t("staff_bulk_pick") : t("staff_bulk_create").replace("{n}", String(pairCount))}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────── Absence (manager) ──────────────────── */
// "Marco is on holiday next week" / "Ana called in sick." Records an approved
// time_off for a member over a date range and cancels their shifts across it.
function AbsenceModal({
  t, tenantId, members, preset, onClose, onSaved,
}: {
  t: (k: string) => string;
  tenantId: string;
  members: Member[];
  preset: { memberId?: string; date?: string };
  onClose: () => void;
  onSaved: (days: number) => void;
}) {
  const [memberId, setMemberId] = useState(preset.memberId || members[0]?.id || "");
  const [kind, setKind] = useState<AbsenceKind>("vacation");
  const [from, setFrom] = useState(preset.date || "");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dayCount = from ? datesInRange(from, to || from).length : 0;

  const KIND_OPTS: Array<[AbsenceKind, string]> = [
    ["vacation", "staff_absence_vacation"],
    ["sick", "staff_absence_sick"],
    ["personal", "staff_absence_personal"],
    ["other", "staff_absence_other"],
  ];

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/staff/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          member_id: memberId,
          reason_kind: kind,
          work_date: from,
          end_date: to && to !== from ? to : null,
          reason,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body?.error || "error"); return; }
      onSaved(dayCount);
    } catch (e: any) {
      setErr(e?.message || "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={OVERLAY} role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={PANEL} style={{ borderColor: "#c4956a" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-black flex items-center gap-2"><CalendarOff className="w-5 h-5" /> {t("staff_absence_title")}</h3>
          <button onClick={onClose} className="text-black/50 hover:text-black cursor-pointer" aria-label="close"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-black mb-1">{t("staff_tab_team")}</label>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email || m.id.slice(0, 6)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-black mb-1">{t("staff_absence_reason")}</label>
            <div className="grid grid-cols-2 gap-2">
              {KIND_OPTS.map(([k, labelKey]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className="px-3 py-2 rounded-lg border-2 text-sm font-bold cursor-pointer text-black text-left"
                  style={kind === k ? { borderColor: "#c4956a", background: "rgba(196,149,106,0.15)" } : { borderColor: "#e2d5bf", opacity: 0.75 }}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-black mb-1">{t("staff_absence_from")}</label>
              <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to && to < e.target.value) setTo(""); }} className={INPUT} style={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-bold text-black mb-1">{t("staff_absence_to")}</label>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </div>
          </div>
          <p className="text-xs" style={{ color: "#8b6540" }}>{t("staff_absence_to_hint")}</p>
          <div>
            <label className="block text-xs font-bold text-black mb-1">{t("staff_request_reason")}</label>
            <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} className={INPUT} style={INPUT_STYLE} />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button
            onClick={save}
            disabled={busy || !memberId || !from}
            className="w-full py-2 rounded-lg text-white text-sm font-bold cursor-pointer disabled:opacity-50"
            style={{ background: "#c4956a" }}
          >
            {busy ? "…" : dayCount > 1 ? t("staff_absence_save_range").replace("{days}", String(dayCount)) : t("staff_absence_save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Labor cost from the rota ────────────────────────────────────────────────
// Manager-only. Reads each member's hourly wage from staff_pay (owner/manager
// RLS), costs the visible week straight from the loaded shifts, and — on save —
// persists any rate edits and recomputes labor_cost server-side so the P&L picks
// up the real labor line. Wages never touch tenant_members, so a waiter's client
// can't read them.
function LaborCostPanel({
  t, supabase, tenantId, members, shifts, weekFrom, weekTo, onFlash,
}: {
  t: (k: string) => string;
  supabase: ReturnType<typeof createClient>;
  tenantId: string;
  members: Member[];
  shifts: Shift[];
  weekFrom: string;
  weekTo: string;
  onFlash: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);

  // Load wages once (and when the roster changes). staff_pay is manager-gated.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("staff_pay").select("member_id, hourly_rate").eq("tenant_id", tenantId);
      if (cancelled) return;
      const map: Record<string, number | null> = {};
      for (const r of data || []) map[(r as any).member_id] = (r as any).hourly_rate == null ? null : Number((r as any).hourly_rate);
      setSaved(map);
      setRates(Object.fromEntries(members.map((m) => [m.id, map[m.id] != null ? String(map[m.id]) : ""])));
    })();
    return () => { cancelled = true; };
  }, [supabase, tenantId, members]);

  const hoursOf = (start: string, end: string) => {
    const toH = (x: string) => { const [h, mm] = x.split(":").map((n) => parseInt(n, 10)); return (h || 0) + (mm || 0) / 60; };
    let h = toH(end) - toH(start);
    if (h <= 0) h += 24;
    return h;
  };

  const perMember = useMemo(() => {
    const acc = new Map<string, { hours: number }>();
    for (const s of shifts) {
      if (s.status !== "scheduled") continue;
      const cur = acc.get(s.member_id) || { hours: 0 };
      cur.hours += hoursOf(s.start_time, s.end_time);
      acc.set(s.member_id, cur);
    }
    return acc;
  }, [shifts]);

  const rateNum = (id: string) => { const v = parseFloat((rates[id] ?? "").replace(",", ".")); return Number.isFinite(v) ? v : 0; };
  const weekTotal = members.reduce((s, m) => s + (perMember.get(m.id)?.hours || 0) * rateNum(m.id), 0);
  const weekHours = members.reduce((s, m) => s + (perMember.get(m.id)?.hours || 0), 0);
  const fmt = (n: number) => `€ ${n.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const anyRate = members.some((m) => rateNum(m.id) > 0);

  const save = async () => {
    setBusy(true);
    try {
      // Persist changed rates (upsert one row per edited member).
      const changed = members.filter((m) => {
        const now = (rates[m.id] ?? "").trim();
        const before = saved[m.id] != null ? String(saved[m.id]) : "";
        return now !== before;
      });
      for (const m of changed) {
        const v = (rates[m.id] ?? "").trim();
        const val = v === "" ? null : rateNum(m.id);
        await supabase.from("staff_pay").upsert(
          { tenant_id: tenantId, member_id: m.id, hourly_rate: val, updated_at: new Date().toISOString() },
          { onConflict: "tenant_id,member_id" },
        );
      }
      setSaved(Object.fromEntries(members.map((m) => [m.id, (rates[m.id] ?? "").trim() === "" ? null : rateNum(m.id)])));

      // Recompute labor_cost over a wide window so the P&L's 7/30/90 views fill.
      const today = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const to = weekTo > today ? weekTo : today;
      const res = await fetch("/api/staff/labor-cost/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, from: from < weekFrom ? from : weekFrom, to }),
      });
      const json = await res.json().catch(() => ({}));
      onFlash(res.ok
        ? (t("staff_labor_saved") || "Costo del lavoro aggiornato nel Conto Economico ({n} giorni).").replace("{n}", String(json.written ?? 0))
        : (t("staff_labor_error") || "Aggiornamento non riuscito."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border bg-white/70" style={{ borderColor: "#d9c3a3" }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
        <span className="flex items-center gap-2 text-sm font-bold text-black">
          <DollarSign className="w-4 h-4" /> {t("staff_labor_title") || "Costo del lavoro"}
        </span>
        <span className="flex items-center gap-3">
          <span className="text-sm font-bold text-black tabular-nums">{fmt(weekTotal)} <span className="font-normal text-black/70">/ {t("staff_labor_week") || "settimana"}</span></span>
          {open ? <ChevronUp className="w-4 h-4 text-black" /> : <ChevronDown className="w-4 h-4 text-black" />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "#e0d0b8" }}>
          {!anyRate && (
            <p className="text-xs text-black pt-3">{t("staff_labor_hint") || "Imposta la paga oraria di ciascuno per calcolare il costo dai turni e portarlo nel Conto Economico."}</p>
          )}
          <div className="overflow-x-auto pt-3">
            <table className="w-full text-sm" style={{ minWidth: 460 }}>
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-black">
                  <th className="py-2 pr-3">{t("staff_labor_member") || "Membro"}</th>
                  <th className="py-2 pr-3 text-right">{t("staff_labor_rate") || "Paga oraria"}</th>
                  <th className="py-2 pr-3 text-right">{t("staff_labor_hours") || "Ore/sett."}</th>
                  <th className="py-2 text-right">{t("staff_labor_cost") || "Costo/sett."}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const hrs = perMember.get(m.id)?.hours || 0;
                  return (
                    <tr key={m.id} className="text-black" style={{ borderTop: "1px solid #efe3cf" }}>
                      <td className="py-2 pr-3">{m.name || m.email || "—"}</td>
                      <td className="py-2 pr-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <span className="text-black/60">€</span>
                          <input
                            type="number" inputMode="decimal" min={0} step="0.5"
                            value={rates[m.id] ?? ""}
                            onChange={(e) => setRates((r) => ({ ...r, [m.id]: e.target.value }))}
                            className="w-20 rounded-lg border px-2 py-1 text-black bg-white/80 text-right"
                            style={{ borderColor: "#c4956a" }}
                            placeholder="—"
                          />
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{hrs > 0 ? `${hrs.toFixed(1)}h` : "—"}</td>
                      <td className="py-2 text-right tabular-nums font-bold">{fmt(hrs * rateNum(m.id))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-xs text-black">
              {weekHours.toFixed(0)}h · {t("staff_labor_month_est") || "stima mese"} ≈ {fmt(weekTotal * 4.333)}
            </div>
            <button
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl text-white cursor-pointer disabled:opacity-50"
              style={{ background: "#c4956a" }}
            >
              {busy ? "…" : t("staff_labor_save") || "Salva e aggiorna Conto Economico"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
