"use client";

import { useEffect, useState } from "react";
import { Mail, CheckCircle2, XCircle, Loader2, KeyRound, ExternalLink, Unplug } from "lucide-react";
import { useTenant } from "@/lib/contexts/TenantContext";

// Settings → Email. Optional BYO Resend account, same self-service shape as
// Settings → Cassa: paste the key, test it, save it. Connecting one moves this
// tenant's sends onto its OWN free tier (1.000 marketing / 3.000 transactional
// per month); doing nothing keeps it on the platform's shared plan, which is the
// default and costs the tenant nothing to keep.
//
// The key goes to /api/marketing/email-provider and is encrypted server-side —
// it is never stored in tenants.settings and never comes back down to the browser.

interface Quota {
  sent: number;
  limit: number | null;
}

interface Usage {
  ownKey: boolean;
  marketing: Quota;
  transactional: Quota;
}

type Phase = "idle" | "testing" | "saving" | "disconnecting";

function QuotaBar({ label, quota, hint }: { label: string; quota: Quota; hint: string }) {
  const pct = quota.limit ? Math.min(100, Math.round((quota.sent / quota.limit) * 100)) : 0;
  // Amber past 80%: the owner should hear about a quota BEFORE it stops their sends.
  const bar = pct >= 100 ? "#dc2626" : pct >= 80 ? "#d97706" : "#c4956a";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-bold text-black">{label}</span>
        <span className="text-sm text-black tabular-nums">
          {quota.limit
            ? `${quota.sent.toLocaleString("it-IT")} / ${quota.limit.toLocaleString("it-IT")}`
            : `${quota.sent.toLocaleString("it-IT")} inviate`}
        </span>
      </div>
      {quota.limit ? (
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(196,149,106,0.18)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bar }} />
        </div>
      ) : null}
      <p className="text-xs text-black">{hint}</p>
    </div>
  );
}

