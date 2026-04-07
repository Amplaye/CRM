"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, User, Building2, UtensilsCrossed, ShoppingBag, CalendarCheck, CheckCircle } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/lib/contexts/LanguageContext";

const businessTypes = [
  {
    value: "restaurant",
    label: "Restaurant",
    description: "Reservations, waitlist, table management",
    icon: UtensilsCrossed
  },
  {
    value: "ecommerce",
    label: "E-commerce",
    description: "Orders, catalog, customers",
    icon: ShoppingBag
  },
  {
    value: "services",
    label: "Services",
    description: "Appointments, calendar, clients",
    icon: CalendarCheck
  },
];

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const router = useRouter();
  const supabase = createClient();
  const { t } = useLanguage();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessType) {
      setError("Please select a business type.");
      return;
    }
    setError("");
    setLoading(true);

    try {
      // 1. Sign up the user
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/`
        }
      });
      if (signUpError) throw signUpError;

      // Check if email confirmation is required
      if (signUpData?.user?.identities?.length === 0) {
        setError("An account with this email already exists.");
        setLoading(false);
        return;
      }

      // If email is not confirmed yet (confirmation enabled), show message
      if (signUpData?.user && !signUpData.session) {
        // Create tenant immediately (user exists even before confirmation)
        await fetch("/api/register-tenant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: signUpData.user.id,
            businessName,
            businessType
          })
        });
        setStep(3); // Show confirmation message
        setLoading(false);
        return;
      }

      // If no email confirmation required, sign in and create tenant
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;

      if (signUpData?.user) {
        const res = await fetch("/api/register-tenant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: signUpData.user.id,
            businessName,
            businessType
          })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create workspace");
        }
      }

      router.push("/");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative z-10">
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
        <div className="py-8 px-4 sm:rounded-lg sm:px-10 border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm border border-red-200 mb-6">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-zinc-900 mb-3">{t("auth_business_type")}</label>
                <div className="space-y-3">
                  {businessTypes.map((bt) => (
                    <button
                      key={bt.value}
                      type="button"
                      onClick={() => setBusinessType(bt.value)}
                      className={`w-full flex items-center p-4 border-2 rounded-xl transition-all text-left ${
                        businessType === bt.value
                          ? "border-[#c4956a] shadow-sm"
                          : "border-[#c4956a]/40 hover:border-[#c4956a]"
                      }`}
                      style={{ background: businessType === bt.value ? 'rgba(196,149,106,0.15)' : 'rgba(252,246,237,0.6)' }}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0`} style={{ background: businessType === bt.value ? 'rgba(196,149,106,0.2)' : 'rgba(196,149,106,0.1)' }}>
                        <bt.icon className={`h-5 w-5 ${
                          businessType === bt.value ? "text-[#c4956a]" : "text-black"
                        }`} />
                      </div>
                      <div className="ml-4">
                        <p className={`text-sm font-semibold ${
                          businessType === bt.value ? "text-[#c4956a]" : "text-zinc-900"
                        }`}>{bt.label}</p>
                        <p className="text-xs text-black mt-0.5">{bt.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => {
                  if (!businessType) {
                    setError("Please select a business type.");
                    return;
                  }
                  setError("");
                  setStep(2);
                }}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#c4956a] transition-colors"
                style={{ background: 'linear-gradient(135deg, #c4956a 0%, #b8845c 100%)' }}
              >
                {t("auth_continue")}
              </button>
            </div>
          )}

          {step === 2 && (
            <form className="space-y-5" onSubmit={handleRegister}>
              <div>
                <label className="block text-sm font-medium text-black">{t("auth_your_name")}</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-4 w-4 text-black" />
                  </div>
                  <input
                    type="text"
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
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-10 sm:text-sm border-2 p-2.5 rounded-md focus:ring-[#c4956a] focus:border-[#c4956a]"
                    style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                    placeholder={t("auth_min_chars")}
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 flex justify-center py-2.5 px-4 border-2 rounded-md shadow-sm text-sm font-medium text-black transition-colors"
                  style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                >
                  {t("auth_back")}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#c4956a] disabled:opacity-50 transition-colors"
                  style={{ background: 'linear-gradient(135deg, #c4956a 0%, #b8845c 100%)' }}
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t("auth_create_account")}
                </button>
              </div>
            </form>
          )}

          {step === 3 && (
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

          {step !== 3 && (
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
