"use client";

import { ArrowLeft, X } from "lucide-react";
import { useEffect, useState } from "react";

// The four public menu templates (Immersive/Editorial/Cinematic/Classic) are
// opened either from a QR scan (own browser tab, no history) or from the
// owner's "preview" eye icon in the CRM (new tab via target="_blank"). Neither
// case has a native way back on mobile once the user has scrolled through
// categories, so every template mounts this once: go back in history if there
// is one, otherwise close the tab (works for window.open'd tabs; if that
// fails silently, we're on a fresh tab from a QR scan and there's nothing
// better to fall back to — the browser's own back gesture still applies).
export function ClosePublicMenuButton({ label }: { label: string }) {
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, []);

  return (
    <button
      type="button"
      onClick={() => (canGoBack ? window.history.back() : window.close())}
      aria-label={label}
      title={label}
      className="fixed top-3 left-3 z-50 w-9 h-9 rounded-full flex items-center justify-center text-white cursor-pointer shadow-lg backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.45)" }}
    >
      {canGoBack ? <ArrowLeft className="w-4.5 h-4.5" /> : <X className="w-4.5 h-4.5" />}
    </button>
  );
}