export function EmailTab() {
  const { activeTenant: tenant } = useTenant();
  const [apiKey, setApiKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = async () => {
    if (!tenant?.id) return;
    try {
      const res = await fetch(`/api/marketing/email-provider?tenant_id=${tenant.id}`);
      const data = await res.json();
      setConnected(!!data?.connected);
      setUsage((data?.usage as Usage) || null);
    } catch {
      // A failed status read just leaves the panel on its defaults.
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  async function call(action: "test" | "save" | "disconnect") {
    if (!tenant?.id) return;
    setResult(null);
    setPhase(action === "test" ? "testing" : action === "save" ? "saving" : "disconnecting");
    try {
      const res = await fetch("/api/marketing/email-provider", {
        method: action === "disconnect" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenant.id,
          ...(action !== "disconnect" ? { api_key: apiKey.trim(), action } : {}),
        }),
      });
      const data = await res.json();
      if (action === "disconnect") {
        setResult({
          ok: !!data?.ok,
          msg: data?.ok ? "Disconnesso. Le email tornano sul piano condiviso." : data?.error || "Errore",
        });
      } else {
        setResult({ ok: !!data?.ok, msg: data?.test?.detail || data?.error || (data?.ok ? "OK" : "Connessione non riuscita") });
        if (action === "save" && data?.ok) setApiKey("");
      }
      await load();
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Errore" });
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const inputCls = "px-3 py-2 text-sm border-2 rounded-lg text-black w-full";
  const inputStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };
  const panelStyle = { borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-black flex items-center gap-2">
          <Mail className="w-5 h-5" /> Email
        </h2>
        <p className="mt-1 text-sm text-black">
          Vuoi email marketing e transazionali gratuite fino a 1.000 contatti al mese, invece di usare il piano
          condiviso? Crea un account gratuito su Resend e collega la tua chiave. È facoltativo: se non fai nulla,
          continui a inviare sul piano condiviso come oggi.
        </p>
      </div>

      {/* Status + monthly counter */}
      <div className="rounded-lg border-2 p-4 space-y-4" style={panelStyle}>
        <div className="flex items-center gap-2 text-sm">
          {connected ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          ) : (
            <Mail className="w-5 h-5" style={{ color: "#8b6540" }} />
          )}
          <div>
            <div className="font-bold text-black">
              {connected ? "Collegato al tuo account Resend" : "Piano condiviso"}
            </div>
            <div className="text-xs text-black">
              {connected
                ? "Le email partono dal tuo account e consumano le tue quote gratuite."
                : "Le email partono dall'account della piattaforma. Nessun costo per te."}
            </div>
          </div>
        </div>

        {usage && (
          <div className="grid gap-4 sm:grid-cols-2 pt-1">
            <QuotaBar
              label="Marketing (questo mese)"
              quota={usage.marketing}
              hint={
                usage.marketing.limit
                  ? "Campagne inviate ai tuoi contatti. Si azzera il 1° del mese."
                  : "Campagne inviate sul piano condiviso: nessun limite per te."
              }
            />
            <QuotaBar
              label="Transazionali (questo mese)"
              quota={usage.transactional}
              hint={
                usage.transactional.limit
                  ? "Conferme, gift card, promemoria. Si azzera il 1° del mese."
                  : "Conferme, gift card, promemoria: nessun limite per te."
              }
            />
          </div>
        )}
      </div>

      {/* Connect / disconnect */}
      {connected ? (
        <div className="rounded-lg border-2 p-4 space-y-3" style={panelStyle}>
          <p className="text-sm text-black">
            Puoi sostituire la chiave incollandone una nuova qui sotto, oppure disconnettere il tuo account e
            tornare al piano condiviso.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-black flex items-center gap-1">
              <KeyRound className="w-4 h-4" /> Nuova chiave API Resend
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="re_..."
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => call("save")}
              disabled={busy || !apiKey.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              {phase === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Sostituisci chiave
            </button>
            <button
              onClick={() => call("disconnect")}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg border-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              style={{ borderColor: "#c4956a", color: "#8b6540" }}
            >
              {phase === "disconnecting" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
              Disconnetti
            </button>
          </div>
          {result && (
            <div
              className={`flex items-start gap-2 text-sm rounded-lg p-3 ${result.ok ? "text-emerald-700" : "text-red-600"}`}
              style={{ background: result.ok ? "rgba(16,185,129,0.08)" : "rgba(220,38,38,0.06)" }}
            >
              {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{result.msg}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border-2 p-4 space-y-4" style={panelStyle}>
          <div className="space-y-2">
            <span className="text-sm font-bold text-black">Come collegare il tuo account (2 minuti)</span>
            <ol className="text-sm text-black space-y-1.5 list-decimal pl-5">
              <li>
                Vai su{" "}
                <a
                  href="https://resend.com/signup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold underline inline-flex items-center gap-1"
                  style={{ color: "#8b6540" }}
                >
                  resend.com/signup <ExternalLink className="w-3 h-3" />
                </a>{" "}
                e crea un account gratuito (non serve la carta).
              </li>
              <li>Nel pannello Resend, apri Domains → Add Domain e verifica un dominio che possiedi.</li>
              <li>Apri API Keys → Create API Key e copia la chiave (inizia con <code>re_</code>).</li>
              <li>Incolla la chiave qui sotto e premi &quot;Salva e collega&quot;.</li>
            </ol>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-black flex items-center gap-1">
              <KeyRound className="w-4 h-4" /> Chiave API Resend
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={inputCls}
              style={inputStyle}
              placeholder="re_..."
              autoComplete="off"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => call("test")}
              disabled={busy || !apiKey.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg border-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              style={{ borderColor: "#c4956a", color: "#8b6540" }}
            >
              {phase === "testing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Prova connessione
            </button>
            <button
              onClick={() => call("save")}
              disabled={busy || !apiKey.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              {phase === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Salva e collega
            </button>
          </div>

          {result && (
            <div
              className={`flex items-start gap-2 text-sm rounded-lg p-3 ${result.ok ? "text-emerald-700" : "text-red-600"}`}
              style={{ background: result.ok ? "rgba(16,185,129,0.08)" : "rgba(220,38,38,0.06)" }}
            >
              {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{result.msg}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
