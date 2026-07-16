"use client";

import { useMemo } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { ChartFrame } from "@/components/ChartFrame";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { Dictionary } from "@/lib/i18n/dictionaries/en";
import { menuEngineering, type MenuEngineeringInput, type MenuClass } from "@/lib/management/menu-engineering";

// The Kasavana–Smith menu-engineering matrix: each dish plotted by popularity (x,
// units sold) against unit margin (y, €). The dashed lines are the menu's average
// margin and the fair-share popularity cut; the four quadrants are coloured by
// class. Pure classification lives in lib/management/menu-engineering.ts — this
// only renders what it returns.

const CLASS_COLOR: Record<MenuClass, string> = {
  star: "#059669", // keep & feature
  plowhorse: "#c4956a", // popular, thin margin
  puzzle: "#2563eb", // profitable, ignored
  dog: "#dc2626", // drop / rework
};

export function MenuEngineeringMatrix({ input }: { input: MenuEngineeringInput[] }) {
  const { t } = useLanguage();
  const result = useMemo(() => menuEngineering(input), [input]);

  if (result.rows.length === 0) return null;

  const points = result.rows.map((r) => ({
    x: r.unitsSold,
    y: r.margin,
    name: r.name,
    klass: r.klass,
  }));

  const label = (k: MenuClass) =>
    ({
      star: t("me_star" as keyof Dictionary) || "Star",
      plowhorse: t("me_plowhorse" as keyof Dictionary) || "Cavallo da tiro",
      puzzle: t("me_puzzle" as keyof Dictionary) || "Enigma",
      dog: t("me_dog" as keyof Dictionary) || "Cane",
    }[k]);

  return (
    <div className="rounded-xl border-2 p-4" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}>
      <h2 className="text-sm font-bold text-black mb-1">{t("me_title" as keyof Dictionary) || "Menu engineering"}</h2>
      <p className="text-xs text-black mb-3">{t("me_subtitle" as keyof Dictionary) || "Ogni piatto per popolarità (venduti) e margine. Punta a spostare tutto verso le Star."}</p>

      <div className="flex flex-wrap gap-3 mb-3">
        {(["star", "puzzle", "plowhorse", "dog"] as MenuClass[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-xs text-black">
            <span className="w-3 h-3 rounded-full" style={{ background: CLASS_COLOR[k] }} />
            {label(k)} <span className="font-bold tabular-nums">{result.counts[k]}</span>
          </span>
        ))}
      </div>

      <div style={{ height: 300 }}>
        <ChartFrame>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7d8c5" />
            <XAxis
              type="number"
              dataKey="x"
              name={t("me_axis_popularity" as keyof Dictionary) || "Venduti"}
              tick={{ fontSize: 11 }}
              label={{ value: t("me_axis_popularity" as keyof Dictionary) || "Venduti", position: "insideBottom", offset: -12, fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={t("me_axis_margin" as keyof Dictionary) || "Margine €"}
              tick={{ fontSize: 11 }}
              unit="€"
            />
            <ZAxis range={[80, 80]} />
            <ReferenceLine y={result.avgMargin} stroke="#8b6540" strokeDasharray="4 4" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              formatter={(v: any, n: any) => (n === "y" ? `€ ${Number(v).toFixed(2)}` : Number(v))}
              labelFormatter={() => ""}
              content={({ payload }) => {
                const p = payload?.[0]?.payload;
                if (!p) return null;
                return (
                  <div className="rounded-lg border-2 bg-white px-2.5 py-1.5 text-xs text-black shadow" style={{ borderColor: "#c4956a" }}>
                    <div className="font-bold">{p.name}</div>
                    <div>{label(p.klass as MenuClass)}</div>
                    <div>{(t("me_axis_popularity" as keyof Dictionary) || "Venduti")}: {p.x}</div>
                    <div>{(t("me_axis_margin" as keyof Dictionary) || "Margine €")}: € {Number(p.y).toFixed(2)}</div>
                  </div>
                );
              }}
            />
            <Scatter data={points}>
              {points.map((p, i) => (
                <Cell key={i} fill={CLASS_COLOR[p.klass as MenuClass]} />
              ))}
            </Scatter>
          </ScatterChart>
        </ChartFrame>
      </div>
    </div>
  );
}
