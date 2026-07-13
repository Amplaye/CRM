"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Zap } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { formatCredits } from "@/lib/billing/credits-catalog";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

// The credit meter, next to the bell. It sits in the topbar for one reason: the
// owner has to be able to see the tank emptying WITHOUT going looking for it.
// A prepaid system whose balance is buried in a settings tab is a system that
// surprises people — and being surprised by "the bot stopped answering" during
// Saturday service is the exact failure this whole feature exists to prevent.
//
// Reads once at mount, then rides the realtime subscription on credit_balances
// (the table is in the supabase_realtime publication — see the migration). So
// the number ticks down as the bot answers and jumps the moment a top-up lands,
// with no polling.

const tk = (k: string) => k as keyof Dictionary;

// Below this share of the monthly allowance the badge turns red. 10% of a
// Premium month is ~200 credits — a couple of days of normal use, which is
// enough warning to top up without it screaming at them all month.
const LOW_RATIO = 0.1;

interface Balance {
  includedRemainingMc: number;
  purchasedRemainingMc: number;
  includedGrantedMc: number;
  totalRemainingMc: number;
}

export function CreditsBadge() {
  const { activeTenant } = useTenant();
  const { t } = useLanguage();
  const supabase = useMemo(() => createClient(), []);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  const tenantId = activeTenant?.id;

  const applyRow = useCallback((row: Record<string, unknown> | null) => {
    if (!row) return;
    const included = Number(row.included_remaining_mc) || 0;
    const purchased = Number(row.purchased_remaining_mc) || 0;
    setBalance({
      includedRemainingMc: included,
      purchasedRemainingMc: purchased,
      includedGrantedMc: Number(row.included_granted_mc) || 0,
      totalRemainingMc: included + purchased,
    });
  }, []);

  // Initial read.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/credits/balance?tenant_id=${tenantId}`);
        const data = await res.json();
        if (cancelled || !data?.ok) return;
        setBalance({
          includedRemainingMc: Number(data.included_remaining_mc) || 0,
          purchasedRemainingMc: Number(data.purchased_remaining_mc) || 0,
          includedGrantedMc: Number(data.included_granted_mc) || 0,
          totalRemainingMc: Number(data.total_remaining_mc) || 0,
        });
      } catch {
        // Silent: a badge that can't load its number just doesn't render. It
        // must never be the reason a page looks broken.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // Live updates. INSERT too, not just UPDATE: a tenant's first metered action
  // CREATES the balance row, and without INSERT the badge would stay blank until
  // a reload.
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`credit-balance-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "credit_balances", filter: `tenant_id=eq.${tenantId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => applyRow(payload.new),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId, supabase, applyRow]);

  // Close the popover on an outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!tenantId || !balance) return null;

  const { totalRemainingMc, includedRemainingMc, purchasedRemainingMc, includedGrantedMc } = balance;
  const low = includedGrantedMc > 0 && totalRemainingMc < includedGrantedMc * LOW_RATIO;
  const usedPct =
    includedGrantedMc > 0
      ? Math.min(100, Math.max(0, ((includedGrantedMc - includedRemainingMc) / includedGrantedMc) * 100))
      : 0;

  // Red when low, otherwise the standard topbar control colours.
  const borderColor = low ? "#dc2626" : "#c4956a";
  const background = low ? "rgba(220,38,38,0.08)" : "rgba(252,246,237,0.6)";

  return (
    <div className="relative" ref={popRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 border-2 rounded-lg px-2 sm:px-3 h-8 sm:h-9 cursor-pointer"
        style={{ borderColor, background }}
        title={t(tk("credits_badge_title")) || "Crediti"}
        aria-label={t(tk("credits_badge_title")) || "Crediti"}
      >
        <Zap
          className="h-3.5 w-3.5 sm:h-4 sm:w-4"
          style={{ color: low ? "#dc2626" : "#000000" }}
        />
        <span
          className="text-xs sm:text-sm font-bold"
          style={{ color: low ? "#dc2626" : "#000000" }}
        >
          {formatCredits(totalRemainingMc)}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-72 rounded-lg border-2 shadow-lg z-50 p-4"
          style={{ borderColor: "#c4956a", background: "#fcf6ed" }}
        >
          <p className="text-sm font-bold text-black mb-3">
            {t(tk("credits_badge_title")) || "Crediti"}
          </p>

          {includedGrantedMc > 0 && (
            <div className="mb-3">
              <div className="flex justify-between text-xs font-medium text-black mb-1">
                <span>{t(tk("credits_monthly_included")) || "Inclusi nel piano"}</span>
                <span>
                  {formatCredits(includedRemainingMc)} / {formatCredits(includedGrantedMc)}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(196,149,106,0.25)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${100 - usedPct}%`,
                    background: low ? "#dc2626" : "linear-gradient(135deg, #d4a574, #c4956a)",
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-between text-xs font-medium text-black mb-4">
            <span>{t(tk("credits_purchased")) || "Acquistati"}</span>
            <span>{formatCredits(purchasedRemainingMc)}</span>
          </div>

          <Link
            href="/settings?tab=credits"
            onClick={() => setOpen(false)}
            className="block w-full text-center px-4 py-2 text-white text-sm font-bold rounded-lg cursor-pointer"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            {t(tk("credits_topup")) || "Ricarica"}
          </Link>
        </div>
      )}
    </div>
  );
}
