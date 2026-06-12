"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, UserPlus, LogIn, ArrowRight } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { safeLocal } from "@/lib/safe-storage";

// First touch point for an anonymous visitor (the middleware sends them here):
// a clear two-way fork — "Create your account" → the sign-up wizard, or
// "Already with us? Sign in" → the existing login form. Kept deliberately
// simple and on-brand with the login screen.
export default function WelcomePage() {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const [langOpen, setLangOpen] = useState(false);

  const LANGS: { code: "es" | "it" | "en" | "de"; flag: string; label: string }[] = [
    { code: "es", flag: "🇪🇸", label: "ES" },
    { code: "it", flag: "🇮🇹", label: "IT" },
    { code: "en", flag: "🇬🇧", label: "EN" },
    { code: "de", flag: "🇩🇪", label: "DE" },
  ];
  const current = LANGS.find((l) => l.code === language) ?? LANGS[2];

  // Mirror the login page: detect the browser language for a first-time visitor,
  // but never override a returning user's saved choice.
  useEffect(() => {
    if (safeLocal.get("app_lang_v2")) return;
    const code = (navigator.language || "").slice(0, 2).toLowerCase();
    if (code === "es" || code === "it" || code === "de" || code === "en") setLanguage(code);
  }, [setLanguage]);

  // Prefetch both destinations so the chosen path opens instantly.
  useEffect(() => {
    router.prefetch("/register");
    router.prefetch("/login");
  }, [router]);

  useEffect(() => {
    if (!langOpen) return;
    const close = () => setLangOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [langOpen]);

  return (
    <div className="min-h-[100dvh] flex flex-col justify-center px-4 sm:px-6 lg:px-8 py-6 relative overflow-hidden">
      {/* Language switcher — same control as the login screen */}
      <div className="absolute top-4 right-4 z-20">
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLangOpen((o) => !o);
            }}
            aria-haspopup="listbox"
            aria-expanded={langOpen}
            className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-sm font-semibold text-black transition-all"
            style={{ background: "rgba(252,246,237,0.85)", border: "2px solid #c4956a" }}
          >
            <span className="text-base leading-none">{current.flag}</span>
            <span>{current.label}</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${langOpen ? "rotate-180" : ""}`} />
          </button>

          {langOpen && (
            <ul
              role="listbox"
              className="absolute right-0 mt-2 w-32 rounded-xl overflow-hidden shadow-lg"
              style={{ background: "rgba(252,246,237,0.98)", border: "2px solid #c4956a" }}
            >
              {LANGS.map(({ code, flag, label }) => {
                const active = language === code;
                return (
                  <li key={code} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => {
                        setLanguage(code);
                        setLangOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-[#c4956a]/15"
                      style={active ? { background: "rgba(196,149,106,0.2)" } : undefined}
                    >
                      <span className="text-base leading-none">{flag}</span>
                      <span>{label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Logo */}
      <div className="mx-auto w-full max-w-md relative z-10">
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-horizontal.png"
            alt="BaliFlow"
            className="w-full h-auto max-w-full"
            style={{
              mask: "radial-gradient(67% 90%, black 50%, transparent 75%)",
              WebkitMask: "radial-gradient(67% 90%, black 50%, transparent 75%)",
            }}
          />
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl relative z-10">
        <div className="text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-black text-black">{t("welcome_title")}</h1>
          <p className="mt-1 text-sm sm:text-base text-black">{t("welcome_subtitle")}</p>
        </div>

        {/* The two-way fork. Each banner is a single big tap target. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
          {/* 1 — Create account → sign-up wizard */}
          <Link
            href="/register"
            className="group flex flex-col rounded-2xl p-6 sm:p-7 transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer"
            style={{
              background: "linear-gradient(135deg, #c4956a 0%, #b8845c 100%)",
              boxShadow: "0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)",
            }}
          >
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center mb-4">
              <UserPlus className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl font-black text-white">{t("welcome_create_title")}</h2>
            <p className="mt-1.5 text-sm text-white/90 flex-1">{t("welcome_create_desc")}</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-white">
              {t("welcome_create_cta")}
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          {/* 2 — Already with us? → existing login */}
          <Link
            href="/login"
            className="group flex flex-col rounded-2xl p-6 sm:p-7 transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer"
            style={{
              background: "rgba(252,246,237,0.85)",
              border: "2px solid #c4956a",
              boxShadow: "0 20px 60px rgba(196,149,106,0.15)",
            }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: "rgba(196,149,106,0.2)" }}>
              <LogIn className="w-6 h-6 text-[#a87642]" />
            </div>
            <h2 className="text-xl font-black text-black">{t("welcome_signin_title")}</h2>
            <p className="mt-1.5 text-sm text-black flex-1">{t("welcome_signin_desc")}</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-[#a87642]">
              {t("welcome_signin_cta")}
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
