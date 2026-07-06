"use client";

import { useState } from "react";
import { Unlock } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";

// The "open the cash day" ritual: shown when someone tries to work with the
// register closed (or taps the closed badge). Quick-float chips + custom value.

const QUICK_FLOATS = [0, 50, 100, 150, 200];

interface OpenRegisterModalProps {
  busy: boolean;
  onConfirm: (openingFloat: number) => void;
  onClose: () => void;
}

export function OpenRegisterModal({ busy, onConfirm, onClose }: OpenRegisterModalProps) {
  const { t } = useLanguage();
  const [floatStr, setFloatStr] = useState("");
  const parsed = Number(floatStr.replace(",", "."));
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border-2 p-4 space-y-3"
        style={{ borderColor: "#c4956a", background: "#FCF6ED" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-black inline-flex items-center gap-2">
          <Unlock className="w-5 h-5" /> {t("cassa_register_closed_title")}
        </h3>
        <p className="text-sm text-black">{t("cassa_register_closed_body")}</p>
        <div>
          <label className="text-xs font-bold text-black">{t("cassa_opening_float")}</label>
          <p className="text-xs text-black">{t("cassa_opening_float_hint")}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_FLOATS.map((v) => {
            const active = floatStr.trim() !== "" && value === v;
            return (
              <button
                key={v}
                onClick={() => setFloatStr(String(v))}
                className={`h-10 px-3.5 rounded-lg border-2 text-sm font-bold cursor-pointer ${active ? "text-white" : "text-black hover:bg-[#c4956a]/10"}`}
                style={active ? { background: "#c4956a", borderColor: "#c4956a" } : { borderColor: "#c4956a" }}
              >
                {v} €
              </button>
            );
          })}
        </div>
        <input
          inputMode="decimal"
          value={floatStr}
          onChange={(e) => setFloatStr(e.target.value)}
          placeholder="100.00"
          className="w-full px-3 py-2.5 text-lg font-bold text-black border-2 rounded-lg bg-white"
          style={{ borderColor: "#c4956a" }}
        />
        <button
          disabled={busy}
          onClick={() => onConfirm(value)}
          className="w-full h-11 rounded-xl text-sm font-bold text-white disabled:opacity-40 cursor-pointer inline-flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
        >
          <Unlock className="w-4 h-4" /> {t("cassa_open_and_continue")}
        </button>
      </div>
    </div>
  );
}
