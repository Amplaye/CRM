"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Loader2, Lock, CheckCircle } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";

export default function ResetPasswordPage() {
  const { t } = useLanguage();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("pwd_no_match"));
      return;
    }

    if (password.length < 6) {
      setError(t("pwd_too_short"));
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => router.push("/login"), 3000);
    } catch (err: any) {
      setError(err.message || t("pwd_reset_failed"));
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
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="py-8 px-4 sm:rounded-lg sm:px-10 border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
          {success ? (
            <div className="text-center space-y-4">
              <CheckCircle className="mx-auto h-12 w-12 text-emerald-500" />
              <h3 className="text-lg font-semibold text-zinc-900">{t("pwd_updated_title")}</h3>
              <p className="text-sm text-black">
                {t("pwd_redirecting")}
              </p>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              {error && (
                <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm border border-red-200">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-black">{t("pwd_new_label")}</label>
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
                    placeholder={t("pwd_min_chars")}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-black">{t("pwd_confirm_label")}</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-black" />
                  </div>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="block w-full pl-10 sm:text-sm border-2 p-2.5 rounded-md focus:ring-[#c4956a] focus:border-[#c4956a]"
                    style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                    placeholder={t("pwd_repeat_placeholder")}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#c4956a] disabled:opacity-50 transition-colors"
                style={{ background: 'linear-gradient(135deg, #c4956a 0%, #b8845c 100%)' }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t("pwd_update_button")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
