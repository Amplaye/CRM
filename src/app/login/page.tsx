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
      {/* Animated sand dunes */}
      <div className="fixed inset-0 pointer-events-none z-0">
        {/* Dune wave 1 - slow */}
        <div className="absolute inset-0 animate-[dune1_12s_ease-in-out_infinite]" style={{
          background: 'radial-gradient(ellipse 160% 40% at 30% 85%, rgba(196,149,106,0.15) 0%, transparent 70%)',
        }} />
        {/* Dune wave 2 - medium */}
        <div className="absolute inset-0 animate-[dune2_8s_ease-in-out_infinite]" style={{
          background: 'radial-gradient(ellipse 140% 35% at 70% 75%, rgba(184,132,92,0.12) 0%, transparent 65%)',
        }} />
        {/* Dune wave 3 - fast shimmer */}
        <div className="absolute inset-0 animate-[dune3_15s_ease-in-out_infinite]" style={{
          background: 'radial-gradient(ellipse 120% 30% at 50% 65%, rgba(212,165,116,0.1) 0%, transparent 60%)',
        }} />
        {/* Wind streak 1 */}
        <div className="absolute h-[1px] top-[30%] animate-[wind_4s_linear_infinite]" style={{
          width: '40%',
          background: 'linear-gradient(90deg, transparent, rgba(196,149,106,0.3), transparent)',
        }} />
        {/* Wind streak 2 */}
        <div className="absolute h-[1px] top-[50%] animate-[wind_6s_linear_infinite_1s]" style={{
          width: '30%',
          background: 'linear-gradient(90deg, transparent, rgba(184,132,92,0.2), transparent)',
        }} />
        {/* Wind streak 3 */}
        <div className="absolute h-[1px] top-[70%] animate-[wind_5s_linear_infinite_2s]" style={{
          width: '35%',
          background: 'linear-gradient(90deg, transparent, rgba(212,165,116,0.25), transparent)',
        }} />
        {/* Floating sand particles */}
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${1 + (i % 3)}px`,
              height: `${1 + (i % 3)}px`,
              background: `rgba(${180 + (i * 3) % 30}, ${145 + (i * 2) % 25}, ${100 + (i * 4) % 30}, ${0.3 + (i % 5) * 0.1})`,
              top: `${10 + (i * 47) % 80}%`,
              left: `${(i * 53) % 100}%`,
              animation: `particle_${i % 4} ${3 + (i % 4)}s ease-in-out infinite ${(i * 0.5) % 3}s`,
            }}
          />
        ))}
      </div>

      {/* Keyframes */}
      <style jsx>{`
        @keyframes dune1 {
          0%, 100% { transform: translateX(0) scale(1); }
          50% { transform: translateX(30px) scale(1.05); }
        }
        @keyframes dune2 {
          0%, 100% { transform: translateX(0) scale(1); }
          50% { transform: translateX(-40px) scale(1.08); }
        }
        @keyframes dune3 {
          0%, 100% { transform: translateX(0) translateY(0); }
          33% { transform: translateX(20px) translateY(-10px); }
          66% { transform: translateX(-15px) translateY(5px); }
        }
        @keyframes wind {
          0% { left: -40%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { left: 120%; opacity: 0; }
        }
        @keyframes particle_0 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.4; }
          25% { transform: translate(60px, -15px) scale(1.5); opacity: 0.7; }
          50% { transform: translate(120px, -5px) scale(1); opacity: 0.3; }
          75% { transform: translate(60px, 10px) scale(1.3); opacity: 0.6; }
        }
        @keyframes particle_1 {
          0%, 100% { transform: translate(0, 0); opacity: 0.3; }
          50% { transform: translate(80px, -20px); opacity: 0.6; }
        }
        @keyframes particle_2 {
          0%, 100% { transform: translate(0, 0); opacity: 0.5; }
          33% { transform: translate(40px, -10px); opacity: 0.2; }
          66% { transform: translate(100px, 5px); opacity: 0.7; }
        }
        @keyframes particle_3 {
          0%, 100% { transform: translate(0, 0) rotate(0deg); opacity: 0.3; }
          50% { transform: translate(70px, -25px) rotate(180deg); opacity: 0.5; }
        }
      `}</style>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center">
           <img src="/logo.png" alt="BaliFlow" className="w-64 h-auto" style={{
             mask: 'radial-gradient(ellipse 85% 85% at center, black 50%, transparent 100%)',
             WebkitMask: 'radial-gradient(ellipse 85% 85% at center, black 50%, transparent 100%)',
           }} />
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="py-8 px-4 sm:rounded-2xl sm:px-10" style={{
          background: 'rgba(252,246,237,0.85)',
          border: '2px solid #c4956a',
          boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)',
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
            <Link href="/register" className="font-medium text-[#c4956a] hover:text-[#b8845c]">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
