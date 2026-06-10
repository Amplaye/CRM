"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Loader2, MailCheck, RefreshCw } from "lucide-react";
import { en, Dictionary } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import { it } from "@/lib/i18n/dictionaries/it";
import { de } from "@/lib/i18n/dictionaries/de";

// Interstitial confirmation page that the account-confirmation email links to.
//
// Why this exists instead of pointing the email straight at /auth/callback:
// mobile mail apps (Gmail iOS/Android, Outlook, Apple Mail link previews, and
// corporate link scanners) PREFETCH every link in the background. Supabase
// email OTPs are single-use, so that silent prefetch consumes the token before
// the human ever taps it — and when they do tap, verifyOtp fails and the user
// is bounced. That is exactly the "the button didn't open the wizard" bug.
//
// The fix: the email links HERE, to a plain page that does NOT verify anything
// on load. Verification only fires on an explicit button press (navigating to
// /auth/callback). Scanners GET-prefetch this page harmlessly — they don't run
// the click — so the one-time token survives intact until the real user acts.
//
// Language: the email carries ?lang=it|es|en|de (the language the user
// registered in). We render this page in THAT language, independent of the
// browser / localStorage, so it always matches the email the user just opened.
const DICTS: Record<string, Dictionary> = { en, es, it, de };

function pickDict(lang: string | null): Dictionary {
  return (lang && DICTS[lang]) || it; // default Italian (primary user base)
}

function ConfirmInner() {
  const params = useSearchParams();
  const tokenHash = params.get("token_hash") ?? "";
  const type = params.get("type") ?? "email";
  const next = params.get("next") ?? "/onboarding";
  // Legacy PKCE links may still arrive with ?code= instead of a token_hash;
  // forward whatever we got so /auth/callback can handle either.
  const code = params.get("code") ?? "";
  // Language chosen at signup, passed through the email link.
  const lang = params.get("lang");
  // Set when /auth/callback bounced here after a dead (expired/used) token.
  const expired = params.get("expired") === "1";
  // Email carried from the email link / callback, used to auto-resend.
  const emailParam = params.get("email") ?? "";
  const d = pickDict(lang);
  const t = (k: keyof Dictionary) => d[k] || en[k] || (k as string);

  const [clicked, setClicked] = useState(false);

  // Resend state (shown when the link is missing/used/expired).
  const [email, setEmail] = useState(emailParam);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState("");
  // Guards the one-shot auto-resend so it can't loop or double-fire.
  const [autoTried, setAutoTried] = useState(false);

  // Build the verifier URL the button navigates to. A full-page navigation (not
  // fetch) is intentional: /auth/callback writes the session cookie onto its
  // redirect response, and a top-level navigation lets the browser persist it.
  const verifyUrl = (() => {
    const u = new URLSearchParams();
    if (tokenHash) { u.set("token_hash", tokenHash); u.set("type", type); }
    else if (code) { u.set("code", code); }
    u.set("next", next);
    if (lang) u.set("lang", lang);
    // Forwarded so a failed verify in /auth/callback can route back here and
    // auto-resend without asking the user to retype their address.
    if (emailParam) u.set("email", emailParam);
    return `/auth/callback?${u.toString()}`;
  })();

  // Only offer the verify button when we have BOTH a token AND we weren't sent
  // here because that token already died.
  const hasToken = Boolean(tokenHash || code) && !expired;

  // Once the user taps, do a real navigation so the cookie sticks.
  useEffect(() => {
    if (clicked) window.location.href = verifyUrl;
  }, [clicked, verifyUrl]);

  const doResend = async (addr: string) => {
    setResendError("");
    setResending(true);
    try {
      const res = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr, lang: lang || "it" }),
      });
      // Always succeed silently to avoid leaking which emails exist; the API
      // returns ok for both "sent" and "nothing to do".
      if (!res.ok) throw new Error("resend_failed");
      setResent(true);
    } catch {
      setResendError(t("auth_confirm_resend_error"));
    } finally {
      setResending(false);
    }
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    await doResend(email);
  };

  // Automatic resend: when the callback bounced us here with ?expired=1 and we
  // already know the email, fire ONE resend immediately — the user requested
  // that an expired link sends a new one with no extra step. One-shot guarded.
  useEffect(() => {
    if (expired && emailParam && !autoTried) {
      setAutoTried(true);
      void doResend(emailParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired, emailParam, autoTried]);

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
              <h1 className="mt-4 text-xl font-bold text-[#7a2211]">{t("auth_confirm_title")}</h1>
              <p className="mt-2 text-sm text-black">{t("auth_confirm_sub")}</p>
              <button
                type="button"
                onClick={() => setClicked(true)}
                disabled={clicked}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-white font-bold disabled:opacity-60 transition-colors"
                style={{ background: "linear-gradient(135deg, #c4956a 0%, #b8845c 100%)" }}
              >
                {clicked ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                {clicked ? t("auth_confirm_activating") : t("auth_confirm_cta")}
              </button>
              <p className="mt-4 text-[11px] text-black">
                {t("auth_confirm_already")}{" "}
                <Link href="/login" className="font-semibold text-[#c4956a] hover:text-[#b8845c]">{t("auth_confirm_signin_link")}</Link>.
              </p>
            </>
          ) : resent ? (
            <>
              <MailCheck className="mx-auto h-12 w-12 text-emerald-500" />
              <p className="mt-4 text-sm text-black">{t("auth_confirm_resend_done")}</p>
              <Link
                href="/login"
                className="mt-6 inline-flex items-center justify-center gap-2 py-3 px-5 rounded-lg text-white font-bold transition-colors"
                style={{ background: "linear-gradient(135deg, #c4956a 0%, #b8845c 100%)" }}
              >
                {t("auth_confirm_signin_link")}
              </Link>
            </>
          ) : expired && emailParam && !resendError ? (
            // Auto-resend is in flight (we know the email): show a calm spinner
            // instead of flashing the manual form. Resolves to the `resent`
            // success card above, or to the manual form below on error.
            <>
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-[#c4956a]" />
              <p className="mt-4 text-sm text-black">{t("auth_confirm_resend_sending")}</p>
            </>
          ) : (
            <>
              <RefreshCw className="mx-auto h-10 w-10 text-[#c4956a]" />
              <h1 className="mt-4 text-xl font-bold text-[#7a2211]">{t("auth_confirm_invalid_title")}</h1>
              <p className="mt-2 text-sm text-black">{t("auth_confirm_invalid_sub")}</p>
              <form onSubmit={handleResend} className="mt-5 space-y-3">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("auth_confirm_email_placeholder")}
                  className="block w-full text-sm border-2 p-2.5 rounded-lg outline-none transition-all text-black placeholder:text-black"
                  style={{ background: "rgba(252,246,237,0.6)", borderColor: "#c4956a" }}
                />
                {resendError && (
                  <p className="text-xs text-red-700">{resendError}</p>
                )}
                <button
                  type="submit"
                  disabled={resending}
                  className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-white font-bold disabled:opacity-60 transition-colors"
                  style={{ background: "linear-gradient(135deg, #c4956a 0%, #b8845c 100%)" }}
                >
                  {resending ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                  {resending ? t("auth_confirm_resend_sending") : t("auth_confirm_resend_cta")}
                </button>
              </form>
              <p className="mt-4 text-[11px] text-black">
                {t("auth_confirm_already")}{" "}
                <Link href="/login" className="font-semibold text-[#c4956a] hover:text-[#b8845c]">{t("auth_confirm_signin_link")}</Link>.
              </p>
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
