import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] w-full items-center justify-center">
      <div className="flex flex-col items-center justify-center space-y-4 text-black">
        <Loader2 className="h-8 w-8 animate-spin text-terracotta-500" />
        <p className="text-sm font-medium tracking-tight">Loading TableFlow AI...</p>
      </div>
    </div>
  );
}
