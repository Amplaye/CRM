"use client";

// Connect card for the Social section. Loads the Facebook JS SDK (same injection
// as WhatsAppTab), runs FB.login with the publishing scopes, and POSTs the code
// to /api/social/connect. If the user administers more than one Page, the route
// answers { needsChoice, pages } and we show a picker (a second POST carries the
// chosen page_id + the same code).
//
// The step-by-step CONNECT_GUIDE is surfaced inline as a collapsible stepper so
// the owner knows the IG-Business + linked-Page prerequisites before clicking.

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ThumbsUp, Check, ChevronDown, ExternalLink } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

const FB_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const GRAPH_VERSION = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || "v21.0";
const SCOPE = "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management";

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

interface PageChoice {
  pageId: string;
  pageName?: string;
  hasInstagram: boolean;
}

export interface ConnectCardProps {
  tenantId: string;
  connectedAccountName?: string | null;
  status?: "connected" | "expired" | "revoked" | null;
  onConnected: () => void;
  onDisconnect: () => void;
}

export function ConnectCard({ tenantId, connectedAccountName, status, onConnected, onDisconnect }: ConnectCardProps) {
  const { t } = useLanguage();
  const tt = (k: string) => t(k as keyof Dictionary);
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [choices, setChoices] = useState<PageChoice[] | null>(null);
  const lastCode = useRef<string>("");

  const configured = !!FB_APP_ID;
  // "Has an account row" (connected or expired) → show the account block.
  const hasAccount = (status === "connected" || status === "expired") && !!connectedAccountName;
  const isExpired = status === "expired";

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

  const postConnect = useCallback(
    async (code: string, pageId?: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch("/api/social/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenant_id: tenantId, code, page_id: pageId }),
        });
        const data = await r.json();
        if (data?.success) {
          setChoices(null);
          onConnected();
        } else if (data?.needsChoice) {
          setChoices(data.pages || []);
        } else {
          setError(data?.error || "connect_failed");
        }
      } catch {
        setError("connect_failed");
      } finally {
        setBusy(false);
      }
    },
    [tenantId, onConnected],
  );

  const launch = useCallback(() => {
    if (!window.FB) return;
    setError(null);
    setBusy(true);
    window.FB.login(
      async (res: FbLoginResponse) => {
        const code = res?.authResponse?.code;
        if (!code) {
          setBusy(false);
          setError("cancelled");
          return;
        }
        lastCode.current = code;
        await postConnect(code);
      },
      { scope: SCOPE, response_type: "code", override_default_response_type: true },
    );
  }, [postConnect]);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/social/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      onDisconnect();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <header className="flex items-start gap-3">
        <div className="flex gap-1.5 rounded-xl bg-stone-900 p-2.5 text-white">
          <Camera className="h-5 w-5" />
          <ThumbsUp className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-black">{tt("social_connect_title")}</h2>
          <p className="mt-0.5 text-sm text-black">{tt("social_connect_desc")}</p>
        </div>
        {hasAccount && !isExpired ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
            <Check className="h-4 w-4" /> {tt("social_connected")}
          </span>
        ) : null}
      </header>

      {hasAccount ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-black">{connectedAccountName}</p>
            <p className="text-xs text-black">
              {isExpired ? tt("social_account_status_expired") : tt("social_account_status_connected")}
            </p>
          </div>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-black hover:bg-white focus:outline-none focus:ring-2 focus:ring-stone-400 disabled:opacity-50"
          >
            {tt("social_disconnect")}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {choices ? (
            <div className="rounded-xl border border-stone-200 p-3">
              <p className="mb-2 text-sm font-medium text-black">
                {tt("social_connect_title")}
              </p>
              <ul className="space-y-2">
                {choices.map((p) => (
                  <li key={p.pageId}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => postConnect(lastCode.current, p.pageId)}
                      className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-left text-sm text-black hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#c4956a] disabled:opacity-50"
                    >
                      <span className="font-medium">{p.pageName || p.pageId}</span>
                      {p.hasInstagram ? <Camera className="h-4 w-4" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <button
              type="button"
              onClick={launch}
              disabled={!sdkReady || busy || !configured}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#c4956a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#b3835a] focus:outline-none focus:ring-2 focus:ring-[#c4956a] focus:ring-offset-2 disabled:opacity-50"
            >
              {busy ? "…" : tt("social_connect_cta")}
            </button>
          )}
          {!configured ? (
            <p className="text-xs text-black">NEXT_PUBLIC_META_APP_ID</p>
          ) : null}
          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

          {/* Step-by-step guide */}
          <div className="rounded-xl border border-stone-200">
            <button
              type="button"
              onClick={() => setGuideOpen((v) => !v)}
              className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-black focus:outline-none focus:ring-2 focus:ring-[#c4956a]"
            >
              {tt("social_connect_guide")}
              <ChevronDown className={`h-4 w-4 transition-transform ${guideOpen ? "rotate-180" : ""}`} />
            </button>
            {guideOpen ? (
              <ol className="list-decimal space-y-2 px-8 pb-4 text-sm text-black">
                <li>Crea o usa una Pagina Facebook del ristorante.</li>
                <li>Passa Instagram a un profilo Business o Creator e collegalo alla Pagina.</li>
                <li>Clicca “{tt("social_connect_cta")}” e accedi con Facebook.</li>
                <li>Autorizza i permessi richiesti e scegli la Pagina.</li>
                <li>Fatto: l’account risulta “{tt("social_connected")}”.</li>
                <li>
                  <a
                    className="inline-flex items-center gap-1 font-medium text-[#c4956a] underline"
                    href="https://www.facebook.com/business/help/898752960195806"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Guida Meta <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              </ol>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
