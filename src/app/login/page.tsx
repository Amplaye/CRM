"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/");
    } catch (err: any) {
      setError(err.message || "Failed to sign in. Please verify your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const copyDemoUser = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("password123");
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
           <div className="w-12 h-12 bg-terracotta-600 rounded-xl flex items-center justify-center shadow-lg">
             <span className="text-white font-bold text-xl tracking-tighter">TB</span>
           </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-zinc-900">
          Sign in to TableFlow AI
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
                  placeholder="admin@tableflow.ai"
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

          <div className="mt-8">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-zinc-500">Demo Accounts</span>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <button onClick={() => copyDemoUser('owner@oceanview.com')} className="text-xs text-left px-3 py-2 bg-zinc-50 border border-zinc-200 rounded hover:bg-zinc-100 text-zinc-600 font-medium transition-colors">Auto-fill: Owner (Oceanview)</button>
              <button onClick={() => copyDemoUser('manager@mountainpizza.com')} className="text-xs text-left px-3 py-2 bg-zinc-50 border border-zinc-200 rounded hover:bg-zinc-100 text-zinc-600 font-medium transition-colors">Auto-fill: Manager (Mountain Pizza)</button>
              <button onClick={() => copyDemoUser('host@oceanview.com')} className="text-xs text-left px-3 py-2 bg-zinc-50 border border-zinc-200 rounded hover:bg-zinc-100 text-zinc-600 font-medium transition-colors">Auto-fill: Host (Oceanview)</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
