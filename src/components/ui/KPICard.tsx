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
    <div className={cn("overflow-hidden rounded-xl border-2", className)} style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a', boxShadow: '0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15)' }}>
      <div className="p-5">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className="p-3 rounded-lg text-black" style={{ background: 'rgba(196,149,106,0.15)' }}>
              {icon}
            </div>
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-black truncate">{title}</dt>
              <dd>
                <div className={cn("text-2xl font-bold text-black tracking-tight", valueClassName)}>{value}</div>
              </dd>
            </dl>
          </div>
        </div>
      </div>
      {trend && (
        <div className="px-5 py-3 border-t" style={{ borderColor: '#c4956a' }}>
          <div className="text-sm">
            <span className={cn(
              "font-medium",
              trend.isPositive ? "text-emerald-600" : "text-red-600"
            )}>
              {trend.value}
            </span>
            <span className="text-black ml-2">{trend.label || t("from_last_week")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
