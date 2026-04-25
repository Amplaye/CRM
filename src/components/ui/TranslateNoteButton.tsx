"use client";

import { useState, useEffect } from "react";
import { Languages, X, Loader2 } from "lucide-react";

type Lang = "es" | "en" | "it";

const FLAGS: Record<Lang, string> = { es: "🇪🇸", en: "🇬🇧", it: "🇮🇹" };
const LABELS: Record<Lang, string> = { es: "ES", en: "EN", it: "IT" };

interface Props {
  text: string;
  className?: string;
}

export function TranslateNoteButton({ text, className }: Props) {
  const [loading, setLoading] = useState<Lang | null>(null);
  const [activeLang, setActiveLang] = useState<Lang | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [cache, setCache] = useState<Partial<Record<Lang, string>>>({});

  useEffect(() => {
    setActiveLang(null);
    setPreview("");
    setCache({});
    setError(null);
  }, [text]);

  const trimmed = text?.trim() || "";
  if (!trimmed) return null;

  const translate = async (lang: Lang) => {
    if (cache[lang]) {
      setPreview(cache[lang]!);
      setActiveLang(lang);
      setError(null);
      return;
    }
    setLoading(lang);
    setError(null);
    try {
      const res = await fetch("/api/translate-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, targetLang: lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Translation failed");
      setCache((c) => ({ ...c, [lang]: data.translated }));
      setPreview(data.translated);
      setActiveLang(lang);
    } catch (e: any) {
      setError(e?.message || "Error");
    } finally {
      setLoading(null);
    }
  };

  const close = () => {
    setActiveLang(null);
    setPreview("");
    setError(null);
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className || ""}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Languages className="w-3.5 h-3.5 text-black/60" aria-hidden />
        {(Object.keys(FLAGS) as Lang[]).map((lang) => {
          const isActive = activeLang === lang;
          const isLoading = loading === lang;
          return (
            <button
              key={lang}
              type="button"
              onClick={() => translate(lang)}
              disabled={loading !== null}
              title={`Traducir a ${LABELS[lang]}`}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold border transition-colors ${
                isActive
                  ? "bg-[#c4956a] text-white border-[#c4956a]"
                  : "bg-white text-black border-[#c4956a]/40 hover:bg-[#c4956a]/10"
              } disabled:opacity-50`}
            >
              {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>{FLAGS[lang]}</span>}
              <span>{LABELS[lang]}</span>
            </button>
          );
        })}
        {activeLang && (
          <button
            type="button"
            onClick={close}
            title="Cerrar"
            className="inline-flex items-center px-1 py-0.5 rounded text-[11px] text-black/60 hover:bg-black/5"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {error && <span className="text-[10px] text-red-600">{error}</span>}
      </div>
      {activeLang && preview && (
        <div className="rounded-md border border-[#c4956a]/40 bg-[#fef9f1] px-2.5 py-2 text-xs text-black whitespace-pre-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[#c4956a] mr-1.5">
            {FLAGS[activeLang]} {LABELS[activeLang]}
          </span>
          {preview}
        </div>
      )}
    </div>
  );
}
