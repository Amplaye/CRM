"use client";

import { Bell, Globe, Menu, Phone, MessageSquare } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
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

interface TopbarProps {
  onMenuToggle?: () => void;
}

export function Topbar({ onMenuToggle }: TopbarProps) {
  const { language, setLanguage, t } = useLanguage();
  const { activeTenant } = useTenant();
  const router = useRouter();
  const [isClient, setIsClient] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const pushNotification = (notif: Notification) => {
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
    }, 2400);
  };

  // Load notifications from localStorage on mount
  useEffect(() => {
    setIsClient(true);
    const saved = safeLocal.get("crm_notifications");
    if (saved) {
      try {
        const parsed: Notification[] = JSON.parse(saved);
        parsed.forEach(n => seenIdsRef.current.add(n.id));
        setNotifications(parsed);
      } catch(e) {}
    }
  }, []);

  // Save notifications to localStorage on change
  useEffect(() => {
    if (!isClient) return;
    safeLocal.set("crm_notifications", JSON.stringify(notifications));
  }, [notifications, isClient]);

  // Safari suspends background tabs and kills WebSockets, so realtime alone
  // isn't enough — fetch recent activity on mount and on tab re-focus to
  // catch up on anything that happened while the tab was idle/closed.
  useEffect(() => {
    if (!activeTenant?.id) return;
    const supabase = createClient();
    let cancelled = false;

    const catchUp = async () => {
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

        const newNotifs: Notification[] = [];
        (resRes.data || []).forEach((res: any) => {
          if (res.source === 'walk_in' || res.status === 'seated' || res.created_by_type === 'staff') return;
          const isEscalated = res.status === 'escalated';
          newNotifs.push({
            id: res.id,
            type: isEscalated ? 'incident' : 'reservation',
            message: `${t('topbar_new_reservation')}: ${res.party_size} ${t('topbar_people')} - ${res.date} ${res.time}`,
            time: new Date(res.created_at).toLocaleTimeString(),
            read: false,
            href: isEscalated ? '/pending' : `/reservations?date=${res.date}`,
            source: res.source ?? null,
          });
        });
        (wlRes.data || []).forEach((entry: any) => {
          newNotifs.push({
            id: entry.id,
            type: 'waitlist',
            message: `${t('topbar_waitlist')}: ${entry.party_size} ${t('topbar_people')} - ${entry.date || ''}`,
            time: new Date(entry.created_at).toLocaleTimeString(),
            read: false,
            href: '/waitlist',
          });
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
          newNotifs.push({
            id: ev.id,
            type: 'reservation',
            message: `${t('topbar_reservation_modified')}${diff}`,
            time: new Date(ev.created_at).toLocaleTimeString(),
            read: false,
            href: goDate ? `/reservations?date=${goDate}` : '/reservations',
          });
        });

        if (newNotifs.length > 0) {
          newNotifs.forEach((n, i) => {
            setTimeout(() => pushNotification(n), i * 180);
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
  }, [activeTenant?.id, t]);

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
      {/* Left side - hamburger on mobile */}
      <div className="flex items-center">
        <button
          onClick={onMenuToggle}
          className="md:hidden p-2 -ml-1 hover:bg-[#c4956a]/10 rounded-lg transition-colors"
        >
          <Menu className="h-5 w-5 text-black" />
        </button>
      </div>

      {/* Right side - controls */}
      <div className="flex items-center space-x-2 sm:space-x-3 md:space-x-4">
        {isClient && (
          <div className="flex items-center border-2 rounded-lg px-2 sm:px-3 h-8 sm:h-9" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
            <Globe className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-black mr-1.5 sm:mr-2" />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "es" | "it" | "de")}
              className="bg-transparent text-xs sm:text-sm font-medium text-black outline-none cursor-pointer"
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
                  <button onClick={() => setNotifications([])} className="text-xs text-[#c4956a] hover:text-[#b8845c]">
                    {t("topbar_clear_all")}
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-black">{t("topbar_no_notifications")}</div>
                ) : notifications.map((n) => {
                  const icon = n.type === "incident" ? "⚠️" : n.type === "waitlist" ? "📋" : n.type === "reservation" ? "📅" : "💬";
                  const isFresh = freshIds.has(n.id);
                  return (
                    <div key={n.id} onClick={() => { router.push(n.href); setShowDropdown(false); }}
                      className={`px-4 py-3 border-b active:bg-[#c4956a]/20 transition-colors cursor-pointer ${isFresh ? 'is-new-notif' : ''}`}
                      style={{ borderColor: 'rgba(196,149,106,0.2)' }}>
                      <div className="flex items-start gap-2.5">
                        <span className="text-base flex-shrink-0 mt-0.5">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-black flex items-center gap-1.5">
                            <span>{n.message}</span>
                            {n.source === 'ai_voice' && (
                              <span title="AI Voice" className="inline-flex items-center justify-center h-4 w-4 rounded bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200">
                                <Phone className="h-2.5 w-2.5" />
                              </span>
                            )}
                            {n.source === 'ai_chat' && (
                              <span title="AI WhatsApp" className="inline-flex items-center justify-center h-4 w-4 rounded bg-terracotta-50 text-terracotta-600 ring-1 ring-terracotta-200">
                                <MessageSquare className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-black mt-1">{n.time}</p>
                        </div>
                        <span className="text-xs text-[#c4956a] flex-shrink-0 mt-0.5">→</span>
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
                  <button onClick={() => setNotifications([])} className="text-xs text-[#c4956a] hover:text-[#b8845c]">
                    {t("topbar_clear_all")}
                  </button>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-black">{t("topbar_no_notifications")}</div>
                ) : notifications.map((n) => {
                  const icon = n.type === "incident" ? "⚠️" : n.type === "waitlist" ? "📋" : n.type === "reservation" ? "📅" : "💬";
                  const isFresh = freshIds.has(n.id);
                  return (
                    <div key={n.id} onClick={() => { router.push(n.href); setShowDropdown(false); }}
                      className={`px-4 py-3 border-b hover:bg-[#c4956a]/10 transition-colors cursor-pointer ${isFresh ? 'is-new-notif' : ''}`}
                      style={{ borderColor: 'rgba(196,149,106,0.2)' }}>
                      <div className="flex items-start gap-2.5">
                        <span className="text-base flex-shrink-0 mt-0.5">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-black flex items-center gap-1.5">
                            <span>{n.message}</span>
                            {n.source === 'ai_voice' && (
                              <span title="AI Voice" className="inline-flex items-center justify-center h-4 w-4 rounded bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200">
                                <Phone className="h-2.5 w-2.5" />
                              </span>
                            )}
                            {n.source === 'ai_chat' && (
                              <span title="AI WhatsApp" className="inline-flex items-center justify-center h-4 w-4 rounded bg-terracotta-50 text-terracotta-600 ring-1 ring-terracotta-200">
                                <MessageSquare className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-black mt-1">{n.time}</p>
                        </div>
                        <span className="text-xs text-[#c4956a] flex-shrink-0 mt-0.5">→</span>
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
