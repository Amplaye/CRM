"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { en, Dictionary } from "../i18n/dictionaries/en";
import { es } from "../i18n/dictionaries/es";
import { it } from "../i18n/dictionaries/it";
import { safeLocal } from "../safe-storage";

type LanguageCode = "en" | "es" | "it";

interface LanguageContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: keyof Dictionary) => string;
}

const dictionaries: Record<LanguageCode, Dictionary> = {
  en,
  es,
  it,
};

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  setLanguage: () => {},
  t: (key) => key,
});

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<LanguageCode>("en");

  // Load saved preference from localStorage on mount
  useEffect(() => {
    const saved = safeLocal.get("app_lang") as LanguageCode | null;
    if (saved === "en" || saved === "es" || saved === "it") {
      setLanguageState(saved);
    } else if (typeof navigator !== "undefined" && navigator.language.startsWith("it")) {
      setLanguageState("it");
    }
  }, []);

  const setLanguage = (lang: LanguageCode) => {
    setLanguageState(lang);
    safeLocal.set("app_lang", lang);
  };

  const t = (key: keyof Dictionary): string => {
    return dictionaries[language][key] || dictionaries["en"][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
