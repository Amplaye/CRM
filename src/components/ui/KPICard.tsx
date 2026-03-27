import { ReactNode } from "react";
import { cn } from "@/components/layout/Sidebar";
import { useLanguage } from "@/lib/contexts/LanguageContext";

interface KPICardProps {
  title: string;
  value: string | number;
  trend?: {
    value: string;
    isPositive: boolean;
    label?: string;
  };
  icon: ReactNode;
  className?: string;
  valueClassName?: string;
}

export function KPICard({ title, value, trend, icon, className, valueClassName }: KPICardProps) {
  const { t } = useLanguage();
  return (
    <div className={cn("bg-white overflow-hidden shadow-sm rounded-xl border border-zinc-200", className)}>
      <div className="p-5">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className="p-3 bg-zinc-50 rounded-lg text-zinc-600">
              {icon}
            </div>
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-zinc-500 truncate">{title}</dt>
              <dd>
                <div className={cn("text-2xl font-bold text-zinc-900 tracking-tight", valueClassName)}>{value}</div>
              </dd>
            </dl>
          </div>
        </div>
      </div>
      {trend && (
        <div className="bg-zinc-50 px-5 py-3 border-t border-zinc-200">
          <div className="text-sm">
            <span className={cn(
              "font-medium",
              trend.isPositive ? "text-emerald-600" : "text-red-600"
            )}>
              {trend.value}
            </span>
            <span className="text-zinc-500 ml-2">{trend.label || t("from_last_week")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
