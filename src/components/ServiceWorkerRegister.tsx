"use client";

import { useEffect } from "react";

// Registers the no-op service worker so Chrome/Edge/Firefox on Android and
// desktop consider the app installable (they require a controlling SW with
// a fetch handler; Safari/iOS doesn't need this to allow Add to Home Screen).
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return null;
}
