"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Shield, Check, Search } from "lucide-react";
import { useTenant } from "@/lib/contexts/TenantContext";

export function TenantSwitcher() {
  const { activeTenant, availableTenants, switchTenant, globalRole, isImpersonating } = useTenant();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (globalRole !== "platform_admin") return null;

  const filtered = query.trim()
    ? availableTenants.filter((t) =>
        t.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : availableTenants;

  return (
    <div className="relative w-full" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border-2 text-sm font-semibold text-black hover:bg-[#c4956a]/10 transition-colors"
        style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
      >
        <Shield className={`w-4 h-4 flex-shrink-0 ${isImpersonating ? "text-amber-600" : "text-[#c4956a]"}`} />
        <span className="flex-1 truncate text-left">
          {activeTenant ? activeTenant.name : "Platform Admin"}
        </span>
        <ChevronDown className="w-4 h-4 flex-shrink-0 text-black" />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 mt-1.5 border-2 rounded-md shadow-lg z-50 overflow-hidden"
          style={{ background: "rgb(252,246,237)", borderColor: "#c4956a" }}
        >
          <div className="px-2 py-2 border-b" style={{ borderColor: "rgba(196,149,106,0.4)" }}>
            <div className="flex items-center gap-1.5 px-1.5 py-1 rounded border bg-white/60" style={{ borderColor: "#c4956a" }}>
              <Search className="w-3.5 h-3.5 text-[#8b6540]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca cliente..."
                className="flex-1 bg-transparent text-xs text-black placeholder-[#8b6540]/60 outline-none"
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                switchTenant(null);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-black hover:bg-[#c4956a]/10 transition-colors"
            >
              <Shield className="w-3.5 h-3.5 text-[#c4956a] flex-shrink-0" />
              <span className="flex-1 text-left font-semibold">Platform Admin</span>
              {!activeTenant && <Check className="w-3.5 h-3.5 text-emerald-600" />}
            </button>

            <div className="my-1 mx-2 border-t" style={{ borderColor: "rgba(196,149,106,0.3)" }} />

            {filtered.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-[#8b6540] italic">Nessun cliente trovato</div>
            ) : (
              filtered.map((t) => {
                const isActive = activeTenant?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (!isActive) switchTenant(t.id);
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-black hover:bg-[#c4956a]/10 transition-colors ${
                      isActive ? "bg-[#c4956a]/15 font-semibold" : ""
                    }`}
                  >
                    <span className="flex-1 text-left truncate">{t.name}</span>
                    {isActive && <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
