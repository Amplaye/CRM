"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Mail, ArrowLeft, CheckCircle } from "lucide-react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
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
    <div className="min-h-screen bg-zinc-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <img src="/logo.jpg" alt="BaliFlow" className="w-64 h-auto" />
        </div>
        <p className="mt-2 text-center text-sm text-zinc-500">
          Enter your email and we'll send you a reset link
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-zinc-200">
          {sent ? (
            <div className="text-center space-y-4">
              <CheckCircle className="mx-auto h-12 w-12 text-emerald-500" />
              <h3 className="text-lg font-semibold text-zinc-900">Check your email</h3>
              <p className="text-sm text-zinc-500">
                We sent a password reset link to <strong>{email}</strong>. Click the link in the email to reset your password.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center text-sm font-medium text-terracotta-600 hover:text-terracotta-500"
              >
                <ArrowLeft className="h-4 w-4 mr-1" /> Back to sign in
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

              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-terracotta-600 hover:bg-terracotta-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-terracotta-500 disabled:opacity-50 transition-colors"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Send reset link"}
              </button>

              <div className="text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center text-sm font-medium text-zinc-500 hover:text-zinc-700"
                >
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
