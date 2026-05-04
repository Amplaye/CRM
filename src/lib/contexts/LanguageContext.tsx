"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import { en, Dictionary } from "../i18n/dictionaries/en";
import { es } from "../i18n/dictionaries/es";
import { it } from "../i18n/dictionaries/it";
import { de } from "../i18n/dictionaries/de";
import { safeLocal } from "../safe-storage";

type LanguageCode = "en" | "es" | "it" | "de";

interface LanguageContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: keyof Dictionary) => string;
}

const dictionaries: Record<LanguageCode, Dictionary> = {
  en,
  es,
  it,
  de,
};

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  setLanguage: () => {},
  t: (key) => key,
});

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  // Server and first client render both start at "en" so the hydrated DOM
  // matches the SSR markup (avoids React error #418). After mount, we read
  // the saved preference from localStorage and switch if the user previously
  // picked another language. No browser-language auto-detect.
  const [language, setLanguageState] = useState<LanguageCode>("en");

  useEffect(() => {
    const saved = safeLocal.get("app_lang_v2") as LanguageCode | null;
    if (saved === "en" || saved === "es" || saved === "it" || saved === "de") {
      setLanguageState(saved);
    }
  }, []);

  // Stable identity across renders — critical: consumers put `t` in useEffect
  // dependency arrays and a new reference each render would retrigger those
  // effects on every provider render, hammering the DB from Topbar/etc.
  const setLanguage = useCallback((lang: LanguageCode) => {
    setLanguageState(lang);
    safeLocal.set("app_lang_v2", lang);
  }, []);

  const t = useCallback(
    (key: keyof Dictionary): string =>
      dictionaries[language][key] || dictionaries["en"][key] || key,
    [language]
  );

  const value = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
