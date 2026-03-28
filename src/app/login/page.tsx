"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail } from "lucide-react";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

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
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Sand texture overlay */}
      <div className="fixed inset-0 pointer-events-none" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 600 600' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        opacity: 0.03,
        mixBlendMode: 'multiply',
      }} />
      {/* Subtle sand dune waves */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.07]" style={{
        backgroundImage: `
          radial-gradient(ellipse 120% 30% at 20% 80%, #d4a574 0%, transparent 70%),
          radial-gradient(ellipse 100% 25% at 70% 90%, #c8956e 0%, transparent 60%),
          radial-gradient(ellipse 80% 20% at 50% 70%, #d4a574 0%, transparent 50%),
          radial-gradient(ellipse 140% 35% at 80% 60%, #c8956e 0%, transparent 65%)
        `,
      }} />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center">
           <img src="/logo.png" alt="BaliFlow" className="w-64 h-auto" />
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="py-8 px-4 sm:rounded-2xl sm:px-10" style={{
          background: 'rgba(252,246,237,0.85)',
          border: '2px solid #8b6540',
          boxShadow: '0 20px 60px rgba(139,101,64,0.25), 0 8px 24px rgba(139,101,64,0.15)',
        }}>
          <form className="space-y-6" onSubmit={handleLogin}>
            {error && (
              <div className="bg-red-50/80 text-red-700 p-3 rounded-md text-sm border border-red-200/50">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-stone-700">Email address</label>
              <div className="mt-1 relative rounded-lg">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 text-stone-400" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 sm:text-sm border p-2.5 rounded-lg focus:ring-2 focus:ring-[#d4a574] focus:border-[#d4a574] outline-none transition-all"
                  style={{
                    background: 'rgba(252,246,237,0.6)',
                    borderColor: 'rgba(225,202,178,0.5)',
                  }}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700">Password</label>
              <div className="mt-1 relative rounded-lg">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-stone-400" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 sm:text-sm border p-2.5 rounded-lg focus:ring-2 focus:ring-[#d4a574] focus:border-[#d4a574] outline-none transition-all"
                  style={{
                    background: 'rgba(252,246,237,0.6)',
                    borderColor: 'rgba(225,202,178,0.5)',
                  }}
                />
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Link href="/forgot-password" className="text-sm font-medium text-[#a17850] hover:text-[#8b6540]">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2.5 px-4 rounded-lg shadow-sm text-sm font-semibold text-white disabled:opacity-50 transition-all hover:shadow-md"
              style={{
                background: 'linear-gradient(135deg, #a17850 0%, #8b6540 100%)',
              }}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign in"}
            </button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full" style={{ borderTop: '1px solid rgba(225,202,178,0.4)' }} />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 text-stone-500" style={{ background: 'rgba(244,228,205,0.5)' }}>or</span>
              </div>
            </div>

            <button
              onClick={async () => {
                setGuestLoading(true);
                setError("");
                try {
                  const guestEmail = "guest@baliflow.com";
                  const guestPassword = "guest123456";

                  const { error: signInError } = await supabase.auth.signInWithPassword({
                    email: guestEmail,
                    password: guestPassword
                  });

                  if (signInError) {
                    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
                      email: guestEmail,
                      password: guestPassword,
                      options: { data: { name: "Guest User" } }
                    });
                    if (signUpError) throw signUpError;

                    const { error: retryError } = await supabase.auth.signInWithPassword({
                      email: guestEmail,
                      password: guestPassword
                    });
                    if (retryError) throw retryError;

                    if (signUpData?.user) {
                      await fetch("/api/guest-setup", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ userId: signUpData.user.id, email: guestEmail })
                      });
                    }
                  } else {
                    const { data: { user: currentUser } } = await supabase.auth.getUser();
                    if (currentUser) {
                      await fetch("/api/guest-setup", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ userId: currentUser.id, email: guestEmail })
                      });
                    }
                  }

                  router.push("/");
                  router.refresh();
                } catch (err: any) {
                  setError(err.message || "Failed to access as guest.");
                } finally {
                  setGuestLoading(false);
                }
              }}
              disabled={guestLoading}
              className="mt-4 w-full flex justify-center py-2.5 px-4 rounded-lg text-sm font-medium text-stone-600 disabled:opacity-50 transition-all hover:shadow-sm"
              style={{
                background: 'rgba(252,246,237,0.5)',
                border: '1px solid rgba(225,202,178,0.4)',
              }}
            >
              {guestLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue as Guest"}
            </button>
          </div>

          <p className="mt-6 text-center text-sm text-stone-500">
            Don't have an account?{" "}
            <Link href="/register" className="font-medium text-[#a17850] hover:text-[#8b6540]">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
