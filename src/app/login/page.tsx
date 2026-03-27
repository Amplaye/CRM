"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail } from "lucide-react";

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
    <div className="min-h-screen bg-zinc-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
           <div className="w-12 h-12 bg-terracotta-600 rounded-xl flex items-center justify-center shadow-lg">
             <span className="text-white font-bold text-xl tracking-tighter">BF</span>
           </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-zinc-900">
          Sign in to BaliFlow CRM
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-zinc-200">
          <form className="space-y-6" onSubmit={handleLogin}>
            {error && (
              <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm border border-red-200">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-zinc-700">Email address</label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 text-zinc-400" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 sm:text-sm border-zinc-300 border p-2.5 rounded-md focus:ring-terracotta-500 focus:border-terracotta-500"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700">Password</label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-zinc-400" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 sm:text-sm border-zinc-300 border p-2.5 rounded-md focus:ring-terracotta-500 focus:border-terracotta-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-terracotta-600 hover:bg-terracotta-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-terracotta-500 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign in"}
            </button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-zinc-500">or</span>
              </div>
            </div>

            <button
              onClick={async () => {
                setGuestLoading(true);
                setError("");
                try {
                  const guestEmail = "guest@baliflow.com";
                  const guestPassword = "guest123456";

                  // Try to sign in first
                  const { error: signInError } = await supabase.auth.signInWithPassword({
                    email: guestEmail,
                    password: guestPassword
                  });

                  if (signInError) {
                    // If user doesn't exist, sign up
                    const { error: signUpError } = await supabase.auth.signUp({
                      email: guestEmail,
                      password: guestPassword,
                      options: { data: { name: "Guest User" } }
                    });
                    if (signUpError) throw signUpError;

                    // Sign in after signup
                    const { error: retryError } = await supabase.auth.signInWithPassword({
                      email: guestEmail,
                      password: guestPassword
                    });
                    if (retryError) throw retryError;
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
              className="mt-4 w-full flex justify-center py-2.5 px-4 border border-zinc-300 rounded-md shadow-sm text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-400 disabled:opacity-50 transition-colors"
            >
              {guestLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue as Guest"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
