"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Send,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useTenant } from "@/lib/contexts/TenantContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";

// Settings → WhatsApp. The self-service "Connect WhatsApp Business" flow that
// replaces us wiring each number by hand. It launches Meta Embedded Signup in a
// popup (FB.login({ config_id })), captures the authorization code + waba_id +
// phone_number_id, and POSTs them to /api/whatsapp/embedded-signup, which does the
// token exchange server-side. The owner then sends a test message to confirm.
//
// Needs two PUBLIC Meta ids at build time:
//   NEXT_PUBLIC_META_APP_ID     — the BALI Flow Facebook app id
//   NEXT_PUBLIC_META_CONFIG_ID  — the Embedded Signup configuration id
// When either is missing the tab degrades to a "BALI Flow will finish this for
// you" message instead of showing a broken button (the concierge path covers it).

const FB_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const FB_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID;
const GRAPH_VERSION = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || "v21.0";

type SetupView = {
  setup: { phone_number_usage: string; setup_status: string; last_error: string | null } | null;
  connection: {
    meta_business_id: string | null;
    waba_id: string | null;
    phone_number_id: string | null;
    connection_status: string;
    last_error: string | null;
  } | null;
};

type Phase = "idle" | "connecting" | "testing";

// Minimal typing for the global FB SDK we inject.
type FbLoginResponse = { authResponse?: { code?: string } | null; status?: string };
interface FbSdk {
  init(opts: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }): void;
  login(cb: (res: FbLoginResponse) => void, opts: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

export function WhatsAppTab() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const tt = (k: string) => t(k as keyof Dictionary);

  const [view, setView] = useState<SetupView | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [testTo, setTestTo] = useState("");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  // The embedded-signup message event hands us waba_id / phone_number_id out of
  // band from the login callback — stash them here so the callback can read them.
  const signupData = useRef<{ waba_id?: string; phone_number_id?: string }>({});

  const configured = !!FB_APP_ID && !!FB_CONFIG_ID;

  const loadView = useCallback(async () => {
    if (!tenant?.id) return;
    try {
      const res = await fetch(`/api/whatsapp/setup?tenant_id=${encodeURIComponent(tenant.id)}`);
      const data = await res.json();
      if (data?.ok) setView({ setup: data.setup, connection: data.connection });
    } catch {
      /* non-fatal: the UI just shows "not connected" */
    }
  }, [tenant?.id]);

  useEffect(() => {
    loadView();
  }, [loadView]);

  // Inject the Facebook SDK once (only when we actually have ids to init with).
  useEffect(() => {
    if (!configured) return;
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId: FB_APP_ID!, cookie: true, xfbml: false, version: GRAPH_VERSION });
      setSdkReady(true);
    };
    const id = "facebook-jssdk";
    if (!document.getElementById(id)) {
      const js = document.createElement("script");
      js.id = id;
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      js.async = true;
      js.defer = true;
      document.body.appendChild(js);
    }
  }, [configured]);

  // Listen for the Embedded Signup message event (carries waba_id + phone_number_id).
  useEffect(() => {
    if (!configured) return;
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      )
        return;
      try {
        const data = JSON.parse(event.data);
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data?.event === "FINISH") {
          signupData.current = {
            waba_id: data?.data?.waba_id,
            phone_number_id: data?.data?.phone_number_id,
          };
        }
      } catch {
        /* not our message */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [configured]);

  async function launchSignup() {
    if (!tenant?.id || !window.FB || !FB_CONFIG_ID) return;
    setResult(null);
    setPhase("connecting");
    signupData.current = {};

    // Mark intent so the admin card shows movement even if the owner closes the popup.
    fetch("/api/whatsapp/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenant.id, setup_status: "waiting_for_meta_login" }),
    }).catch(() => {});

    window.FB.login(
      async (res: FbLoginResponse) => {
        const code = res?.authResponse?.code;
        if (!code) {
          setPhase("idle");
          setResult({ ok: false, msg: tt("settings_wa_error_generic") });
          return;
        }
        try {
          const r = await fetch("/api/whatsapp/embedded-signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenant_id: tenant.id,
              code,
              waba_id: signupData.current.waba_id,
              phone_number_id: signupData.current.phone_number_id,
            }),
          });
          const data = await r.json();
          if (data?.ok) {
            await loadView();
            setResult({ ok: true, msg: tt("settings_wa_status_connected") });
          } else {
            setResult({ ok: false, msg: data?.error || tt("settings_wa_error_generic") });
          }
        } catch {
          setResult({ ok: false, msg: tt("settings_wa_error_generic") });
        } finally {
          setPhase("idle");
        }
      },
      {
        config_id: FB_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  }

  async function sendTest() {
    if (!tenant?.id || !testTo.trim()) return;
    setResult(null);
    setPhase("testing");
    try {
      const r = await fetch("/api/whatsapp/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenant.id, to: testTo.trim() }),
      });
      const data = await r.json();
      setResult(
        data?.ok
          ? { ok: true, msg: tt("settings_wa_test_sent") }
          : { ok: false, msg: data?.error || tt("settings_wa_error_generic") },
      );
      if (data?.ok) loadView();
    } catch {
      setResult({ ok: false, msg: tt("settings_wa_error_generic") });
    } finally {
      setPhase("idle");
    }
  }

  const status = view?.connection?.connection_status || "pending";
  const isConnected = status === "connected" && !!view?.connection?.phone_number_id;
  const isPending = status === "pending" && (view?.setup?.setup_status || "not_started") !== "not_started";
  const statusLabel = isConnected
    ? tt("settings_wa_status_connected")
    : status === "error"
      ? tt("settings_wa_status_error")
      : isPending
        ? tt("settings_wa_status_pending")
        : tt("settings_wa_status_not_connected");

  return (
    <div className="max-w-2xl space-y-6">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
          <MessageCircle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{tt("settings_wa_title")}</h2>
          <p className="mt-0.5 text-sm text-stone-600">{tt("settings_wa_subtitle")}</p>
        </div>
      </header>

      {/* Status row */}
      <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3">
        <span className="text-sm font-medium text-stone-700">{tt("settings_wa_status_label")}</span>
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {isConnected ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : status === "error" ? (
            <XCircle className="h-4 w-4 text-red-500" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-amber-400" />
          )}
          <span className={isConnected ? "text-emerald-700" : status === "error" ? "text-red-600" : "text-stone-600"}>
            {statusLabel}
          </span>
        </span>
      </div>

      {view?.connection?.phone_number_id && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          <span className="font-medium text-stone-700">{tt("settings_wa_number_label")}:</span>{" "}
          <span className="font-mono">{view.connection.phone_number_id}</span>
        </div>
      )}

      {!configured ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{tt("settings_wa_not_configured")}</span>
        </div>
      ) : (
        !isConnected && (
          <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-600">{tt("settings_wa_connect_hint")}</p>
            <button
              type="button"
              onClick={launchSignup}
              disabled={!sdkReady || phase === "connecting"}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === "connecting" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tt("settings_wa_connecting")}
                </>
              ) : (
                <>
                  <MessageCircle className="h-4 w-4" />
                  {tt("settings_wa_connect_btn")}
                </>
              )}
            </button>
          </div>
        )
      )}

      {/* Test message — only useful once a number is attached */}
      {isConnected && (
        <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-stone-800">{tt("settings_wa_test_title")}</h3>
          <p className="text-xs text-stone-500">{tt("settings_wa_test_24h_hint")}</p>
          <div className="flex gap-2">
            <input
              type="tel"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder={tt("settings_wa_test_placeholder")}
              className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={sendTest}
              disabled={phase === "testing" || !testTo.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-stone-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === "testing" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tt("settings_wa_test_sending")}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  {tt("settings_wa_test_btn")}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
          }`}
        >
          {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {result.msg}
        </div>
      )}
    </div>
  );
}
