"use client";

import {
  UtensilsCrossed,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Save,
  X,
  Trash2,
  Settings2,
  FolderPlus,
  Eye,
  EyeOff,
  Upload,
  QrCode,
  Loader2,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import type { MenuCategory, MenuItem, Tenant } from "@/lib/types";
import type { ExtractedMenu, ExtractedMenuItem } from "@/lib/menu/extract";
import { QRCodeSVG } from "qrcode.react";

type EditMode = "item" | "category" | null;

const COMMON_ALLERGENS = [
  "glutine",
  "latticini",
  "uova",
  "pesce",
  "crostacei",
  "frutta_secca",
  "arachidi",
  "soia",
  "sedano",
  "senape",
  "sesamo",
  "solfiti",
  "lupini",
  "molluschi",
];

const COMMON_TAGS = ["vegano", "vegetariano", "piccante", "consigliato"];

export default function MenuPage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const supabase = createClient();

  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>(null);

  // Item edit state
  const [editItemName, setEditItemName] = useState("");
  const [editItemDescription, setEditItemDescription] = useState("");
  const [editItemPrice, setEditItemPrice] = useState<string>("");
  const [editItemCategoryId, setEditItemCategoryId] = useState<string>("");
  const [editItemAllergens, setEditItemAllergens] = useState<string[]>([]);
  const [editItemTags, setEditItemTags] = useState<string[]>([]);
  const [editItemAvailable, setEditItemAvailable] = useState(true);

  // Category edit state
  const [editCategoryName, setEditCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  // Fetch + realtime
  useEffect(() => {
    if (!tenant) return;

    const fetchAll = async () => {
      const [{ data: cats }, { data: its }] = await Promise.all([
        supabase
          .from("menu_categories")
          .select("*")
          .eq("tenant_id", tenant.id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("menu_items")
          .select("*")
          .eq("tenant_id", tenant.id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);
      setCategories((cats || []) as MenuCategory[]);
      setItems((its || []) as MenuItem[]);
      setLoading(false);
    };

    fetchAll();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchAll, 400);
    };

    const channel = supabase
      .channel("menu_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_categories", filter: `tenant_id=eq.${tenant.id}` },
        debounced
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_items", filter: `tenant_id=eq.${tenant.id}` },
        debounced
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [tenant]);

  const selectedItem = items.find((i) => i.id === selectedItemId) || null;

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((it) => {
      if (it.name.toLowerCase().includes(q)) return true;
      if (it.description.toLowerCase().includes(q)) return true;
      if (it.allergens.some((a) => a.toLowerCase().includes(q))) return true;
      if (it.tags.some((tg) => tg.toLowerCase().includes(q))) return true;
      const cat = categories.find((c) => c.id === it.category_id);
      if (cat && cat.name.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [items, categories, search]);

  const groupedItems = useMemo(() => {
    const map = new Map<string | null, MenuItem[]>();
    for (const it of filteredItems) {
      const key = it.category_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return categories
      .map((c) => ({ category: c, items: map.get(c.id) || [] }))
      .concat(
        map.has(null) ? [{ category: null as unknown as MenuCategory, items: map.get(null) || [] }] : []
      )
      .filter((g) => g.items.length > 0);
  }, [filteredItems, categories]);

  // Handlers
  const resetItemEditState = () => {
    setEditItemName("");
    setEditItemDescription("");
    setEditItemPrice("");
    setEditItemCategoryId(categories[0]?.id || "");
    setEditItemAllergens([]);
    setEditItemTags([]);
    setEditItemAvailable(true);
  };

  const handleStartNewItem = () => {
    setSelectedItemId(null);
    resetItemEditState();
    setEditMode("item");
  };

  const handleStartEditItem = (it: MenuItem) => {
    setSelectedItemId(it.id);
    setEditItemName(it.name);
    setEditItemDescription(it.description);
    setEditItemPrice(it.price != null ? String(it.price) : "");
    setEditItemCategoryId(it.category_id || "");
    setEditItemAllergens(it.allergens);
    setEditItemTags(it.tags);
    setEditItemAvailable(it.available);
    setEditMode("item");
  };

  const handleStartNewCategory = () => {
    setEditingCategoryId(null);
    setEditCategoryName("");
    setEditMode("category");
  };

  const handleStartEditCategory = (cat: MenuCategory) => {
    setEditingCategoryId(cat.id);
    setEditCategoryName(cat.name);
    setEditMode("category");
  };

  const handleSaveItem = async () => {
    if (!tenant || !editItemName.trim()) return;
    setSaving(true);
    const priceNum = editItemPrice.trim() === "" ? null : Number(editItemPrice.replace(",", "."));
    const payload = {
      tenant_id: tenant.id,
      category_id: editItemCategoryId || null,
      name: editItemName.trim(),
      description: editItemDescription.trim(),
      price: priceNum != null && !Number.isNaN(priceNum) ? priceNum : null,
      currency: "EUR",
      allergens: editItemAllergens,
      tags: editItemTags,
      available: editItemAvailable,
    };
    if (selectedItemId) {
      const { error } = await supabase.from("menu_items").update(payload).eq("id", selectedItemId);
      if (error) console.error(error);
    } else {
      const { data, error } = await supabase
        .from("menu_items")
        .insert(payload)
        .select()
        .single();
      if (error) console.error(error);
      else if (data) setSelectedItemId((data as MenuItem).id);
    }
    setSaving(false);
    setEditMode(null);
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm(t("menu_confirm_delete_item") || "Eliminare questo piatto?")) return;
    await supabase.from("menu_items").delete().eq("id", id);
    if (selectedItemId === id) setSelectedItemId(null);
    setEditMode(null);
  };

  const handleSaveCategory = async () => {
    if (!tenant || !editCategoryName.trim()) return;
    setSaving(true);
    if (editingCategoryId) {
      await supabase
        .from("menu_categories")
        .update({ name: editCategoryName.trim() })
        .eq("id", editingCategoryId);
    } else {
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0);
      await supabase.from("menu_categories").insert({
        tenant_id: tenant.id,
        name: editCategoryName.trim(),
        sort_order: maxOrder + 1,
      });
    }
    setSaving(false);
    setEditMode(null);
  };

  const handleDeleteCategory = async (id: string) => {
    const used = items.filter((i) => i.category_id === id).length;
    const msg = used > 0
      ? `${t("menu_confirm_delete_cat_used") || "Categoria con piatti collegati"} (${used}). ${t("menu_items_become_uncategorized") || "I piatti diventeranno senza categoria."}`
      : t("menu_confirm_delete_cat") || "Eliminare questa categoria?";
    if (!confirm(msg)) return;
    await supabase.from("menu_categories").delete().eq("id", id);
    setEditMode(null);
  };

  const toggleArrayValue = (current: string[], value: string): string[] =>
    current.includes(value) ? current.filter((v) => v !== value) : [...current, value];

  return (
    <div className="p-0 h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-4rem)] flex overflow-hidden">
      {/* LEFT PANE: categories + items list */}
      <div
        className={`border-r flex flex-col shrink-0 ${
          selectedItemId || editMode ? "hidden md:flex md:w-[420px]" : "w-full md:w-[420px]"
        }`}
        style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}
      >
        <div className="p-6 border-b shrink-0" style={{ borderColor: "#c4956a" }}>
          <h1 className="text-xl font-bold text-black tracking-tight">
            {t("menu_title") || "Menu"}
          </h1>
          <p className="text-xs text-black mt-1">
            {t("menu_subtitle") || "Piatti, categorie, allergeni del ristorante"}
          </p>

          <div className="mt-6 flex space-x-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("menu_search_placeholder") || "Cerca piatto, allergene, categoria..."}
                className="w-full pl-9 pr-3 py-2 border-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
              />
            </div>
            <button
              onClick={handleStartNewItem}
              className="cursor-pointer p-2 text-white rounded-lg transition-colors shadow-sm"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              title={t("menu_new_item") || "Nuovo piatto"}
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-3 flex gap-2 flex-wrap">
            <button
              onClick={handleStartNewCategory}
              className="cursor-pointer text-xs font-bold text-black inline-flex items-center px-2.5 py-1.5 rounded-md border-2 hover:bg-[#c4956a]/10 transition-colors"
              style={{ borderColor: "#c4956a" }}
            >
              <FolderPlus className="w-3.5 h-3.5 mr-1.5" />
              {t("menu_new_category") || "Nuova categoria"}
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className="cursor-pointer text-xs font-bold text-white inline-flex items-center px-2.5 py-1.5 rounded-md shadow-sm transition-colors"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              title={t("menu_import") || "Importa menu"}
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              {t("menu_import") || "Importa menu"}
            </button>
            <button
              onClick={() => setQrOpen(true)}
              className="cursor-pointer text-xs font-bold text-black inline-flex items-center px-2.5 py-1.5 rounded-md border-2 hover:bg-[#c4956a]/10 transition-colors"
              style={{ borderColor: "#c4956a" }}
              title={t("menu_generate_qr") || "Genera QR"}
            >
              <QrCode className="w-3.5 h-3.5 mr-1.5" />
              {t("menu_generate_qr") || "Genera QR"}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 space-y-4 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 bg-zinc-200 rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center text-black">
              <UtensilsCrossed className="w-12 h-12 mx-auto mb-4 opacity-10" />
              <p className="text-sm font-bold">
                {t("menu_empty_list") || "Nessun piatto"}
              </p>
              <p className="text-xs mt-1">
                {t("menu_empty_hint") ||
                  "Crea una categoria e poi aggiungi piatti, oppure importa il menu da PDF/URL."}
              </p>
            </div>
          ) : groupedItems.length === 0 ? (
            <div className="p-12 text-center text-black">
              <Search className="w-10 h-10 mx-auto mb-4 opacity-20" />
              <p className="text-sm font-bold">
                {t("menu_no_results") || "Nessun risultato"}
              </p>
            </div>
          ) : (
            <div>
              {groupedItems.map((group) => (
                <div key={group.category?.id || "uncat"}>
                  <div className="px-5 py-2 sticky top-0 z-10 flex items-center justify-between" style={{ background: "rgba(252,246,237,0.95)" }}>
                    <span className="text-[10px] uppercase font-black tracking-widest text-black">
                      {group.category?.name || t("menu_uncategorized") || "Senza categoria"}
                    </span>
                    {group.category && (
                      <button
                        onClick={() => handleStartEditCategory(group.category!)}
                        className="cursor-pointer text-black/60 hover:text-black"
                        title={t("menu_edit_category") || "Modifica categoria"}
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="divide-y" style={{ borderColor: "rgba(196,149,106,0.3)" }}>
                    {group.items.map((it) => (
                      <div
                        key={it.id}
                        onClick={() => setSelectedItemId(it.id)}
                        className={`p-4 sm:p-5 cursor-pointer transition-all ${
                          selectedItemId === it.id
                            ? "bg-white shadow-sm ring-1 ring-zinc-200"
                            : "bg-transparent hover:bg-zinc-50/80"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-black text-sm leading-tight truncate">
                                {it.name}
                              </h3>
                              {!it.available && (
                                <span className="text-[10px] uppercase font-bold tracking-widest text-black/50">
                                  {t("menu_unavailable") || "Esaurito"}
                                </span>
                              )}
                            </div>
                            {it.description && (
                              <p className="text-xs text-black/70 line-clamp-1 mt-1">
                                {it.description}
                              </p>
                            )}
                            {(it.allergens.length > 0 || it.tags.length > 0) && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {it.tags.map((tg) => (
                                  <span
                                    key={tg}
                                    className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700"
                                  >
                                    {tg}
                                  </span>
                                ))}
                                {it.allergens.map((al) => (
                                  <span
                                    key={al}
                                    className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-orange-50 text-orange-700"
                                  >
                                    {al}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          {it.price != null && (
                            <span className="text-sm font-bold text-black whitespace-nowrap">
                              {it.price.toFixed(2)} {it.currency === "EUR" ? "€" : it.currency}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANE: detail / edit */}
      <div
        className={`flex-1 overflow-y-auto flex flex-col ${
          !selectedItemId && !editMode ? "hidden md:flex" : ""
        }`}
        style={{ background: "rgba(252,246,237,0.85)" }}
      >
        {editMode === "category" ? (
          <CategoryEditPane
            t={t}
            saving={saving}
            categoryName={editCategoryName}
            setCategoryName={setEditCategoryName}
            isEditing={!!editingCategoryId}
            onCancel={() => setEditMode(null)}
            onSave={handleSaveCategory}
            onDelete={
              editingCategoryId ? () => handleDeleteCategory(editingCategoryId) : undefined
            }
          />
        ) : editMode === "item" ? (
          <ItemEditPane
            t={t}
            categories={categories}
            saving={saving}
            isEditing={!!selectedItemId}
            name={editItemName}
            setName={setEditItemName}
            description={editItemDescription}
            setDescription={setEditItemDescription}
            price={editItemPrice}
            setPrice={setEditItemPrice}
            categoryId={editItemCategoryId}
            setCategoryId={setEditItemCategoryId}
            allergens={editItemAllergens}
            setAllergens={setEditItemAllergens}
            tags={editItemTags}
            setTags={setEditItemTags}
            available={editItemAvailable}
            setAvailable={setEditItemAvailable}
            onToggleArr={toggleArrayValue}
            onCancel={() => setEditMode(null)}
            onSave={handleSaveItem}
            onDelete={selectedItemId ? () => handleDeleteItem(selectedItemId) : undefined}
          />
        ) : selectedItem ? (
          <ItemDetailPane
            t={t}
            item={selectedItem}
            categoryName={categories.find((c) => c.id === selectedItem.category_id)?.name || null}
            onBack={() => setSelectedItemId(null)}
            onEdit={() => handleStartEditItem(selectedItem)}
            onDelete={() => handleDeleteItem(selectedItem.id)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <div className="h-24 w-24 bg-zinc-50 rounded-full flex items-center justify-center mb-6">
              <UtensilsCrossed className="w-10 h-10 text-zinc-200" />
            </div>
            <h2 className="text-2xl font-black text-black tracking-tight">
              {t("menu_title") || "Menu"}
            </h2>
            <p className="text-black max-w-sm mt-2 leading-relaxed font-medium">
              {t("menu_empty_desc") ||
                "Seleziona un piatto dalla lista o creane uno nuovo. Puoi anche importare il menu del ristorante da PDF/URL."}
            </p>
            <button
              onClick={handleStartNewItem}
              className="cursor-pointer mt-8 px-8 py-3 text-white font-bold rounded-2xl transition-all flex items-center group"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform" />
              {t("menu_create_first") || "Crea primo piatto"}
            </button>
          </div>
        )}
      </div>

      {importOpen && tenant && (
        <ImportMenuModal
          t={t}
          tenantId={tenant.id}
          onClose={() => setImportOpen(false)}
        />
      )}

      {qrOpen && tenant && (
        <QrMenuModal
          t={t}
          tenant={tenant}
          onClose={() => setQrOpen(false)}
        />
      )}
    </div>
  );
}

// =================== Sub-components ===================

function CategoryEditPane({
  t,
  saving,
  categoryName,
  setCategoryName,
  isEditing,
  onCancel,
  onSave,
  onDelete,
}: {
  t: (k: any) => string;
  saving: boolean;
  categoryName: string;
  setCategoryName: (v: string) => void;
  isEditing: boolean;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto w-full space-y-6">
      <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: "#c4956a" }}>
        <div className="flex items-center space-x-2">
          <button
            onClick={onCancel}
            className="cursor-pointer p-1.5 border-2 border-red-400 text-red-500 hover:bg-red-50 rounded-lg transition-colors mr-2"
          >
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-xl font-bold text-black">
            {isEditing ? t("menu_edit_category") || "Modifica categoria" : t("menu_new_category") || "Nuova categoria"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {isEditing && onDelete && (
            <button
              onClick={onDelete}
              className="cursor-pointer p-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
              title={t("menu_delete_category") || "Elimina"}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onSave}
            disabled={saving || !categoryName.trim()}
            className="cursor-pointer px-6 py-2 text-white text-sm font-bold rounded-lg shadow-sm transition-colors flex items-center disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? t("saving") || "Salvataggio..." : t("save") || "Salva"}
          </button>
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5 ml-1">
          {t("menu_category_name") || "Nome categoria"}
        </label>
        <input
          type="text"
          value={categoryName}
          onChange={(e) => setCategoryName(e.target.value)}
          placeholder={t("menu_category_name_placeholder") || "Es. Antipasti, Primi, Dolci..."}
          className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
          style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
        />
      </div>
    </div>
  );
}

function ItemEditPane({
  t,
  categories,
  saving,
  isEditing,
  name,
  setName,
  description,
  setDescription,
  price,
  setPrice,
  categoryId,
  setCategoryId,
  allergens,
  setAllergens,
  tags,
  setTags,
  available,
  setAvailable,
  onToggleArr,
  onCancel,
  onSave,
  onDelete,
}: {
  t: (k: any) => string;
  categories: MenuCategory[];
  saving: boolean;
  isEditing: boolean;
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  price: string;
  setPrice: (v: string) => void;
  categoryId: string;
  setCategoryId: (v: string) => void;
  allergens: string[];
  setAllergens: (v: string[]) => void;
  tags: string[];
  setTags: (v: string[]) => void;
  available: boolean;
  setAvailable: (v: boolean) => void;
  onToggleArr: (cur: string[], v: string) => string[];
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full space-y-6">
      <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: "#c4956a" }}>
        <div className="flex items-center space-x-2">
          <button
            onClick={onCancel}
            className="cursor-pointer p-1.5 border-2 border-red-400 text-red-500 hover:bg-red-50 rounded-lg mr-2"
          >
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-xl font-bold text-black">
            {isEditing ? t("menu_edit_item") || "Modifica piatto" : t("menu_new_item") || "Nuovo piatto"}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {isEditing && onDelete && (
            <button
              onClick={onDelete}
              className="cursor-pointer p-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onSave}
            disabled={saving || !name.trim()}
            className="cursor-pointer px-6 py-2 text-white text-sm font-bold rounded-lg shadow-sm flex items-center disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? t("saving") || "Salvataggio..." : t("save") || "Salva"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5 ml-1">
            {t("menu_item_name") || "Nome piatto"}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("menu_item_name_placeholder") || "Es. Spaghetti alla carbonara"}
            className="w-full text-xl font-bold text-black border-2 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
            style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5 ml-1">
            {t("menu_item_price") || "Prezzo €"}
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="12.50"
            className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
            style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5 ml-1">
          {t("menu_item_description") || "Descrizione"}
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={t("menu_item_description_placeholder") || "Ingredienti, preparazione, note..."}
          className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
          style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5 ml-1">
            {t("menu_item_category") || "Categoria"}
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
            style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
          >
            <option value="">{t("menu_uncategorized") || "Senza categoria"}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center cursor-pointer gap-2 select-none">
            <input
              type="checkbox"
              checked={available}
              onChange={(e) => setAvailable(e.target.checked)}
              className="w-4 h-4 cursor-pointer accent-[#c4956a]"
            />
            <span className="text-sm font-bold text-black">
              {available
                ? t("menu_available") || "Disponibile"
                : t("menu_unavailable") || "Esaurito"}
            </span>
            {available ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </label>
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5 ml-1">
          {t("menu_item_allergens") || "Allergeni"}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_ALLERGENS.map((al) => {
            const active = allergens.includes(al);
            return (
              <button
                key={al}
                type="button"
                onClick={() => setAllergens(onToggleArr(allergens, al))}
                className={`cursor-pointer text-[11px] uppercase font-bold tracking-wider px-2.5 py-1 rounded border-2 transition-colors ${
                  active
                    ? "bg-orange-100 border-orange-300 text-orange-800"
                    : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                {al.replace("_", " ")}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5 ml-1">
          {t("menu_item_tags") || "Tag"}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_TAGS.map((tg) => {
            const active = tags.includes(tg);
            return (
              <button
                key={tg}
                type="button"
                onClick={() => setTags(onToggleArr(tags, tg))}
                className={`cursor-pointer text-[11px] uppercase font-bold tracking-wider px-2.5 py-1 rounded border-2 transition-colors ${
                  active
                    ? "bg-emerald-100 border-emerald-300 text-emerald-800"
                    : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                {tg}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ItemDetailPane({
  t,
  item,
  categoryName,
  onBack,
  onEdit,
  onDelete,
}: {
  t: (k: any) => string;
  item: MenuItem;
  categoryName: string | null;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full">
      <button
        onClick={onBack}
        className="md:hidden cursor-pointer flex items-center text-sm font-medium text-black mb-3 -ml-1"
      >
        <ChevronLeft className="w-4 h-4 mr-1" /> {t("back") || "Indietro"}
      </button>
      <div
        className="flex flex-col md:flex-row md:items-center justify-between border-b pb-4 md:pb-8 mb-4 md:mb-8 gap-3"
        style={{ borderColor: "#c4956a" }}
      >
        <div className="flex items-center space-x-3 md:space-x-4 min-w-0">
          <div
            className="h-10 w-10 md:h-14 md:w-14 rounded-xl md:rounded-2xl flex items-center justify-center text-white shadow-lg flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            <UtensilsCrossed className="w-5 h-5 md:w-7 md:h-7" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] md:text-xs font-black uppercase tracking-widest text-black">
              {categoryName || t("menu_uncategorized") || "Senza categoria"}
            </p>
            <h2 className="text-xl md:text-3xl font-black text-black tracking-tight truncate">
              {item.name}
            </h2>
          </div>
        </div>
        <div className="flex items-center space-x-2 flex-shrink-0">
          <button
            onClick={onDelete}
            className="cursor-pointer p-2.5 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
          >
            <Trash2 className="w-5 h-5" />
          </button>
          <button
            onClick={onEdit}
            className="cursor-pointer px-6 py-2.5 text-white text-sm font-bold rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            <Settings2 className="w-4 h-4 mr-2" />
            {t("edit") || "Modifica"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        {item.price != null && (
          <div className="text-2xl font-black text-black">
            {item.price.toFixed(2)} {item.currency === "EUR" ? "€" : item.currency}
          </div>
        )}
        {!item.available && (
          <span className="text-xs uppercase font-bold tracking-widest text-orange-700 bg-orange-50 px-2.5 py-1 rounded-md">
            {t("menu_unavailable") || "Esaurito"}
          </span>
        )}
      </div>

      {item.description && (
        <div className="prose prose-zinc max-w-none mb-6">
          <div
            className="whitespace-pre-wrap text-black leading-relaxed text-base bg-zinc-50/50 p-6 rounded-2xl border-2"
            style={{ borderColor: "#c4956a" }}
          >
            {item.description}
          </div>
        </div>
      )}

      {item.tags.length > 0 && (
        <div className="mb-6">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-black mb-3">
            {t("menu_item_tags") || "Tag"}
          </h4>
          <div className="flex flex-wrap gap-2">
            {item.tags.map((tg) => (
              <span
                key={tg}
                className="px-3 py-1.5 bg-emerald-50 text-emerald-800 text-xs font-bold uppercase tracking-wider rounded-lg border border-emerald-200"
              >
                {tg}
              </span>
            ))}
          </div>
        </div>
      )}

      {item.allergens.length > 0 && (
        <div>
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-black mb-3">
            {t("menu_item_allergens") || "Allergeni"}
          </h4>
          <div className="flex flex-wrap gap-2">
            {item.allergens.map((al) => (
              <span
                key={al}
                className="px-3 py-1.5 bg-orange-50 text-orange-800 text-xs font-bold uppercase tracking-wider rounded-lg border border-orange-200"
              >
                {al.replace("_", " ")}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ImportMenuModal({
  t,
  tenantId,
  onClose,
}: {
  t: (k: any) => string;
  tenantId: string;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<"idle" | "uploading" | "preview" | "saving" | "done">("idle");
  const [extracted, setExtracted] = useState<ExtractedMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCounts, setSavedCounts] = useState<{ cats: number; items: number } | null>(null);

  const handleUpload = async () => {
    if (!file) return;
    setStage("uploading");
    setError(null);
    try {
      const form = new FormData();
      form.append("tenant_id", tenantId);
      form.append("file", file);
      const res = await fetch("/api/menu/import-file", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        setStage("idle");
        return;
      }
      setExtracted(data.extracted);
      setStage("preview");
    } catch (e: any) {
      setError(e?.message || "Errore di rete");
      setStage("idle");
    }
  };

  const handleUrlImport = async () => {
    if (!url.trim()) return;
    setStage("uploading");
    setError(null);
    try {
      const res = await fetch("/api/menu/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        setStage("idle");
        return;
      }
      setExtracted(data.extracted);
      setStage("preview");
    } catch (e: any) {
      setError(e?.message || "Errore di rete");
      setStage("idle");
    }
  };

  const handleConfirm = async () => {
    if (!extracted) return;
    setStage("saving");
    setError(null);
    try {
      const res = await fetch("/api/menu/import-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, extracted }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        setStage("preview");
        return;
      }
      setSavedCounts({ cats: data.categories_created, items: data.items_created });
      setStage("done");
    } catch (e: any) {
      setError(e?.message || "Errore di rete");
      setStage("preview");
    }
  };

  const updatePreviewItem = (
    catIdx: number | "uncat",
    itemIdx: number,
    patch: Partial<ExtractedMenuItem>
  ) => {
    if (!extracted) return;
    const next: ExtractedMenu = JSON.parse(JSON.stringify(extracted));
    if (catIdx === "uncat") {
      next.uncategorized[itemIdx] = { ...next.uncategorized[itemIdx], ...patch };
    } else {
      next.categories[catIdx].items[itemIdx] = {
        ...next.categories[catIdx].items[itemIdx],
        ...patch,
      };
    }
    setExtracted(next);
  };

  const removePreviewItem = (catIdx: number | "uncat", itemIdx: number) => {
    if (!extracted) return;
    const next: ExtractedMenu = JSON.parse(JSON.stringify(extracted));
    if (catIdx === "uncat") {
      next.uncategorized.splice(itemIdx, 1);
    } else {
      next.categories[catIdx].items.splice(itemIdx, 1);
    }
    setExtracted(next);
  };

  const totalItems = extracted
    ? extracted.categories.reduce((s, c) => s + c.items.length, 0) + extracted.uncategorized.length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between p-5 border-b"
          style={{ borderColor: "#c4956a" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              <Upload className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-black">{t("menu_import") || "Importa menu"}</h3>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer p-1.5 hover:bg-zinc-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {stage === "idle" && (
            <>
              <p className="text-sm text-black mb-4">
                {t("menu_import_intro") ||
                  "Carica un PDF, una foto o uno screenshot del menu del ristorante. L'AI estrarrà categorie, piatti, prezzi e allergeni — controllerai tutto prima del salvataggio."}
              </p>

              <div className="flex gap-2 mb-4 border-b" style={{ borderColor: "#c4956a" }}>
                <button
                  onClick={() => setTab("file")}
                  className={`cursor-pointer px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${
                    tab === "file"
                      ? "text-black"
                      : "border-transparent text-black/50 hover:text-black"
                  }`}
                  style={tab === "file" ? { borderColor: "#c4956a" } : { borderColor: "transparent" }}
                >
                  <Upload className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                  {t("menu_import_tab_file") || "File"}
                </button>
                <button
                  onClick={() => setTab("url")}
                  className={`cursor-pointer px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${
                    tab === "url"
                      ? "text-black"
                      : "border-transparent text-black/50 hover:text-black"
                  }`}
                  style={tab === "url" ? { borderColor: "#c4956a" } : { borderColor: "transparent" }}
                >
                  <QrCode className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                  {t("menu_import_tab_url") || "URL del QR"}
                </button>
              </div>

              {tab === "file" ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer border-2 border-dashed rounded-xl p-8 text-center hover:bg-zinc-50"
                  style={{ borderColor: "#c4956a" }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/gif"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  {file ? (
                    <div className="flex items-center justify-center gap-3">
                      {file.type.startsWith("image/") ? (
                        <ImageIcon className="w-8 h-8 text-black" />
                      ) : (
                        <FileText className="w-8 h-8 text-black" />
                      )}
                      <div className="text-left">
                        <p className="font-bold text-black text-sm">{file.name}</p>
                        <p className="text-xs text-black/60">
                          {(file.size / 1024).toFixed(0)} KB · {file.type}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-10 h-10 mx-auto mb-3 text-black/40" />
                      <p className="text-sm font-bold text-black">
                        {t("menu_import_drop") || "Clicca per scegliere PDF o immagine"}
                      </p>
                      <p className="text-xs text-black/60 mt-1">
                        {t("menu_import_formats") || "PDF, JPEG, PNG, WEBP — max 8 MB"}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs uppercase font-bold tracking-widest text-black/60 mb-1.5">
                    {t("menu_import_url_label") || "URL del menu (es. dal QR del ristorante)"}
                  </label>
                  <input
                    type="url"
                    inputMode="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                    style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
                  />
                  <p className="text-xs text-black/60 mt-2">
                    {t("menu_import_url_hint") ||
                      "Scansiona il QR del ristorante con il telefono, copia l'URL che si apre e incollalo qui. Funziona con PDF, immagini o siti web semplici."}
                  </p>
                </div>
              )}

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                  {error}
                </div>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="cursor-pointer px-4 py-2 border-2 rounded-lg text-sm font-bold text-black hover:bg-zinc-50"
                  style={{ borderColor: "#c4956a" }}
                >
                  {t("cancel") || "Annulla"}
                </button>
                <button
                  onClick={tab === "file" ? handleUpload : handleUrlImport}
                  disabled={tab === "file" ? !file : !url.trim()}
                  className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 px-6 py-2 text-white text-sm font-bold rounded-lg shadow-sm flex items-center"
                  style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {t("menu_import_analyze") || "Analizza menu"}
                </button>
              </div>
            </>
          )}

          {stage === "uploading" && (
            <div className="py-12 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-[#c4956a]" />
              <p className="font-bold text-black">
                {t("menu_import_analyzing") || "Sto leggendo il menu..."}
              </p>
              <p className="text-xs text-black/60 mt-1">
                {t("menu_import_wait") || "Può richiedere fino a 30 secondi."}
              </p>
            </div>
          )}

          {stage === "preview" && extracted && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase font-bold tracking-widest text-black/60">
                    {t("menu_import_preview") || "Anteprima"}
                  </p>
                  <p className="text-sm font-bold text-black">
                    {extracted.categories.length} {t("menu_categories") || "categorie"} · {totalItems}{" "}
                    {t("menu_dishes") || "piatti"}
                  </p>
                </div>
                {extracted.raw_notes && (
                  <p className="text-xs text-black/60 italic max-w-xs text-right">
                    {extracted.raw_notes}
                  </p>
                )}
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                  {error}
                </div>
              )}

              <div className="space-y-5">
                {extracted.categories.map((cat, ci) => (
                  <PreviewCategory
                    key={ci}
                    t={t}
                    name={cat.name}
                    items={cat.items}
                    onUpdate={(ii, patch) => updatePreviewItem(ci, ii, patch)}
                    onRemove={(ii) => removePreviewItem(ci, ii)}
                  />
                ))}
                {extracted.uncategorized.length > 0 && (
                  <PreviewCategory
                    t={t}
                    name={t("menu_uncategorized") || "Senza categoria"}
                    items={extracted.uncategorized}
                    onUpdate={(ii, patch) => updatePreviewItem("uncat", ii, patch)}
                    onRemove={(ii) => removePreviewItem("uncat", ii)}
                  />
                )}
              </div>

              <div className="mt-6 flex justify-end gap-2 sticky bottom-0 bg-white pt-3">
                <button
                  onClick={() => {
                    setExtracted(null);
                    setFile(null);
                    setStage("idle");
                  }}
                  className="cursor-pointer px-4 py-2 border-2 rounded-lg text-sm font-bold text-black hover:bg-zinc-50"
                  style={{ borderColor: "#c4956a" }}
                >
                  {t("menu_import_restart") || "Carica altro file"}
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={totalItems === 0}
                  className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 px-6 py-2 text-white text-sm font-bold rounded-lg shadow-sm flex items-center"
                  style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
                >
                  <Save className="w-4 h-4 mr-2" />
                  {t("menu_import_save") || "Salva nel menu"}
                </button>
              </div>
            </>
          )}

          {stage === "saving" && (
            <div className="py-12 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-[#c4956a]" />
              <p className="font-bold text-black">
                {t("menu_import_saving") || "Salvataggio nel menu..."}
              </p>
            </div>
          )}

          {stage === "done" && savedCounts && (
            <div className="py-12 text-center">
              <CheckCircle2 className="w-14 h-14 mx-auto mb-4 text-emerald-500" />
              <p className="text-lg font-black text-black">
                {t("menu_import_done") || "Menu importato!"}
              </p>
              <p className="text-sm text-black/70 mt-2">
                {savedCounts.cats} {t("menu_categories") || "categorie"} · {savedCounts.items}{" "}
                {t("menu_dishes") || "piatti"}
              </p>
              <button
                onClick={onClose}
                className="cursor-pointer mt-6 px-6 py-2 text-white text-sm font-bold rounded-lg shadow-sm"
                style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              >
                {t("close") || "Chiudi"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewCategory({
  t,
  name,
  items,
  onUpdate,
  onRemove,
}: {
  t: (k: any) => string;
  name: string;
  items: ExtractedMenuItem[];
  onUpdate: (idx: number, patch: Partial<ExtractedMenuItem>) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div>
      <h4 className="text-xs uppercase font-black tracking-widest text-black mb-2">{name}</h4>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div
            key={idx}
            className="border-2 rounded-lg p-3 hover:bg-zinc-50/50"
            style={{ borderColor: "rgba(196,149,106,0.4)" }}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={it.name}
                    onChange={(e) => onUpdate(idx, { name: e.target.value })}
                    className="flex-1 font-bold text-black text-sm bg-transparent focus:outline-none focus:bg-white focus:border-b focus:border-[#c4956a] py-0.5"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={it.price != null ? String(it.price) : ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") onUpdate(idx, { price: null });
                      else {
                        const n = Number(v.replace(",", "."));
                        if (!Number.isNaN(n)) onUpdate(idx, { price: n });
                      }
                    }}
                    placeholder="—"
                    className="w-20 text-right text-sm font-bold text-black bg-transparent focus:outline-none focus:bg-white focus:border-b focus:border-[#c4956a] py-0.5"
                  />
                  <span className="text-sm font-bold text-black">
                    {it.currency === "EUR" ? "€" : it.currency}
                  </span>
                </div>
                {it.description && (
                  <input
                    type="text"
                    value={it.description}
                    onChange={(e) => onUpdate(idx, { description: e.target.value })}
                    className="w-full text-xs text-black/70 bg-transparent focus:outline-none focus:bg-white focus:border-b focus:border-[#c4956a] py-0.5 mt-0.5"
                  />
                )}
                {(it.allergens.length > 0 || it.tags.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {it.tags.map((tg) => (
                      <span
                        key={tg}
                        className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700"
                      >
                        {tg}
                      </span>
                    ))}
                    {it.allergens.map((al) => (
                      <span
                        key={al}
                        className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-orange-50 text-orange-700"
                      >
                        {al}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => onRemove(idx)}
                className="cursor-pointer p-1.5 text-red-500 hover:bg-red-50 rounded"
                title={t("menu_import_skip_item") || "Escludi piatto"}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QrMenuModal({
  t,
  tenant,
  onClose,
}: {
  t: (k: any) => string;
  tenant: Tenant;
  onClose: () => void;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const publicUrl = origin ? `${origin}/m/${tenant.slug}` : `/m/${tenant.slug}`;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked → user can still select the input manually
    }
  };

  const handlePrint = () => {
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) return;
    const svgEl = document.getElementById("qr-print-svg");
    if (!svgEl) return;
    const svgHtml = new XMLSerializer().serializeToString(svgEl);
    const doc = win.document;
    doc.title = `QR Menu — ${tenant.name}`;

    const style = doc.createElement("style");
    style.textContent = `
      @page { size: A4; margin: 24mm; }
      body { font-family: system-ui, -apple-system, sans-serif; color: #1c1917; text-align: center; margin: 0; padding: 0; }
      .wrap { padding: 40px 20px; }
      h1 { font-size: 28pt; margin: 0 0 12pt 0; font-weight: 900; letter-spacing: -0.5pt; }
      p.sub { font-size: 12pt; margin: 0 0 36pt 0; color: #57534e; }
      .qr { display: inline-block; padding: 16pt; background: white; border-radius: 12pt; }
      .qr svg { width: 360pt; height: 360pt; display: block; }
      .footer { margin-top: 32pt; font-size: 10pt; color: #57534e; }
      .url { margin-top: 10pt; font-family: ui-monospace, monospace; font-size: 9pt; color: #1c1917; word-break: break-all; }
    `;
    doc.head.appendChild(style);

    const wrap = doc.createElement("div");
    wrap.className = "wrap";

    const h1 = doc.createElement("h1");
    h1.textContent = tenant.name;
    wrap.appendChild(h1);

    const sub = doc.createElement("p");
    sub.className = "sub";
    sub.textContent = t("menu_qr_print_subtitle") || "Inquadra il codice per vedere il menu";
    wrap.appendChild(sub);

    const qr = doc.createElement("div");
    qr.className = "qr";
    // SVG content comes from our own QRCodeSVG render — not user input.
    // We still parse it as XML and append the parsed node rather than using
    // innerHTML, to satisfy the security guidance hook.
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgHtml, "image/svg+xml");
    const svgNode = doc.importNode(svgDoc.documentElement, true);
    qr.appendChild(svgNode);
    wrap.appendChild(qr);

    const footer = doc.createElement("div");
    footer.className = "footer";
    footer.textContent = t("menu_qr_print_footer") || "Powered by BaliFlow";
    wrap.appendChild(footer);

    const urlDiv = doc.createElement("div");
    urlDiv.className = "url";
    urlDiv.textContent = publicUrl;
    wrap.appendChild(urlDiv);

    doc.body.appendChild(wrap);
    win.setTimeout(() => win.print(), 200);
  };

  const handleDownloadPng = () => {
    const svgEl = document.getElementById("qr-print-svg") as unknown as SVGSVGElement | null;
    if (!svgEl) return;
    const svgStr = new XMLSerializer().serializeToString(svgEl);
    const img = new Image();
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 1024;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement("a");
        const dlUrl = URL.createObjectURL(b);
        a.href = dlUrl;
        a.download = `qr-menu-${tenant.slug}.png`;
        a.click();
        URL.revokeObjectURL(dlUrl);
      }, "image/png");
    };
    img.src = url;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between p-5 border-b"
          style={{ borderColor: "#c4956a" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              <QrCode className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-black">
              {t("menu_qr_title") || "QR del menu"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer p-1.5 hover:bg-zinc-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-black/70 mb-5 leading-relaxed">
            {t("menu_qr_intro") ||
              "Il QR punta a una pagina sempre aggiornata del tuo menu. Quando modifichi un piatto qui, il QR resta lo stesso — i clienti vedranno subito la versione nuova."}
          </p>

          <div className="flex flex-col items-center bg-zinc-50 rounded-xl p-6 mb-5">
            <div className="bg-white p-3 rounded-lg shadow-sm">
              <QRCodeSVG
                id="qr-print-svg"
                value={publicUrl}
                size={220}
                level="M"
                marginSize={2}
                bgColor="#ffffff"
                fgColor="#1c1917"
              />
            </div>
            <p className="text-xs text-black/50 mt-3 font-mono break-all text-center px-2">
              {publicUrl}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={handlePrint}
              className="cursor-pointer px-3 py-2 text-white text-sm font-bold rounded-lg shadow-sm flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              <FileText className="w-4 h-4 mr-2" />
              {t("menu_qr_print") || "Stampa PDF"}
            </button>
            <button
              onClick={handleDownloadPng}
              className="cursor-pointer px-3 py-2 border-2 text-sm font-bold text-black rounded-lg hover:bg-zinc-50 flex items-center justify-center"
              style={{ borderColor: "#c4956a" }}
            >
              <ImageIcon className="w-4 h-4 mr-2" />
              {t("menu_qr_png") || "Scarica PNG"}
            </button>
          </div>
          <button
            onClick={handleCopy}
            className="cursor-pointer w-full px-3 py-2 border-2 text-sm font-bold text-black rounded-lg hover:bg-zinc-50 flex items-center justify-center"
            style={{ borderColor: "#c4956a" }}
          >
            {copied ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-600" />
                {t("menu_qr_copied") || "URL copiato!"}
              </>
            ) : (
              <>{t("menu_qr_copy") || "Copia URL"}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
