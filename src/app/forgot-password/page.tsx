"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Mail, ArrowLeft, CheckCircle } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/lib/contexts/LanguageContext";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const supabase = createClient();
  const { t } = useLanguage();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`
      });
      if (error) throw error;
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Failed to send reset email.");
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
          {t("auth_reset_desc")}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="py-8 px-4 sm:rounded-lg sm:px-10 border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
          {sent ? (
            <div className="text-center space-y-4">
              <CheckCircle className="mx-auto h-12 w-12 text-emerald-500" />
              <h3 className="text-lg font-semibold text-zinc-900">{t("auth_check_email")}</h3>
              <p className="text-sm text-black">
                {t("auth_reset_sent")} <strong>{email}</strong>. Click the link in the email to reset your password.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center text-sm font-medium text-[#c4956a] hover:text-[#b8845c]"
              >
                <ArrowLeft className="h-4 w-4 mr-1" /> {t("auth_back_to_login")}
              </Link>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              {error && (
                <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm border border-red-200">
                  {error}
                </div>
              )}

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

              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#c4956a] disabled:opacity-50 transition-colors"
                style={{ background: 'linear-gradient(135deg, #c4956a 0%, #b8845c 100%)' }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t("auth_send_reset")}
              </button>

              <div className="text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center text-sm font-medium text-black hover:text-black"
                >
                  <ArrowLeft className="h-4 w-4 mr-1" /> {t("auth_back_to_login")}
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
