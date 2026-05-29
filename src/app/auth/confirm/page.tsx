"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Loader2, MailCheck } from "lucide-react";

// Interstitial confirmation page that the account-confirmation email links to.
//
// Why this exists instead of pointing the email straight at /auth/callback:
// mobile mail apps (Gmail iOS/Android, Outlook, Apple Mail link previews, and
// corporate link scanners) PREFETCH every link in the background. Supabase
// email OTPs are single-use, so that silent prefetch consumes the token before
// the human ever taps it — and when they do tap, verifyOtp fails and the user
// is bounced to /login. That is exactly the "the button didn't open the wizard"
// bug Sofía hit on her phone.
//
// The fix: the email links HERE, to a plain page that does NOT verify anything
// on load. Verification only fires on an explicit button press (navigating to
// /auth/callback). Scanners GET-prefetch this page harmlessly — they don't run
// the click — so the one-time token survives intact until the real user acts.
// Works on every device and browser because nothing here depends on a cookie
// set at sign-up.
function ConfirmInner() {
  const params = useSearchParams();
  const tokenHash = params.get("token_hash") ?? "";
  const type = params.get("type") ?? "email";
  const next = params.get("next") ?? "/onboarding";
  // Legacy PKCE links may still arrive with ?code= instead of a token_hash;
  // forward whatever we got so /auth/callback can handle either.
  const code = params.get("code") ?? "";

  const [clicked, setClicked] = useState(false);

  // Build the verifier URL the button navigates to. A full-page navigation (not
  // fetch) is intentional: /auth/callback writes the session cookie onto its
  // redirect response, and a top-level navigation lets the browser persist it.
  const verifyUrl = (() => {
    const u = new URLSearchParams();
    if (tokenHash) { u.set("token_hash", tokenHash); u.set("type", type); }
    else if (code) { u.set("code", code); }
    u.set("next", next);
    return `/auth/callback?${u.toString()}`;
  })();

  const hasToken = Boolean(tokenHash || code);

  // Once the user taps, do a real navigation so the cookie sticks.
  useEffect(() => {
    if (clicked) window.location.href = verifyUrl;
  }, [clicked, verifyUrl]);

  return (
    <div className="min-h-[100dvh] flex flex-col justify-center py-12 px-4 relative z-10">
      <div className="mx-auto w-full max-w-md">
        <div className="flex justify-center mb-6">
          <img src="/logo.png" alt="Bali Flow" className="w-48 h-auto" />
        </div>
        <div
          className="py-8 px-6 sm:px-10 rounded-2xl border-2 text-center"
          style={{ background: "rgba(252,246,237,0.9)", borderColor: "#c4956a", boxShadow: "0 20px 60px rgba(196,149,106,0.2)" }}
        >
          {hasToken ? (
            <>
              <MailCheck className="mx-auto h-12 w-12 text-[#c4956a]" />
              <h1 className="mt-4 text-xl font-bold text-[#7a2211]">Confirma tu cuenta</h1>
              <p className="mt-2 text-sm text-black/80">
                Pulsa el botón para activar tu cuenta y empezar a configurar tu CRM.
              </p>
              <button
                type="button"
                onClick={() => setClicked(true)}
                disabled={clicked}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-white font-bold disabled:opacity-60 transition-colors"
                style={{ background: "linear-gradient(135deg, #c4956a 0%, #b8845c 100%)" }}
              >
                {clicked ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                {clicked ? "Activando…" : "Confirmar mi cuenta"}
              </button>
              <p className="mt-4 text-[11px] text-black/50">
                Si ya confirmaste tu cuenta, puedes{" "}
                <Link href="/login" className="font-semibold text-[#c4956a] hover:text-[#b8845c]">iniciar sesión</Link>.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-[#7a2211]">Enlace no válido</h1>
              <p className="mt-2 text-sm text-black/80">
                Este enlace de confirmación no es válido o ya fue utilizado. Inicia sesión con tu correo y contraseña.
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex items-center justify-center gap-2 py-3 px-5 rounded-lg text-white font-bold transition-colors"
                style={{ background: "linear-gradient(135deg, #c4956a 0%, #b8845c 100%)" }}
              >
                Iniciar sesión
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-[#c4956a]" /></div>}>
      <ConfirmInner />
    </Suspense>
  );
}
