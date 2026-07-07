"use client";

import { useLanguage } from "@/lib/contexts/LanguageContext";

// Non-blocking "a new version is available" pill. Shown by ServiceWorkerRegister
// when an updated service worker has installed and is waiting. Clicking it tells
// the waiting worker to activate; the actual page reload happens once, on the
// controllerchange event (see ServiceWorkerRegister) — never automatically, so a
// cassa mid-transaction is never interrupted.
export function PwaUpdateToast({ onReload }: { onReload: () => void }) {
  const { t } = useLanguage();
  return (
    <div
      className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-[#c4956a] bg-[#FCF6ED] px-4 py-2 shadow-lg">
        <span className="text-sm font-medium text-[#4a3f35]">
          {t("pwa_update_available")}
        </span>
        <button
          onClick={onReload}
          className="rounded-full bg-[#c4956a] px-3 py-1 text-sm font-semibold text-white transition hover:brightness-95 active:brightness-90"
        >
          {t("pwa_reload")}
        </button>
      </div>
    </div>
  );
}
