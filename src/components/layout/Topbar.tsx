"use client";

import { Bell, Menu, Phone, MessageSquare, Globe, X, Calendar, ClipboardList, AlertTriangle, WifiOff } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useNetworkStatus } from "@/lib/contexts/NetworkStatusContext";
import { tenantHasLocaleSwitcher } from "@/lib/tenants/legacy-locale";
import { useAuth } from "@/lib/contexts/AuthContext";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeLocal } from "@/lib/safe-storage";

interface Notification {
  id: string;
  type: "reservation" | "waitlist" | "conversation" | "incident";
  message: string;
  time: string;
  read: boolean;
  href: string;
  source?: "ai_voice" | "ai_chat" | "web" | "staff" | null;
}

// Per-type notification icon (lucide, consistent with the rest of the CRM) in a
// soft tinted badge — replaces the old emoji glyphs.
function NotifIcon({ type }: { type: Notification["type"] }) {
  const map = {
    incident: { Icon: AlertTriangle, bg: "bg-red-50", fg: "text-red-600", ring: "ring-red-200" },
    waitlist: { Icon: ClipboardList, bg: "bg-amber-50", fg: "text-amber-600", ring: "ring-amber-200" },
    reservation: { Icon: Calendar, bg: "bg-terracotta-50", fg: "text-terracotta-600", ring: "ring-terracotta-200" },
    conversation: { Icon: MessageSquare, bg: "bg-indigo-50", fg: "text-indigo-600", ring: "ring-indigo-200" },
  } as const;
  const { Icon, bg, fg, ring } = map[type] ?? map.conversation;
  return (
    <span className={`inline-flex items-center justify-center h-7 w-7 rounded-lg ring-1 flex-shrink-0 ${bg} ${fg} ${ring}`}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

interface TopbarProps {
  onMenuToggle?: () => void;
}

export function Topbar({ onMenuToggle }: TopbarProps) {
  const { t, language, setLanguage } = useLanguage();
  const { activeTenant } = useTenant();
  // PICNIC (the legacy template tenant) keeps an in-app CRM language switcher so
  // it can be demoed in any of the four languages; every real tenant's language
  // stays fixed to crm_locale. See src/lib/tenants/legacy-locale.ts.
  const showLocaleSwitcher = tenantHasLocaleSwitcher(activeTenant?.slug);
  const { user, loading: authLoading } = useAuth();
  const { online } = useNetworkStatus();
  const router = useRouter();
  const [isClient, setIsClient] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const pushNotification = (notif: Notification, ts: number = Date.now()) => {
    // Suppress anything cleared via "Cancella tutto" or dismissed individually.
    if (isCleared(notif.id, ts)) return;
    setNotifications(prev => {
      if (prev.some(p => p.id === notif.id)) return prev;
      return [notif, ...prev].slice(0, 20);
    });
    if (seenIdsRef.current.has(notif.id)) return;
    seenIdsRef.current.add(notif.id);
    setFreshIds(prev => {
      const next = new Set(prev);
      next.add(notif.id);
      return next;
    });
    setTimeout(() => {
      setFreshIds(prev => {
        if (!prev.has(notif.id)) return prev;
        const next = new Set(prev);
        next.delete(notif.id);
        return next;
      });
    }, 2700);
  };

  // Persisted notifications are scoped PER TENANT. A single global key leaked
  // one account's notifications into another when the same browser switched
  // tenants (the realtime channels are already tenant-filtered; only this
  // stored copy wasn't). Re-load — and reset in-memory state — whenever the
  // active tenant changes so account A's items never show under account B.
  const notifKey = activeTenant?.id ? `crm_notifications_${activeTenant.id}` : null;
  // "Cancella tutto" can't delete the source rows (notifications are derived from
  // reservations/waitlist/audit_events on every fetch), so a plain setNotifications([])
  // was instantly undone by the next catch-up / realtime event. We persist instead a
  // "cleared at" watermark + a set of individually-dismissed ids, and filter both the
  // catch-up query results and realtime events against them. Same per-tenant scoping.
  const clearedKey = activeTenant?.id ? `crm_notif_cleared_${activeTenant.id}` : null;
  const dismissedKey = activeTenant?.id ? `crm_notif_dismissed_${activeTenant.id}` : null;
  const clearedAtRef = useRef<number>(0);
  const dismissedRef = useRef<Set<string>>(new Set());

  // Returns true when a notification should be hidden: dismissed by id, or its source
  // event happened at/before the last "Cancella tutto". `ts` is the event timestamp (ms).
  const isCleared = (id: string, ts: number) =>
    dismissedRef.current.has(id) || (clearedAtRef.current > 0 && ts <= clearedAtRef.current);

  useEffect(() => {
    setIsClient(true);
    seenIdsRef.current = new Set();
    safeLocal.remove("crm_notifications"); // purge the old un-scoped key (cross-tenant leak)
    // Load the clear watermark + dismissed-id set for the active tenant.
    clearedAtRef.current = clearedKey ? (parseInt(safeLocal.get(clearedKey) || "0", 10) || 0) : 0;
    dismissedRef.current = new Set();
    if (dismissedKey) {
      const rawDismissed = safeLocal.get(dismissedKey);
      if (rawDismissed) { try { dismissedRef.current = new Set(JSON.parse(rawDismissed)); } catch(e) {} }
    }
    if (!notifKey) { setNotifications([]); return; }
    const saved = safeLocal.get(notifKey);
    if (saved) {
      try {
        const parsed: Notification[] = JSON.parse(saved);
        parsed.forEach(n => seenIdsRef.current.add(n.id));
        // Drop anything already dismissed (a stored copy could predate the dismissal).
        setNotifications(parsed.filter(n => !dismissedRef.current.has(n.id)));
        return;
      } catch(e) {}
    }
    setNotifications([]);
  }, [notifKey, clearedKey, dismissedKey]);

  // Clear all: stamp the watermark to now so derived notifications older than this
  // are never re-added, then empty the list. Survives refetch + realtime.
  const clearAllNotifications = () => {
    const now = Date.now();
    clearedAtRef.current = now;
    if (clearedKey) safeLocal.set(clearedKey, String(now));
    setNotifications([]);
  };

  // Dismiss a single notification: remember its id so it isn't re-derived, then drop it.
  const dismissNotification = (id: string) => {
    dismissedRef.current.add(id);
    // Cap the set so it can't grow unbounded; the 24h catch-up window means older ids
    // are no longer queried anyway. Keep the most recent 200.
    if (dismissedRef.current.size > 200) {
      dismissedRef.current = new Set(Array.from(dismissedRef.current).slice(-200));
    }
    if (dismissedKey) safeLocal.set(dismissedKey, JSON.stringify(Array.from(dismissedRef.current)));
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // Save notifications to the tenant-scoped key on change.
  useEffect(() => {
    if (!isClient || !notifKey) return;
    safeLocal.set(notifKey, JSON.stringify(notifications));
  }, [notifications, isClient, notifKey]);

  // Safari suspends background tabs and kills WebSockets, so realtime alone
  // isn't enough — fetch recent activity on mount and on tab re-focus to
  // catch up on anything that happened while the tab was idle/closed.
  useEffect(() => {
    if (!activeTenant?.id || authLoading || !user) return;
    const supabase = createClient();
    let cancelled = false;

    const catchUp = async () => {
      // Offline: skip the wasted fetch (it would just error). Realtime + a fresh
      // catchUp on the next visibility event cover us once we're back online.
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      // Always look back 24h. Using a moving "lastKey" cursor caused voice
      // bookings to be skipped when the cursor was advanced between the
      // realtime delivery window and the next visibility/focus event —
      // dedupe in pushNotification already protects against re-adds.
      const lastKey = `crm_notif_last_${activeTenant.id}`;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const sinceIso = since.toISOString();

      try {
        const [resRes, wlRes, auRes] = await Promise.all([
          supabase.from('reservations')
            .select('id, date, time, party_size, status, source, created_by_type, created_at')
            .eq('tenant_id', activeTenant.id)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(30),
          supabase.from('waitlist_entries')
            .select('id, party_size, date, created_at')
            .eq('tenant_id', activeTenant.id)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(20),
          supabase.from('audit_events')
            .select('id, action, details, created_at')
            .eq('tenant_id', activeTenant.id)
            .eq('action', 'modify_reservation')
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(20),
        ]);
        if (cancelled) return;

        const newNotifs: { n: Notification; ts: number }[] = [];
        (resRes.data || []).forEach((res: any) => {
          if (res.source === 'walk_in' || res.status === 'seated' || res.created_by_type === 'staff') return;
          const isEscalated = res.status === 'escalated';
          const ts = new Date(res.created_at).getTime();
          if (isCleared(res.id, ts)) return;
          newNotifs.push({ ts, n: {
            id: res.id,
            type: isEscalated ? 'incident' : 'reservation',
            message: `${t('topbar_new_reservation')}: ${res.party_size} ${t('topbar_people')} - ${res.date} ${res.time}`,
            time: new Date(res.created_at).toLocaleTimeString(),
            read: false,
            href: isEscalated ? '/pending' : `/reservations?date=${res.date}`,
            source: res.source ?? null,
          } });
        });
        (wlRes.data || []).forEach((entry: any) => {
          const ts = new Date(entry.created_at).getTime();
          if (isCleared(entry.id, ts)) return;
          newNotifs.push({ ts, n: {
            id: entry.id,
            type: 'waitlist',
            message: `${t('topbar_waitlist')}: ${entry.party_size} ${t('topbar_people')} - ${entry.date || ''}`,
            time: new Date(entry.created_at).toLocaleTimeString(),
            read: false,
            href: '/waitlist',
          } });
        });
        (auRes.data || []).forEach((ev: any) => {
          const before = ev.details?.previous || {};
          const upd = ev.details?.updates || {};
          const parts: string[] = [];
          if (upd.date && before.date && upd.date !== before.date) parts.push(`${before.date} → ${upd.date}`);
          if (upd.time && before.time && upd.time !== before.time) parts.push(`${before.time} → ${upd.time}`);
          if (upd.party_size && before.party_size && upd.party_size !== before.party_size) parts.push(`${before.party_size} → ${upd.party_size} ${t('topbar_people')}`);
          const diff = parts.length ? ` (${parts.join(', ')})` : '';
          const goDate = upd.date || before.date || '';
          const ts = new Date(ev.created_at).getTime();
          if (isCleared(ev.id, ts)) return;
          newNotifs.push({ ts, n: {
            id: ev.id,
            type: 'reservation',
            message: `${t('topbar_reservation_modified')}${diff}`,
            time: new Date(ev.created_at).toLocaleTimeString(),
            read: false,
            href: goDate ? `/reservations?date=${goDate}` : '/reservations',
          } });
        });

        if (newNotifs.length > 0) {
          newNotifs.forEach((item, i) => {
            setTimeout(() => pushNotification(item.n, item.ts), i * 180);
          });
        }
        safeLocal.set(lastKey, new Date().toISOString());
      } catch(e) { /* ignore network errors */ }
    };

    catchUp();
    const onVis = () => { if (!document.hidden) catchUp(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [activeTenant?.id, t, user, authLoading]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Lock body scroll when mobile notifications panel is open
  useEffect(() => {
    if (showDropdown && window.innerWidth < 640) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [showDropdown]);

  // Real-time notifications for new reservations
  useEffect(() => {
    if (!activeTenant?.id) return;

    const supabase = createClient();

    const channel = supabase
      .channel('reservations-notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'reservations',
          filter: `tenant_id=eq.${activeTenant.id}`
        },
        (payload: any) => {
          const res = payload.new;
          // Skip walk-in and seated notifications (created manually by staff)
          if (res.source === 'walk_in' || res.status === 'seated' || res.created_by_type === 'staff') return;
          const isEscalated = res.status === 'escalated';
          const notif: Notification = {
            id: res.id,
            type: isEscalated ? "incident" : "reservation",
            message: `${t("topbar_new_reservation")}: ${res.party_size} ${t("topbar_people")} - ${res.date} ${res.time}`,
            time: new Date().toLocaleTimeString(),
            read: false,
            href: isEscalated ? `/pending` : `/reservations?date=${res.date}`,
            source: res.source ?? null,
          };
          pushNotification(notif);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'reservations',
          filter: `tenant_id=eq.${activeTenant.id}`
        },
        (payload: any) => {
          const res = payload.new;
          if (res.status === 'cancelled') {
            const n: Notification = { id: res.id + '-cancel', type: "reservation", message: `${t("topbar_reservation_cancelled")}: ${res.date} ${res.time}`, time: new Date().toLocaleTimeString(), read: false, href: `/reservations?date=${res.date}` };
            pushNotification(n);
          } else if (res.status === 'no_show') {
            const n: Notification = { id: res.id + '-noshow', type: "incident", message: `${t("topbar_noshow")}: ${res.date} ${res.time}`, time: new Date().toLocaleTimeString(), read: false, href: `/reservations?date=${res.date}` };
            pushNotification(n);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'waitlist_entries',
          filter: `tenant_id=eq.${activeTenant.id}`
        },
        (payload: any) => {
          const entry = payload.new;
          const notif: Notification = {
            id: entry.id,
            type: "waitlist",
            message: `${t("topbar_waitlist")}: ${entry.party_size} ${t("topbar_people")} - ${entry.date || ''}`,
            time: new Date().toLocaleTimeString(),
            read: false,
            href: "/waitlist",
          };
          pushNotification(notif);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'audit_events',
          filter: `tenant_id=eq.${activeTenant.id}`
        },
        (payload: any) => {
          const ev = payload.new;
          if (ev.action !== 'modify_reservation') return;
          const before = ev.details?.previous || {};
          const upd = ev.details?.updates || {};
          const parts: string[] = [];
          if (upd.date && before.date && upd.date !== before.date) parts.push(`${before.date} → ${upd.date}`);
          if (upd.time && before.time && upd.time !== before.time) parts.push(`${before.time} → ${upd.time}`);
          if (upd.party_size && before.party_size && upd.party_size !== before.party_size) parts.push(`${before.party_size} → ${upd.party_size} ${t("topbar_people")}`);
          const diff = parts.length ? ` (${parts.join(', ')})` : '';
          const goDate = upd.date || before.date || '';
          const notif: Notification = {
            id: ev.id,
            type: "reservation",
            message: `${t("topbar_reservation_modified")}${diff}`,
            time: new Date().toLocaleTimeString(),
            read: false,
            href: goDate ? `/reservations?date=${goDate}` : `/reservations`,
          };
          pushNotification(notif);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTenant?.id]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const typeIcon = (_type: string) => {
    return "";
  };

  return (
    <header className="h-14 md:h-16 border-b flex items-center justify-between px-3 sm:px-4 md:px-6 lg:px-8" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
      {/* Left side - hamburger on mobile. The impersonation indicator lives in the
          full-width banner above the Topbar (see DashboardLayout). */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onMenuToggle}
          className="md:hidden p-2 -ml-1 hover:bg-[#c4956a]/10 rounded-lg transition-colors"
        >
          <Menu className="h-5 w-5 text-black" />
        </button>
      </div>

      {/* Right side - controls */}
      {/* Language switcher is shown ONLY for the legacy template tenant (PICNIC),
          so it can be demoed in any UI language. Every real tenant's CRM language
          is fixed per tenant (settings.crm_locale), chosen once at onboarding. */}
      <div className="flex items-center space-x-2 sm:space-x-3 md:space-x-4">
        {/* Offline: unmissable but unobtrusive — hidden entirely when online. */}
        {isClient && !online && (
          <div
            className="flex items-center gap-1.5 border-2 rounded-lg px-2 sm:px-2.5 h-8 sm:h-9 text-xs font-semibold text-amber-800"
            style={{ borderColor: "#d97706", background: "rgba(245,158,11,0.12)" }}
            title={t("offline_indicator")}
          >
            <WifiOff className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">{t("offline_indicator")}</span>
          </div>
        )}
        {isClient && showLocaleSwitcher && (
          <div className="flex items-center border-2 rounded-lg px-2 sm:px-3 h-8 sm:h-9" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
            <Globe className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-black mr-1.5 sm:mr-2" />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "es" | "it" | "de")}
              className="bg-transparent text-xs sm:text-sm font-medium text-black outline-none cursor-pointer"
              aria-label="CRM language"
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
              <option value="it">IT</option>
              <option value="de">DE</option>
            </select>
          </div>
        )}

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => {
              setShowDropdown(!showDropdown);
              if (!showDropdown) markAllRead();
            }}
            className="relative flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 text-black hover:text-black rounded-lg border-2 cursor-pointer"
            style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
          >
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center h-4 w-4 sm:h-5 sm:w-5 rounded-full bg-red-500 text-white text-[10px] sm:text-xs font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
            <Bell className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>

          {showDropdown && (
            <>
            {/* Mobile: fixed full-width panel below topbar */}
            <div className="sm:hidden fixed left-0 right-0 top-14 bottom-0 z-50 flex flex-col" style={{ background: 'rgb(252,246,237)' }}>
              <div className="px-4 py-3 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: '#c4956a' }}>
                <span className="text-sm font-semibold text-black">{t("topbar_notifications")}</span>
                {notifications.length > 0 && (
                  <button onClick={clearAllNotifications} className="text-xs text-[#c4956a] hover:text-[#b8845c] cursor-pointer">
                    {t("topbar_clear_all")}
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-black">{t("topbar_no_notifications")}</div>
                ) : notifications.map((n) => {
                  const isFresh = freshIds.has(n.id);
                  return (
                    <div key={n.id} onClick={() => { router.push(n.href); setShowDropdown(false); }}
                      className={`px-4 py-3 border-b active:bg-[#c4956a]/20 transition-colors cursor-pointer ${isFresh ? 'is-new-notif' : ''}`}
                      style={{ borderColor: 'rgba(196,149,106,0.2)' }}>
                      <div className="flex items-start gap-2.5">
                        <NotifIcon type={n.type} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-black flex items-center gap-1.5">
                            <span>{n.message}</span>
                            {n.source === 'ai_voice' && (
                              <span title="AI Voice" className="flex h-6 w-6 items-center justify-center rounded bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200 flex-shrink-0">
                                <Phone className="h-3 w-3" />
                              </span>
                            )}
                            {n.source === 'ai_chat' && (
                              <span title="AI WhatsApp" className="flex h-6 w-6 items-center justify-center rounded bg-terracotta-50 text-terracotta-600 ring-1 ring-terracotta-200 flex-shrink-0">
                                <MessageSquare className="h-3 w-3" />
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-black mt-1">{n.time}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismissNotification(n.id); }}
                          title={t("topbar_clear_all")}
                          className="flex-shrink-0 mt-0.5 p-1 -m-1 text-[#c4956a] hover:text-[#b8845c] cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Desktop: absolute dropdown */}
            <div className="hidden sm:block absolute right-0 mt-2 w-80 border-2 rounded-xl shadow-lg overflow-hidden z-50" style={{ background: 'rgb(252,246,237)', borderColor: '#c4956a' }}>
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#c4956a' }}>
                <span className="text-sm font-semibold text-black">{t("topbar_notifications")}</span>
                {notifications.length > 0 && (
                  <button onClick={clearAllNotifications} className="text-xs text-[#c4956a] hover:text-[#b8845c] cursor-pointer">
                    {t("topbar_clear_all")}
                  </button>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-black">{t("topbar_no_notifications")}</div>
                ) : notifications.map((n) => {
                  const isFresh = freshIds.has(n.id);
                  return (
                    <div key={n.id} onClick={() => { router.push(n.href); setShowDropdown(false); }}
                      className={`group px-4 py-3 border-b hover:bg-[#c4956a]/10 transition-colors cursor-pointer ${isFresh ? 'is-new-notif' : ''}`}
                      style={{ borderColor: 'rgba(196,149,106,0.2)' }}>
                      <div className="flex items-start gap-2.5">
                        <NotifIcon type={n.type} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-black flex items-center gap-1.5">
                            <span>{n.message}</span>
                            {n.source === 'ai_voice' && (
                              <span title="AI Voice" className="flex h-6 w-6 items-center justify-center rounded bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200 flex-shrink-0">
                                <Phone className="h-3 w-3" />
                              </span>
                            )}
                            {n.source === 'ai_chat' && (
                              <span title="AI WhatsApp" className="flex h-6 w-6 items-center justify-center rounded bg-terracotta-50 text-terracotta-600 ring-1 ring-terracotta-200 flex-shrink-0">
                                <MessageSquare className="h-3 w-3" />
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-black mt-1">{n.time}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismissNotification(n.id); }}
                          title={t("topbar_clear_all")}
                          className="flex-shrink-0 mt-0.5 p-1 -m-1 text-[#c4956a]/0 group-hover:text-[#c4956a] hover:!text-[#b8845c] transition-colors cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
