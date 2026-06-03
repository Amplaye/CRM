"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, User, Building2, CheckCircle, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/lib/contexts/LanguageContext";

// Single vertical: this is the restaurant CRM. We no longer ask the user to
// pick a business type — every workspace is a restaurant. (The server forces
// business_type="restaurant" regardless of what the client sends.)
const BUSINESS_TYPE = "restaurant";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const router = useRouter();
  const supabase = createClient();
  const { t, language } = useLanguage();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // 1. Sign up the user. Stash the business name on the auth user so the
      // /onboarding step can create the tenant with the right name once the
      // user is authenticated (after email confirmation). We deliberately do
      // NOT create the tenant pre-confirmation: tenant creation requires a
      // session (see /api/register-tenant + /api/ensure-tenant).
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // `locale` is the language the user is registering in (auto-detected
          // from the browser on the login/register pages). Supabase exposes it
          // to the email templates as {{ .Data.locale }}, so the confirmation
          // email is rendered in the user's own language. Keep it in sync with
          // the resend path (/api/auth/resend-confirmation).
          data: { name, business_name: businessName, locale: language },
          // New owners land in the self-serve onboarding wizard, not an empty CRM.
          // We also carry the locale on the redirect so the interstitial
          // confirm page and any resend can stay in the same language.
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=/onboarding&lang=${language}`
        }
      });
      if (signUpError) throw signUpError;

      // Check if email confirmation is required
      if (signUpData?.user?.identities?.length === 0) {
        setError("An account with this email already exists.");
        setLoading(false);
        return;
      }

      // If email is not confirmed yet (confirmation enabled), just ask the user
      // to confirm. The tenant is created afterwards, when they land on
      // /onboarding with a real session (ensure-tenant uses the stashed
      // business_name). No tenant is minted before confirmation.
      if (signUpData?.user && !signUpData.session) {
        setStep(2); // Show confirmation message
        setLoading(false);
        return;
      }

      // If no email confirmation required, sign in and create tenant
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      fetch("/api/auth/log-login", { method: "POST" }).catch(() => {});

      if (signUpData?.user) {
        const res = await fetch("/api/register-tenant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: signUpData.user.id,
            businessName,
            businessType: BUSINESS_TYPE
          })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create workspace");
        }
      }

      router.push("/onboarding");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-5 sm:px-6 lg:px-8 relative z-10">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <img src="/logo.png" alt="BaliFlow" className="w-64 h-auto" style={{
             mask: 'radial-gradient(67% 90%, black 50%, transparent 75%)',
             WebkitMask: 'radial-gradient(67% 90%, black 50%, transparent 75%)',
           }} />
        </div>
        <p className="mt-2 text-center text-sm text-black">
          {t("auth_setup_tagline")}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="py-8 px-4 rounded-2xl sm:px-10 border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm border border-red-200 mb-6">
              {error}
            </div>
          )}

          {step === 1 && (
            <form className="space-y-5" onSubmit={handleRegister}>
              <div>
                <label className="block text-sm font-medium text-black">{t("auth_your_name")}</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-4 w-4 text-black" />
                  </div>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="block w-full pl-10 sm:text-sm border-2 p-2.5 rounded-md focus:ring-[#c4956a] focus:border-[#c4956a]"
                    style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                    placeholder={t("auth_name_placeholder")}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-black">{t("auth_business_name")}</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Building2 className="h-4 w-4 text-black" />
                  </div>
                  <input
                    type="text"
                    id="businessName"
                    name="organization"
                    autoComplete="organization"
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    className="block w-full pl-10 sm:text-sm border-2 p-2.5 rounded-md focus:ring-[#c4956a] focus:border-[#c4956a]"
                    style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                    placeholder={t("auth_business_placeholder")}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-black">{t("auth_email")}</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-black" />
                  </div>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full pl-10 sm:text-sm border-2 p-2.5 rounded-md focus:ring-[#c4956a] focus:border-[#c4956a]"
                    style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                    placeholder={t("auth_email_placeholder")}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-black">{t("auth_password")}</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-black" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    id="password"
                    name="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-10 pr-10 sm:text-sm border-2 p-2.5 rounded-md focus:ring-[#c4956a] focus:border-[#c4956a]"
                    style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                    placeholder={t("auth_min_chars")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-black/60 hover:text-black"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#c4956a] disabled:opacity-50 transition-colors"
                style={{ background: 'linear-gradient(135deg, #c4956a 0%, #b8845c 100%)' }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t("auth_create_account")}
              </button>
            </form>
          )}

          {step === 2 && (
            <div className="text-center space-y-4">
              <CheckCircle className="mx-auto h-12 w-12 text-emerald-500" />
              <h3 className="text-lg font-semibold text-zinc-900">{t("auth_check_email")}</h3>
              <p className="text-sm text-black">
                {t("auth_confirm_sent")} <strong>{email}</strong>. Click the link to activate your account.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center text-sm font-medium text-[#c4956a] hover:text-[#b8845c]"
              >
                Go to sign in
              </Link>
            </div>
          )}

          {step !== 2 && (
            <p className="mt-6 text-center text-sm text-black">
              {t("auth_has_account")}{" "}
              <Link href="/login" className="font-medium text-[#c4956a] hover:text-[#b8845c]">
                {t("auth_sign_in")}
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
