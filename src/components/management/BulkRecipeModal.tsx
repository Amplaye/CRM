"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, Loader2, X, ChevronDown, ChevronRight, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import type { ResolvedLine } from "@/lib/management/recipe-suggest";
import {
  toReviewLines,
  saveReviewedRecipe,
  RecipeReviewRow,
  type ReviewLine,
  type IngredientOption,
} from "./RecipeReview";

// Bulk "generate missing recipes" modal. Posts every recipe-less dish to
// /api/management/suggest-recipe in one call, then shows a per-dish review
// section (accept-all default, expandable to tweak). "Salva tutte" batch-saves
// every accepted dish (auto-creating missing ingredients) and reports back so
// the food-cost page recosts. An AI suggestion is a draft — nothing is written
// until the owner saves.

interface BulkDish {
  menuItemId: string;
  name: string;
  description: string | null;
  price: number | null;
}

type DishReview = {
  menuItemId: string;
  name: string;
  lines: ReviewLine[];
  open: boolean;
  saved: boolean;
};

export function BulkRecipeModal({
  tenantId,
  dishes,
  onClose,
  onSaved,
}: {
  tenantId: string;
  dishes: BulkDish[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const supabase = useMemo(() => createClient(), []);

  const [phase, setPhase] = useState<"loading" | "review" | "saving" | "error">("loading");
  const [reviews, setReviews] = useState<DishReview[]>([]);
  const [ingredients, setIngredients] = useState<IngredientOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Load the current warehouse for the ingredient selects (post-generation
      // it may include rows the AI proposed; refetched again after save anyway).
      const { data: ings } = await supabase
        .from("ingredients")
        .select("id, name, unit")
        .eq("tenant_id", tenantId)
        .eq("archived", false)
        .order("name");

      const nameById = (ings || []) as IngredientOption[];

      try {
        const res = await fetch("/api/management/suggest-recipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId,
            dishes: dishes.map((d) => ({
              menuItemId: d.menuItemId,
              name: d.name,
              description: d.description,
              price: d.price,
            })),
          }),
        });
        if (!res.ok) throw new Error("suggest failed");
        const data = (await res.json()) as { results: Array<{ menuItemId: string; lines: ResolvedLine[] }> };
        if (cancelled) return;
        const byId = new Map(data.results.map((r) => [r.menuItemId, r.lines]));
        setIngredients(nameById);
        setReviews(
          dishes.map((d, i) => ({
            menuItemId: d.menuItemId,
            name: d.name,
            lines: toReviewLines(byId.get(d.menuItemId) || []),
            open: i === 0, // first one expanded so the owner sees the shape
            saved: false,
          })),
        );
        setPhase("review");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, tenantId, dishes]);

  const updateLine = (dishIdx: number, lineIdx: number, next: ReviewLine) => {
    setReviews((prev) =>
      prev.map((d, i) =>
        i === dishIdx ? { ...d, lines: d.lines.map((l, j) => (j === lineIdx ? next : l)) } : d,
      ),
    );
  };

  const toggleOpen = (dishIdx: number) => {
    setReviews((prev) => prev.map((d, i) => (i === dishIdx ? { ...d, open: !d.open } : d)));
  };

  const saveAll = async () => {
    setPhase("saving");
    const next = [...reviews];
    for (let i = 0; i < next.length; i++) {
      const d = next[i];
      if (d.saved || d.lines.filter((l) => l.include).length === 0) continue;
      const { saved } = await saveReviewedRecipe(supabase, tenantId, d.menuItemId, d.lines, new Set());
      next[i] = { ...d, saved: saved > 0 };
    }
    setReviews(next);
    onSaved();
  };

  const totalAccepted = reviews.reduce((n, d) => n + d.lines.filter((l) => l.include).length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border bg-white shadow-xl"
        style={{ borderColor: "#c4956a" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "#e0d0b8" }}>
          <h2 className="text-lg font-bold text-black flex items-center gap-2">
            <Sparkles className="w-5 h-5" style={{ color: "#c4956a" }} />
            {t("food_cost_bulk_title")}
          </h2>
          <button onClick={onClose} className="p-1 cursor-pointer" aria-label="close">
            <X className="w-5 h-5 text-black" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === "loading" && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#c4956a" }} />
              <p className="text-sm text-black">{t("food_cost_bulk_loading")}</p>
            </div>
          )}

          {phase === "error" && (
            <div className="py-12 text-center text-sm text-red-600">{t("food_cost_bulk_error")}</div>
          )}

          {(phase === "review" || phase === "saving") && (
            <>
              <p className="text-xs mb-1" style={{ color: "#000" }}>{t("food_cost_ai_estimate_hint")}</p>
              <p className="text-xs mb-3" style={{ color: "#b45309" }}>{t("food_cost_ai_new_note")}</p>
              <div className="space-y-2">
                {reviews.map((d, dishIdx) => (
                  <div key={d.menuItemId} className="rounded-xl border" style={{ borderColor: "#e0d0b8" }}>
                    <button
                      onClick={() => toggleOpen(dishIdx)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 cursor-pointer text-left"
                    >
                      {d.saved ? (
                        <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : d.open ? (
                        <ChevronDown className="w-4 h-4 text-black shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-black shrink-0" />
                      )}
                      <span className="font-bold text-black flex-1 min-w-0 truncate">{d.name}</span>
                      <span className="text-xs shrink-0" style={{ color: "#000" }}>
                        {t("food_cost_cat_count").replace("{n}", String(d.lines.filter((l) => l.include).length))}
                      </span>
                    </button>
                    {d.open && !d.saved && (
                      <div className="px-3 pb-3 space-y-2">
                        {d.lines.length === 0 ? (
                          <p className="text-xs text-black">{t("food_cost_ai_no_lines")}</p>
                        ) : (
                          d.lines.map((l, lineIdx) => (
                            <RecipeReviewRow
                              key={lineIdx}
                              line={l}
                              options={ingredients}
                              createLabel={(name) => t("food_cost_create_ingredient").replace("{name}", name)}
                              matchedLabel={t("food_cost_ai_matched")}
                              newLabel={t("food_cost_ai_new")}
                              onChange={(next) => updateLine(dishIdx, lineIdx, next)}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {(phase === "review" || phase === "saving") && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: "#e0d0b8" }}>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-bold rounded-xl border cursor-pointer text-black bg-white/70"
              style={{ borderColor: "#d9c3a3" }}
            >
              {t("cancel")}
            </button>
            <button
              onClick={saveAll}
              disabled={phase === "saving" || totalAccepted === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl cursor-pointer text-white disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              {phase === "saving" && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("food_cost_save_all")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
