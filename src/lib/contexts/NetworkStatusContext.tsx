"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

// Minimal online/offline signal for the whole app. Drives the Topbar indicator,
// the "stale data" banners, disabling money actions in the cassa, and pausing
// background polls when there's no network.
//
// Note: navigator.onLine is a hint, not a guarantee — it reports link-layer
// connectivity, not whether requests actually succeed. So consumers that make a
// real request (cassa loadStatic, reservations) also fall back to cache when a
// live read THROWS, regardless of this flag. This context is for UI/UX gating.

interface NetworkStatus {
  online: boolean;
}

// Default to online: server render and first paint assume connectivity so the
// UI doesn't flash an "offline" state before the client hydrates.
const NetworkStatusContext = createContext<NetworkStatus>({ online: true });

export function NetworkStatusProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Seed from the real value after mount (avoids hydration mismatch).
    if (typeof navigator !== "undefined" && "onLine" in navigator) {
      setOnline(navigator.onLine);
    }
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <NetworkStatusContext.Provider value={{ online }}>
      {children}
    </NetworkStatusContext.Provider>
  );
}

export const useNetworkStatus = () => useContext(NetworkStatusContext);
