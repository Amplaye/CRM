"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, Globe, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/lib/contexts/LanguageContext";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const { language, setLanguage } = useLanguage();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push("/");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to sign in. Please verify your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col justify-center px-4 sm:px-6 lg:px-8 py-4 sm:py-6 relative overflow-hidden">
      {/* Language selector */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-20">
        <div className="flex items-center border-2 rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
          <Globe className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-black mr-1.5 sm:mr-2" />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as "en" | "es")}
            className="bg-transparent text-xs sm:text-sm font-medium text-black outline-none cursor-pointer"
          >
            <option value="en">EN</option>
            <option value="es">ES</option>
          </select>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md relative z-10">
        <div className="flex justify-center">
           <img src="/logo-horizontal.png" alt="BaliFlow" className="w-full h-auto max-w-full" />
        </div>
      </div>

      <div className="mt-3 sm:mt-4 mx-auto w-full max-w-md relative z-10">
        <div className="py-5 sm:py-6 px-5 sm:px-10 rounded-2xl" style={{
          background: 'rgba(252,246,237,0.85)',
          border: '2px solid #c4956a',
          boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)',
        }}>
          <form className="space-y-4 sm:space-y-5" onSubmit={handleLogin}>
            {error && (
              <div className="bg-red-50/80 text-red-700 p-3 rounded-md text-sm border border-red-200/50">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-black">Email address</label>
              <div className="mt-1 relative rounded-lg">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 text-black" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 text-sm border-2 p-2.5 rounded-lg focus:ring-2 focus:ring-[#c4956a] focus:border-[#c4956a] outline-none transition-all text-black placeholder:text-black/50"
                  style={{
                    background: 'rgba(252,246,237,0.6)',
                    borderColor: '#c4956a',
                  }}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-black">Password</label>
              <div className="mt-1 relative rounded-lg">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-black" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-10 text-sm border-2 p-2.5 rounded-lg focus:ring-2 focus:ring-[#c4956a] focus:border-[#c4956a] outline-none transition-all text-black placeholder:text-black/50"
                  style={{
                    background: 'rgba(252,246,237,0.6)',
                    borderColor: '#c4956a',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showPassword ? <EyeOff className="h-4 w-4 text-black/50 hover:text-black transition-colors" /> : <Eye className="h-4 w-4 text-black/50 hover:text-black transition-colors" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Link href="/forgot-password" className="text-sm font-medium text-[#c4956a] hover:text-[#b8845c]">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2.5 px-4 rounded-lg shadow-sm text-sm font-semibold text-white disabled:opacity-50 transition-all hover:shadow-md"
              style={{
                background: 'linear-gradient(135deg, #c4956a 0%, #b8845c 100%)',
              }}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign in"}
            </button>
          </form>


          <p className="mt-4 sm:mt-5 text-center text-sm text-black">
            Don't have an account?{" "}
            <Link href="/register" className="font-medium text-[#c4956a] hover:text-[#b8845c]">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
