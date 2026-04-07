"use client";

import { Bell, Globe, Menu } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Notification {
  id: string;
  type: "reservation" | "waitlist" | "conversation" | "incident";
  message: string;
  time: string;
  read: boolean;
  href: string;
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
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load notifications from localStorage on mount
  useEffect(() => {
    setIsClient(true);
    try {
      const saved = localStorage.getItem("crm_notifications");
      if (saved) setNotifications(JSON.parse(saved));
    } catch(e) {}
  }, []);

  // Save notifications to localStorage on change
  useEffect(() => {
    if (!isClient) return;
    try {
      localStorage.setItem("crm_notifications", JSON.stringify(notifications));
    } catch(e) {}
  }, [notifications, isClient]);

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
            message: isEscalated
              ? `${t("topbar_new_reservation")}: ${res.party_size} ${t("topbar_people")} - ${res.date} ${res.time}`
              : `${t("topbar_new_reservation")}: ${res.party_size} ${t("topbar_people")} - ${res.date} ${res.time}`,
            time: new Date().toLocaleTimeString(),
            read: false,
            href: isEscalated ? `/pending` : `/reservations?date=${res.date}`,
          };
          setNotifications(prev => [notif, ...prev].slice(0, 20));
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
            setNotifications(prev => [n, ...prev].slice(0, 20));
          } else if (res.status === 'no_show') {
            const n: Notification = { id: res.id + '-noshow', type: "incident", message: `${t("topbar_noshow")}: ${res.date} ${res.time}`, time: new Date().toLocaleTimeString(), read: false, href: `/reservations?date=${res.date}` };
            setNotifications(prev => [n, ...prev].slice(0, 20));
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
            message: `${t("topbar_waitlist")}: ${entry.party_size} ${t("topbar_people")} - ${entry.requested_date || ''}`,
            time: new Date().toLocaleTimeString(),
            read: false,
            href: "/waitlist",
          };
          setNotifications(prev => [notif, ...prev].slice(0, 20));
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
              onChange={(e) => setLanguage(e.target.value as "en" | "es")}
              className="bg-transparent text-xs sm:text-sm font-medium text-black outline-none cursor-pointer"
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
            </select>
          </div>
        )}

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => {
              setShowDropdown(!showDropdown);
              if (!showDropdown) markAllRead();
            }}
            className="relative flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 text-black hover:text-black rounded-lg border-2"
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
            <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-80 border-2 rounded-xl shadow-lg overflow-hidden z-50" style={{ background: 'rgba(252,246,237,0.98)', borderColor: '#c4956a' }}>
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#c4956a' }}>
                <span className="text-sm font-semibold text-black">{t("topbar_notifications")}</span>
                {notifications.length > 0 && (
                  <button
                    onClick={() => setNotifications([])}
                    className="text-xs text-[#c4956a] hover:text-[#b8845c]"
                  >
                    {t("topbar_clear_all")}
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-black/50">
                    {t("topbar_no_notifications")}
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => { router.push(n.href); setShowDropdown(false); }}
                      className="px-4 py-3 border-b hover:bg-[#c4956a]/10 transition-colors cursor-pointer"
                      style={{ borderColor: 'rgba(196,149,106,0.2)' }}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-black">{n.message}</p>
                          <p className="text-xs text-black/40 mt-1">{n.time}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
