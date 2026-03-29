"use client";

import { Bell, Globe } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface Notification {
  id: string;
  type: "reservation" | "waitlist" | "conversation" | "incident";
  message: string;
  time: string;
  read: boolean;
}

export function Topbar() {
  const { language, setLanguage } = useLanguage();
  const { activeTenant } = useTenant();
  const [isClient, setIsClient] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

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
          const notif: Notification = {
            id: res.id,
            type: "reservation",
            message: `New reservation: ${res.party_size} guests on ${res.date} at ${res.time}`,
            time: new Date().toLocaleTimeString(),
            read: false,
          };
          setNotifications(prev => [notif, ...prev].slice(0, 20));
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
            message: `New waitlist entry: ${entry.party_size} guests for ${entry.date}`,
            time: new Date().toLocaleTimeString(),
            read: false,
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

  const typeIcon = (type: string) => {
    switch (type) {
      case "reservation": return "📅";
      case "waitlist": return "⏳";
      case "conversation": return "💬";
      case "incident": return "⚠️";
      default: return "🔔";
    }
  };

  return (
    <header className="h-16 border-b flex items-center justify-end px-4 sm:px-6 lg:px-8" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
      <div className="flex items-center space-x-3 sm:space-x-4">
        {isClient && (
          <div className="flex items-center border-2 rounded-lg px-3 py-2" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
            <Globe className="h-4 w-4 text-black mr-2" />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "es")}
              className="bg-transparent text-sm font-medium text-black outline-none cursor-pointer"
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
            className="relative p-2 text-black hover:text-black rounded-lg border-2"
            style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
          >
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center h-5 w-5 rounded-full bg-red-500 text-white text-xs font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
            <Bell className="h-5 w-5" />
          </button>

          {showDropdown && (
            <div className="absolute right-0 mt-2 w-80 border-2 rounded-xl shadow-lg overflow-hidden z-50" style={{ background: 'rgba(252,246,237,0.98)', borderColor: '#c4956a' }}>
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#c4956a' }}>
                <span className="text-sm font-semibold text-black">Notifications</span>
                {notifications.length > 0 && (
                  <button
                    onClick={() => setNotifications([])}
                    className="text-xs text-[#c4956a] hover:text-[#b8845c]"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-black/50">
                    No notifications yet
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className="px-4 py-3 border-b hover:bg-[#c4956a]/5 transition-colors"
                      style={{ borderColor: 'rgba(196,149,106,0.2)' }}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-lg">{typeIcon(n.type)}</span>
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
