"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, User, Building2, UtensilsCrossed, ShoppingBag, CalendarCheck } from "lucide-react";
import Link from "next/link";

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
        options: { data: { name } }
      });
      if (signUpError) throw signUpError;

      // 2. Sign in immediately
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;

      // 3. Create tenant via API
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
    <div className="min-h-screen bg-zinc-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <img src="/logo.png" alt="BaliFlow" className="w-64 h-auto" />
        </div>
        <p className="mt-2 text-center text-sm text-zinc-500">
          Set up your CRM in 30 seconds
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-zinc-200">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm border border-red-200 mb-6">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-zinc-900 mb-3">What type of business do you run?</label>
                <div className="space-y-3">
                  {businessTypes.map((bt) => (
                    <button
                      key={bt.value}
                      type="button"
                      onClick={() => setBusinessType(bt.value)}
                      className={`w-full flex items-center p-4 border-2 rounded-xl transition-all text-left ${
                        businessType === bt.value
                          ? "border-terracotta-500 bg-terracotta-50 shadow-sm"
                          : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50"
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        businessType === bt.value ? "bg-terracotta-100" : "bg-zinc-100"
                      }`}>
                        <bt.icon className={`h-5 w-5 ${
                          businessType === bt.value ? "text-terracotta-600" : "text-zinc-500"
                        }`} />
                      </div>
                      <div className="ml-4">
                        <p className={`text-sm font-semibold ${
                          businessType === bt.value ? "text-terracotta-700" : "text-zinc-900"
                        }`}>{bt.label}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{bt.description}</p>
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
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-terracotta-600 hover:bg-terracotta-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-terracotta-500 transition-colors"
              >
                Continue
              </button>
            </div>
          )}

          {step === 2 && (
            <form className="space-y-5" onSubmit={handleRegister}>
              <div>
                <label className="block text-sm font-medium text-zinc-700">Your name</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-4 w-4 text-zinc-400" />
                  </div>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="block w-full pl-10 sm:text-sm border-zinc-300 border p-2.5 rounded-md focus:ring-terracotta-500 focus:border-terracotta-500"
                    placeholder="John Doe"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700">Business name</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Building2 className="h-4 w-4 text-zinc-400" />
                  </div>
                  <input
                    type="text"
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    className="block w-full pl-10 sm:text-sm border-zinc-300 border p-2.5 rounded-md focus:ring-terracotta-500 focus:border-terracotta-500"
                    placeholder="My Restaurant"
                  />
                </div>
              </div>

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
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-10 sm:text-sm border-zinc-300 border p-2.5 rounded-md focus:ring-terracotta-500 focus:border-terracotta-500"
                    placeholder="Min. 6 characters"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 flex justify-center py-2.5 px-4 border border-zinc-300 rounded-md shadow-sm text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50 transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-terracotta-600 hover:bg-terracotta-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-terracotta-500 disabled:opacity-50 transition-colors"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Create account"}
                </button>
              </div>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-zinc-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-terracotta-600 hover:text-terracotta-500">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
