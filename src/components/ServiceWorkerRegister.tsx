"use client";

import { useEffect, useRef, useState } from "react";
import { PwaUpdateToast } from "./PwaUpdateToast";

// Registers the app-shell service worker and manages its update lifecycle.
//
// Update flow (deliberately prompt-driven, never automatic):
//   1. Register with updateViaCache:'none' so the browser always revalidates the
//      SW script over the network (paired with the no-cache header on /sw.js) —
//      a new SW is picked up promptly and can never be served stale.
//   2. When a new SW finishes installing AND a controller already exists (i.e.
//      this is an update, not the first install), show a "new version — reload"
//      toast instead of reloading. A POS must not reload itself mid-payment.
//   3. On user click, message the waiting worker to skipWaiting, then reload
//      exactly once when it takes control (controllerchange), guarded so we
//      never loop.
//   4. Poll for updates when the tab becomes visible and on a long interval, so
//      long-lived installed sessions eventually see new deploys.
export function ServiceWorkerRegister() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const refreshing = useRef(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // Reload once when the new SW takes control (after the user accepts).
    const onControllerChange = () => {
      if (refreshing.current) return;
      refreshing.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    let interval: ReturnType<typeof setInterval> | undefined;

    const trackWaiting = (worker: ServiceWorker | null) => {
      if (!worker) return;
      // Only prompt for an *update*: if there's no current controller this is a
      // first install and nothing changed under the user's feet.
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        setWaitingWorker(worker);
      }
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        // A worker may already be waiting (installed before this mount).
        if (reg.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(reg.waiting);
        }

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () =>
            trackWaiting(installing),
          );
        });

        const kick = () => reg.update().catch(() => {});
        const onVisible = () => {
          if (document.visibilityState === "visible") kick();
        };
        document.addEventListener("visibilitychange", onVisible);
        interval = setInterval(kick, 45 * 60 * 1000);
      })
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      if (interval) clearInterval(interval);
    };
  }, []);

  const handleReload = () => {
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    // The controllerchange handler performs the single reload once the new
    // worker activates. Hide the toast immediately for responsiveness.
    setWaitingWorker(null);
  };

  if (!waitingWorker) return null;
  return <PwaUpdateToast onReload={handleReload} />;
}
