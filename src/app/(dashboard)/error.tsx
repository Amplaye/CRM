"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full items-center justify-center px-4">
      <div className="flex max-w-md flex-col items-center justify-center space-y-5 text-center p-8 rounded-2xl border-2" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <AlertTriangle className="h-6 w-6 text-red-600" />
        </div>
        <div>
           <h2 className="text-xl font-bold text-black tracking-tight">Something went wrong!</h2>
           <p className="mt-2 text-sm text-black">An unexpected error occurred while loading this view.</p>
        </div>
        <button
          onClick={() => reset()}
          className="inline-flex w-full items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
