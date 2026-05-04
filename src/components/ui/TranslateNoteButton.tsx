"use client";

import { useState, useEffect } from "react";
import { Languages, X, Loader2 } from "lucide-react";

type Lang = "es" | "en" | "it" | "de";

const FLAGS: Record<Lang, string> = { es: "🇪🇸", en: "🇬🇧", it: "🇮🇹", de: "🇩🇪" };
const LABELS: Record<Lang, string> = { es: "ES", en: "EN", it: "IT", de: "DE" };

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
    <div className={`flex flex-col gap-2 ${className || ""}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Languages className="w-4 h-4 text-black/70" aria-hidden />
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
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold border-2 transition-colors ${
                isActive
                  ? "bg-[#c4956a] text-white border-[#c4956a]"
                  : "bg-white text-black border-[#c4956a]/50 hover:bg-[#c4956a]/10"
              } disabled:opacity-50`}
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="text-base leading-none">{FLAGS[lang]}</span>}
              <span>{LABELS[lang]}</span>
            </button>
          );
        })}
        {activeLang && (
          <button
            type="button"
            onClick={close}
            title="Cerrar"
            className="inline-flex items-center px-2 py-1.5 rounded-md text-sm text-black/70 hover:bg-black/5"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      {activeLang && preview && (
        <div className="rounded-md border-2 border-[#c4956a]/40 bg-[#fef9f1] px-3 py-2.5 text-sm text-black whitespace-pre-wrap">
          <span className="text-xs font-bold uppercase tracking-wide text-[#c4956a] mr-2">
            {FLAGS[activeLang]} {LABELS[activeLang]}
          </span>
          {preview}
        </div>
      )}
    </div>
  );
}
