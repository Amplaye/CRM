"use client";

import {
  UtensilsCrossed,
  Plus,
  Search,
  Save,
  X,
  Trash2,
  FolderPlus,
  Eye,
  EyeOff,
  Upload,
  QrCode,
  Loader2,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  Pencil,
  ChevronRight,
  AlertTriangle,
  Star,
  MinusCircle,
} from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import type {
  MenuCategory,
  MenuItem,
  MenuCollection,
  MenuCollectionItem,
  CollectionKind,
  Tenant,
} from "@/lib/types";
import type { ExtractedMenu, ExtractedMenuItem } from "@/lib/menu/extract";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, ACCEPTED_EXTENSIONS, VISION_MIME } from "@/lib/menu/limits";
import {
  allergenLabel,
  tagLabel,
  collectionLabel,
  CLASSIC_COLLECTION_KINDS,
  type MenuLocale,
} from "@/lib/menu/labels";
import {
  collectionMembersMap,
  itemIdsInCollection,
  membershipDiff,
} from "@/lib/menu/collections";
import { QRCodeSVG } from "qrcode.react";

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

const COMMON_TAGS = ["vegano", "vegetariano", "piccante", "consigliato", "specialita", "novita"];

// Sentinel for the synthetic "uncategorized" sidebar entry.
const UNCAT_ID = "__uncategorized__";

export default function MenuPage() {
  const { t, language } = useLanguage();
  const { activeTenant: tenant, refreshActiveTenant } = useTenant();
  const supabase = createClient();

  // Public-menu template selector (1 Immersive · 2 Editorial · 3 Cinematic ·
  // 4 Classic). The saved value lives in tenants.settings.menu_style and is the
  // real default for /m/<slug>; picking one here saves immediately.
  const savedStyle = (tenant?.settings?.menu_style ?? "1") as "1" | "2" | "3" | "4";
  const [menuStyle, setMenuStyle] = useState<"1" | "2" | "3" | "4">(savedStyle);
  const [savingStyle, setSavingStyle] = useState(false);
  useEffect(() => {
    setMenuStyle((tenant?.settings?.menu_style ?? "1") as "1" | "2" | "3" | "4");
  }, [tenant?.settings?.menu_style]);

  const chooseStyle = async (s: "1" | "2" | "3" | "4") => {
    if (!tenant || s === menuStyle) return;
    const prev = menuStyle;
    setMenuStyle(s); // optimistic
    setSavingStyle(true);
    const { error } = await supabase
      .from("tenants")
      .update({ settings: { ...tenant.settings, menu_style: s } })
      .eq("id", tenant.id);
    setSavingStyle(false);
    if (error) {
      setMenuStyle(prev);
      alert(`Errore salvataggio template: ${error.message}`);
      return;
    }
    await refreshActiveTenant();
  };

  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [collections, setCollections] = useState<MenuCollection[]>([]);
  const [collectionLinks, setCollectionLinks] = useState<MenuCollectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Sidebar selection. A collection, when selected, takes precedence over the
  // category selection (so the two never fight); selecting a category clears it.
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

  // Modal state — replaces the right-pane editor from the old layout.
  // We open a centered modal for new/edit, so the table view stays put.
  const [itemModal, setItemModal] = useState<
    | { mode: "new"; categoryId: string | null }
    | { mode: "edit"; item: MenuItem }
    | null
  >(null);
  const [categoryModal, setCategoryModal] = useState<
    | { mode: "new" }
    | { mode: "edit"; category: MenuCategory }
    | null
  >(null);
  const [collectionModal, setCollectionModal] = useState<
    | { mode: "new" }
    | { mode: "edit"; collection: MenuCollection }
    | null
  >(null);

  const [importOpen, setImportOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  // Fetch + realtime
  useEffect(() => {
    if (!tenant) return;

    const fetchAll = async () => {
      const [{ data: cats }, { data: its }, { data: colls }, { data: links }] =
        await Promise.all([
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
          supabase
            .from("menu_collections")
            .select("*")
            .eq("tenant_id", tenant.id)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true }),
          supabase
            .from("menu_collection_items")
            .select("*")
            .eq("tenant_id", tenant.id),
        ]);
      setCategories((cats || []) as MenuCategory[]);
      setItems((its || []) as MenuItem[]);
      setCollections((colls || []) as MenuCollection[]);
      setCollectionLinks((links || []) as MenuCollectionItem[]);
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_collections", filter: `tenant_id=eq.${tenant.id}` },
        debounced
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_collection_items", filter: `tenant_id=eq.${tenant.id}` },
        debounced
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [tenant]);

  // Derived: items grouped by category id + counts per category
  const itemsByCat = useMemo(() => {
    const map = new Map<string | null, MenuItem[]>();
    for (const it of items) {
      const k = it.category_id;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return map;
  }, [items]);

  const hasUncategorized = (itemsByCat.get(null)?.length || 0) > 0;

  // Derived: collectionId → its dishes (looked up from the live items list, so a
  // dish edited anywhere updates inside its collection automatically).
  const collectionMembers = useMemo(
    () => collectionMembersMap(collectionLinks, items),
    [collectionLinks, items]
  );

  const activeCollection = selectedCollectionId
    ? collections.find((c) => c.id === selectedCollectionId) || null
    : null;

  // If the selected collection got deleted (e.g. via realtime from another tab),
  // drop back to the category view.
  useEffect(() => {
    if (loading) return;
    if (selectedCollectionId && !collections.find((c) => c.id === selectedCollectionId)) {
      setSelectedCollectionId(null);
    }
  }, [loading, collections, selectedCollectionId]);

  // Auto-select first category once data loads
  useEffect(() => {
    if (loading) return;
    if (selectedCategoryId) {
      // If the selected category got deleted, reset.
      if (selectedCategoryId === UNCAT_ID) {
        if (!hasUncategorized) setSelectedCategoryId(categories[0]?.id || null);
        return;
      }
      if (!categories.find((c) => c.id === selectedCategoryId)) {
        setSelectedCategoryId(categories[0]?.id || (hasUncategorized ? UNCAT_ID : null));
      }
      return;
    }
    if (categories.length > 0) setSelectedCategoryId(categories[0].id);
    else if (hasUncategorized) setSelectedCategoryId(UNCAT_ID);
  }, [loading, categories, hasUncategorized, selectedCategoryId]);

  // Selecting a category clears the collection selection, and vice-versa, so the
  // right pane always reflects exactly one chosen thing.
  const selectCategory = (id: string) => {
    setSelectedCollectionId(null);
    setSelectedCategoryId(id);
  };
  const selectCollection = (id: string) => {
    setSelectedCollectionId(id);
  };

  // Map a dish's category_id → name. Used for the muted sub-label under a dish
  // when its home category isn't the one in view (collection or global search),
  // and to let the search box match on category name.
  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  // Items to display in the table for the active view (collection > category),
  // filtered by search.
  const visibleItems = useMemo(() => {
    // While searching, the box is GLOBAL: it looks across the whole menu (every
    // category + uncategorized), not just the open category/collection. Without
    // a query we show exactly the active view for normal browsing.
    let list: MenuItem[] = [];
    if (search.trim()) list = items;
    else if (selectedCollectionId) list = collectionMembers.get(selectedCollectionId) || [];
    else if (selectedCategoryId === UNCAT_ID) list = itemsByCat.get(null) || [];
    else if (selectedCategoryId) list = itemsByCat.get(selectedCategoryId) || [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((it) => {
      if (it.name.toLowerCase().includes(q)) return true;
      if (it.description.toLowerCase().includes(q)) return true;
      // Match BOTH the stored token ("gluten") and the localized label the user
      // actually sees in the UI ("Glutine") — otherwise typing what's on screen
      // finds nothing, which is what the "Cerca ... allergene" box promises.
      if (it.allergens.some((a) => a.toLowerCase().includes(q) || allergenLabel(a, language).toLowerCase().includes(q))) return true;
      if (it.tags.some((tg) => tg.toLowerCase().includes(q) || tagLabel(tg, language).toLowerCase().includes(q))) return true;
      // The placeholder also promises searching by category name.
      const catName = it.category_id ? categoryNameById.get(it.category_id) : null;
      if (catName && catName.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [items, itemsByCat, collectionMembers, categoryNameById, selectedCollectionId, selectedCategoryId, search, language]);

  const isCollectionView = !!selectedCollectionId;
  const activeCategory =
    !selectedCollectionId && selectedCategoryId && selectedCategoryId !== UNCAT_ID
      ? categories.find((c) => c.id === selectedCategoryId) || null
      : null;
  const isUncatView = !selectedCollectionId && selectedCategoryId === UNCAT_ID;

  const handleDeleteItem = async (id: string) => {
    if (!confirm(t("menu_confirm_delete_item") || "Eliminare questo piatto?")) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
    const { error } = await supabase.from("menu_items").delete().eq("id", id);
    if (error) {
      console.error("[menu] delete item failed", error);
      alert(`Errore eliminazione: ${error.message}`);
    }
  };

  // Remove a dish from the active collection (does NOT delete the dish itself).
  const handleRemoveFromCollection = async (itemId: string) => {
    if (!selectedCollectionId) return;
    const prev = collectionLinks;
    setCollectionLinks((ls) =>
      ls.filter((l) => !(l.collection_id === selectedCollectionId && l.item_id === itemId))
    );
    const { error } = await supabase
      .from("menu_collection_items")
      .delete()
      .eq("collection_id", selectedCollectionId)
      .eq("item_id", itemId);
    if (error) {
      console.error("[menu] remove from collection failed", error);
      setCollectionLinks(prev);
      alert(`Errore: ${error.message}`);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    const used = items.filter((i) => i.category_id === id).length;
    const msg = used > 0
      ? `${t("menu_confirm_delete_cat_used") || "Categoria con piatti collegati"} (${used}). ${t("menu_items_become_uncategorized") || "I piatti diventeranno senza categoria."}`
      : t("menu_confirm_delete_cat") || "Eliminare questa categoria?";
    if (!confirm(msg)) return;
    // Ottimistico: rimuovi subito dalla UI (il realtime farebbe lo stesso ma
    // potrebbe non essere abilitato / avere latenza). Snapshot per rollback.
    const prevCats = categories;
    const prevItems = items;
    setCategories((cs) => cs.filter((c) => c.id !== id));
    // Il DB fa ON DELETE SET NULL: i piatti collegati diventano "senza categoria".
    setItems((its) =>
      its.map((it) => (it.category_id === id ? { ...it, category_id: null } : it))
    );
    setCategoryModal(null);
    const { error } = await supabase.from("menu_categories").delete().eq("id", id);
    if (error) {
      console.error("[menu] delete category failed", error);
      // Rollback
      setCategories(prevCats);
      setItems(prevItems);
      alert(`Errore eliminazione categoria: ${error.message}`);
    }
  };

  return (
    <div className="p-0 h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-4rem)] flex overflow-hidden">
      {/* LEFT PANE: categories sidebar */}
      <aside
        className="border-r flex flex-col shrink-0 w-full md:w-[340px]"
        style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}
      >
        <div className="p-5 border-b shrink-0" style={{ borderColor: "#c4956a" }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold text-black tracking-tight">
                {t("menu_title") || "Menu"}
              </h1>
              <p className="text-xs text-black mt-1">
                {t("menu_subtitle") || "Piatti, categorie, allergeni del ristorante"}
              </p>
            </div>
            {tenant?.slug && (
              <a
                href={`/m/${tenant.slug}?style=${menuStyle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="cursor-pointer shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-black px-3 py-2 rounded-lg border-2 hover:bg-[#c4956a]/10 transition-colors"
                style={{ borderColor: "#c4956a" }}
                title={t("menu_preview_public") || "Anteprima menù pubblico"}
              >
                <Eye className="w-4 h-4" />
                {t("menu_import_preview") || "Anteprima"}
              </a>
            )}
          </div>

          {/* Template selector — pick the public-menu look. Saving is immediate:
              the chosen number becomes both the preview and the live menu. */}
          <div className="mt-4">
            <span className="text-[10px] uppercase font-black tracking-widest text-[#a87642] flex items-center gap-1.5">
              {t("menu_template") || "Template menù"}
              {savingStyle && <Loader2 className="w-3 h-3 animate-spin" />}
            </span>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              {([
                ["1", t("menu_template_1") || "Immersivo"],
                ["2", t("menu_template_2") || "Editoriale"],
                ["3", t("menu_template_3") || "Scuro"],
                ["4", t("menu_template_4") || "Classico"],
              ] as const).map(([num, label]) => {
                const on = menuStyle === num;
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => chooseStyle(num)}
                    disabled={savingStyle}
                    title={label}
                    aria-pressed={on}
                    className="cursor-pointer flex flex-col items-center justify-center py-1.5 rounded-lg border-2 transition-colors"
                    style={
                      on
                        ? { borderColor: "#c4956a", background: "linear-gradient(135deg, #d4a574, #c4956a)", color: "#fff" }
                        : { borderColor: "rgba(196,149,106,0.5)", background: "rgba(252,246,237,0.6)", color: "#1c150d" }
                    }
                  >
                    <span className="text-base font-black leading-none">{num}</span>
                    <span className="text-[8.5px] font-bold uppercase tracking-wide mt-0.5">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("menu_search_placeholder") || "Cerca piatto..."}
              className="w-full pl-9 pr-9 py-2 border-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-black/50 hover:text-black hover:bg-black/5"
                aria-label="Cancella ricerca"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Categories list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="p-3 space-y-2 animate-pulse">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-10 bg-zinc-200 rounded-lg" />
              ))}
            </div>
          ) : categories.length === 0 && !hasUncategorized && collections.length === 0 ? (
            <div className="p-6 text-center text-black">
              <UtensilsCrossed
                className="w-10 h-10 mx-auto mb-3"
                style={{ color: "#c4956a" }}
              />
              <p className="text-xs font-bold">
                {t("menu_empty_list") || "Nessuna categoria"}
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {/* Collections first — curated groupings of existing dishes. */}
              {collections.length > 0 && (
                <li className="px-3 pt-1 pb-1.5">
                  <span className="text-[10px] uppercase font-black tracking-widest text-[#a87642]">
                    {t("menu_collections") || "Raccolte"}
                  </span>
                </li>
              )}
              {collections.map((col) => {
                const count = collectionMembers.get(col.id)?.length || 0;
                const active = selectedCollectionId === col.id;
                return (
                  <li key={`col-${col.id}`}>
                    <button
                      onClick={() => selectCollection(col.id)}
                      className={`cursor-pointer w-full text-left px-3 py-2 rounded-lg flex items-center justify-between gap-2 transition-all ${
                        active
                          ? "bg-white shadow-sm ring-1 ring-[#c4956a]"
                          : "hover:bg-white/60"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <Star
                          className="w-3.5 h-3.5 shrink-0"
                          style={{ color: "#c4956a" }}
                          fill={active ? "#c4956a" : "none"}
                        />
                        <span className="text-sm font-bold text-black truncate">
                          {collectionLabel(col.kind, col.name, language)}
                        </span>
                      </span>
                      <span
                        className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                          active ? "bg-[#c4956a] text-white" : "bg-zinc-100 text-black"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  </li>
                );
              })}
              {collections.length > 0 && (categories.length > 0 || hasUncategorized) && (
                <li className="px-3 pt-2 pb-1.5">
                  <span className="text-[10px] uppercase font-black tracking-widest text-[#a87642]">
                    {t("menu_categories") || "Categorie"}
                  </span>
                </li>
              )}
              {categories.map((c) => {
                const count = itemsByCat.get(c.id)?.length || 0;
                const active = !selectedCollectionId && selectedCategoryId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => selectCategory(c.id)}
                      className={`cursor-pointer w-full text-left px-3 py-2 rounded-lg flex items-center justify-between gap-2 transition-all ${
                        active
                          ? "bg-white shadow-sm ring-1 ring-[#c4956a]"
                          : "hover:bg-white/60"
                      }`}
                    >
                      <span className="text-sm font-bold text-black truncate">{c.name}</span>
                      <span
                        className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                          active ? "bg-[#c4956a] text-white" : "bg-zinc-100 text-black"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  </li>
                );
              })}
              {hasUncategorized && (
                <li>
                  <button
                    onClick={() => selectCategory(UNCAT_ID)}
                    className={`cursor-pointer w-full text-left px-3 py-2 rounded-lg flex items-center justify-between gap-2 transition-all ${
                      !selectedCollectionId && selectedCategoryId === UNCAT_ID
                        ? "bg-white shadow-sm ring-1 ring-[#c4956a]"
                        : "hover:bg-white/60"
                    }`}
                  >
                    <span className="text-sm font-bold italic text-black truncate">
                      {t("menu_uncategorized") || "Senza categoria"}
                    </span>
                    <span
                      className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                        !selectedCollectionId && selectedCategoryId === UNCAT_ID
                          ? "bg-[#c4956a] text-white"
                          : "bg-zinc-100 text-black"
                      }`}
                    >
                      {itemsByCat.get(null)?.length || 0}
                    </span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Sidebar actions */}
        <div
          className="p-3 border-t shrink-0 grid grid-cols-2 gap-2"
          style={{ borderColor: "#c4956a" }}
        >
          <button
            onClick={() => setCategoryModal({ mode: "new" })}
            className="cursor-pointer text-xs font-bold text-black inline-flex items-center justify-center px-2.5 py-2 rounded-md border-2 hover:bg-[#c4956a]/10 transition-colors"
            style={{ borderColor: "#c4956a" }}
            title={t("menu_new_category") || "Nuova categoria"}
          >
            <FolderPlus className="w-3.5 h-3.5 mr-1.5" />
            {t("menu_new_category") || "Categoria"}
          </button>
          <button
            onClick={() => setCollectionModal({ mode: "new" })}
            className="cursor-pointer text-xs font-bold text-black inline-flex items-center justify-center px-2.5 py-2 rounded-md border-2 hover:bg-[#c4956a]/10 transition-colors"
            style={{ borderColor: "#c4956a" }}
            title={t("menu_new_collection") || "Nuova raccolta"}
          >
            <Star className="w-3.5 h-3.5 mr-1.5" />
            {t("menu_collection") || "Raccolta"}
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="cursor-pointer text-xs font-bold text-white inline-flex items-center justify-center px-2.5 py-2 rounded-md shadow-sm transition-colors"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            title={t("menu_import") || "Importa menu"}
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {t("menu_import") || "Importa"}
          </button>
          <button
            onClick={() => setQrOpen(true)}
            className="cursor-pointer text-xs font-bold text-black inline-flex items-center justify-center px-2.5 py-2 rounded-md border-2 hover:bg-[#c4956a]/10 transition-colors"
            style={{ borderColor: "#c4956a" }}
            title={t("menu_generate_qr") || "Genera QR"}
          >
            <QrCode className="w-3.5 h-3.5 mr-1.5" />
            {t("menu_generate_qr_short") || "QR"}
          </button>
        </div>
      </aside>

      {/* RIGHT PANE: table of items for selected category */}
      <main
        className="flex-1 overflow-hidden flex flex-col"
        style={{ background: "rgba(252,246,237,0.55)" }}
      >
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#c4956a]" />
          </div>
        ) : !activeCategory && !isUncatView && !isCollectionView ? (
          <EmptyState
            t={t}
            onCreateCategory={() => setCategoryModal({ mode: "new" })}
            onImport={() => setImportOpen(true)}
          />
        ) : (
          <>
            {/* Header */}
            <div
              className="px-6 py-4 border-b flex items-center justify-between shrink-0"
              style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.95)" }}
            >
              <div className="min-w-0">
                <p className="text-[10px] uppercase font-black tracking-widest text-black">
                  {search.trim()
                    ? t("menu_search_results") || "Risultati ricerca"
                    : isCollectionView
                    ? t("menu_collection") || "Raccolta"
                    : t("menu_category") || "Categoria"}
                </p>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-black text-black tracking-tight truncate flex items-center gap-2">
                    {!search.trim() && isCollectionView && (
                      <Star className="w-5 h-5 shrink-0" style={{ color: "#c4956a" }} fill="#c4956a" />
                    )}
                    {search.trim()
                      ? `"${search.trim()}"`
                      : isCollectionView
                      ? collectionLabel(activeCollection!.kind, activeCollection!.name, language)
                      : isUncatView
                      ? t("menu_uncategorized") || "Senza categoria"
                      : activeCategory!.name}
                  </h2>
                  {!search.trim() && activeCategory && (
                    <button
                      onClick={() => setCategoryModal({ mode: "edit", category: activeCategory })}
                      className="cursor-pointer p-1.5 text-black hover:bg-zinc-100 rounded-lg border-2"
                      style={{ borderColor: "#c4956a" }}
                      title={t("menu_edit_category") || "Modifica categoria"}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  {!search.trim() && isCollectionView && (
                    <button
                      onClick={() => setCollectionModal({ mode: "edit", collection: activeCollection! })}
                      className="cursor-pointer p-1.5 text-black hover:bg-zinc-100 rounded-lg border-2"
                      style={{ borderColor: "#c4956a" }}
                      title={t("menu_edit_collection") || "Modifica raccolta"}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-black mt-0.5">
                  {visibleItems.length} {t("menu_dishes") || "piatti"}
                  {search.trim() && (
                    <>
                      {" "}
                      · {t("menu_search_filtered") || "filtrati"}
                    </>
                  )}
                </p>
              </div>
              {isCollectionView ? (
                <button
                  onClick={() => setCollectionModal({ mode: "edit", collection: activeCollection! })}
                  className="cursor-pointer px-4 py-2 text-white text-sm font-bold rounded-lg shadow-sm flex items-center"
                  style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  {t("menu_collection_choose_dishes") || "Scegli piatti"}
                </button>
              ) : (
                <button
                  onClick={() =>
                    setItemModal({
                      mode: "new",
                      categoryId: isUncatView ? null : activeCategory?.id || null,
                    })
                  }
                  className="cursor-pointer px-4 py-2 text-white text-sm font-bold rounded-lg shadow-sm flex items-center"
                  style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  {t("menu_new_item") || "Nuovo piatto"}
                </button>
              )}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {visibleItems.length === 0 ? (
                <div className="p-16 text-center text-black">
                  <UtensilsCrossed className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-bold">
                    {search.trim()
                      ? t("menu_no_results") || "Nessun risultato"
                      : isCollectionView
                      ? t("menu_collection_empty") || "Raccolta vuota — scegli i piatti da aggiungere"
                      : t("menu_empty_category") || "Nessun piatto in questa categoria"}
                  </p>
                  {!search.trim() &&
                    (isCollectionView ? (
                      <button
                        onClick={() =>
                          setCollectionModal({ mode: "edit", collection: activeCollection! })
                        }
                        className="cursor-pointer mt-4 px-4 py-2 text-white text-sm font-bold rounded-lg shadow-sm inline-flex items-center"
                        style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        {t("menu_collection_choose_dishes") || "Scegli piatti"}
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          setItemModal({
                            mode: "new",
                            categoryId: isUncatView ? null : activeCategory?.id || null,
                          })
                        }
                        className="cursor-pointer mt-4 px-4 py-2 text-white text-sm font-bold rounded-lg shadow-sm inline-flex items-center"
                        style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        {t("menu_new_item") || "Aggiungi piatto"}
                      </button>
                    ))}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead
                    className="text-left sticky top-0 z-10"
                    style={{ background: "rgba(252,246,237,0.98)" }}
                  >
                    <tr className="border-b" style={{ borderColor: "#c4956a" }}>
                      <th className="px-5 py-3 text-[10px] uppercase font-black tracking-widest text-black w-[30%]">
                        {t("menu_item_name") || "Nome"}
                      </th>
                      <th className="px-5 py-3 text-[10px] uppercase font-black tracking-widest text-black">
                        {t("menu_item_ingredients") || "Ingredienti"}
                      </th>
                      <th className="px-5 py-3 text-[10px] uppercase font-black tracking-widest text-black w-[12%] text-right">
                        {t("menu_item_price") || "Prezzo"}
                      </th>
                      <th className="px-3 py-3 w-[80px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((it) => (
                      <tr
                        key={it.id}
                        className="border-b hover:bg-white/70 transition-colors"
                        style={{ borderColor: "rgba(196,149,106,0.25)" }}
                      >
                        <td
                          className="px-5 py-3 align-top cursor-pointer"
                          onClick={() => setItemModal({ mode: "edit", item: it })}
                        >
                          <div className="flex items-center gap-2">
                            {it.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={it.image_url}
                                alt=""
                                className="w-9 h-9 rounded-md object-cover shrink-0 border"
                                style={{ borderColor: "rgba(196,149,106,0.4)" }}
                              />
                            ) : (
                              <span
                                className="w-9 h-9 rounded-md shrink-0 flex items-center justify-center border"
                                style={{ borderColor: "rgba(196,149,106,0.3)", background: "rgba(252,246,237,0.6)" }}
                                title={t("menu_item_photo_add") || "Aggiungi una foto"}
                              >
                                <ImageIcon className="w-4 h-4 text-[#c4956a]" />
                              </span>
                            )}
                            <span className="font-bold text-black truncate">{it.name}</span>
                            {!it.available && (
                              <span className="text-[9px] uppercase font-bold tracking-widest text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">
                                {t("menu_unavailable") || "Esaurito"}
                              </span>
                            )}
                          </div>
                          {/* In a collection — or in a global search — the dishes
                              come from many categories; show each dish's home
                              category for context. */}
                          {(isCollectionView || search.trim()) && it.category_id && (
                            <span className="text-[10px] text-black font-medium">
                              {categoryNameById.get(it.category_id) || ""}
                            </span>
                          )}
                        </td>
                        <td
                          className="px-5 py-3 align-top text-black cursor-pointer"
                          onClick={() => setItemModal({ mode: "edit", item: it })}
                        >
                          <p className="line-clamp-2 leading-snug">
                            {it.description || (
                              <span className="text-black italic">—</span>
                            )}
                          </p>
                          {(it.allergens.length > 0 || it.tags.length > 0) && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {it.tags.map((tg) => (
                                <span
                                  key={tg}
                                  className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700"
                                >
                                  {tagLabel(tg, language)}
                                </span>
                              ))}
                              {it.allergens.map((al) => (
                                <span
                                  key={al}
                                  className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-orange-50 text-orange-700"
                                >
                                  {allergenLabel(al, language)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td
                          className="px-5 py-3 align-top text-right font-bold text-black whitespace-nowrap cursor-pointer"
                          onClick={() => setItemModal({ mode: "edit", item: it })}
                        >
                          {it.price != null ? (
                            <>
                              {it.price.toFixed(2)}{" "}
                              <span className="text-black">
                                {it.currency === "EUR" ? "€" : it.currency}
                              </span>
                            </>
                          ) : (
                            <span className="text-black italic">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top text-right whitespace-nowrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setItemModal({ mode: "edit", item: it });
                            }}
                            className="cursor-pointer p-1.5 text-black hover:bg-zinc-100 rounded"
                            title={t("edit") || "Modifica"}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {isCollectionView ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveFromCollection(it.id);
                              }}
                              className="cursor-pointer p-1.5 text-orange-600 hover:bg-orange-50 rounded"
                              title={t("menu_collection_remove_item") || "Togli dalla raccolta"}
                            >
                              <MinusCircle className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteItem(it.id);
                              }}
                              className="cursor-pointer p-1.5 text-red-500 hover:bg-red-50 rounded"
                              title={t("delete") || "Elimina"}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>

      {/* Modals */}
      {itemModal && tenant && (
        <ItemEditModal
          t={t}
          language={language}
          tenantId={tenant.id}
          categories={categories}
          initial={
            itemModal.mode === "edit"
              ? itemModal.item
              : { categoryId: itemModal.categoryId }
          }
          onClose={() => setItemModal(null)}
          onDelete={
            itemModal.mode === "edit"
              ? () => {
                  handleDeleteItem(itemModal.item.id);
                  setItemModal(null);
                }
              : undefined
          }
        />
      )}

      {categoryModal && tenant && (
        <CategoryEditModal
          t={t}
          tenantId={tenant.id}
          existingMaxOrder={categories.reduce((m, c) => Math.max(m, c.sort_order), 0)}
          initial={categoryModal.mode === "edit" ? categoryModal.category : null}
          onClose={() => setCategoryModal(null)}
          onSaved={(cat) => {
            setCategories((prev) => {
              const exists = prev.some((c) => c.id === cat.id);
              const next = exists
                ? prev.map((c) => (c.id === cat.id ? cat : c))
                : [...prev, cat];
              return next.sort(
                (a, b) =>
                  a.sort_order - b.sort_order ||
                  a.created_at.localeCompare(b.created_at)
              );
            });
            setSelectedCategoryId(cat.id);
          }}
          onDelete={
            categoryModal.mode === "edit"
              ? () => handleDeleteCategory(categoryModal.category.id)
              : undefined
          }
        />
      )}

      {collectionModal && tenant && (
        <CollectionEditModal
          t={t}
          language={language}
          tenantId={tenant.id}
          items={items}
          categories={categories}
          existingCollections={collections}
          existingLinks={collectionLinks}
          existingMaxOrder={collections.reduce((m, c) => Math.max(m, c.sort_order), 0)}
          initial={collectionModal.mode === "edit" ? collectionModal.collection : null}
          onClose={() => setCollectionModal(null)}
          onSaved={(col, links) => {
            setCollections((prev) => {
              const exists = prev.some((c) => c.id === col.id);
              const next = exists
                ? prev.map((c) => (c.id === col.id ? col : c))
                : [...prev, col];
              return next.sort(
                (a, b) =>
                  a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
              );
            });
            // Replace this collection's links with the freshly-saved set.
            setCollectionLinks((prev) =>
              prev.filter((l) => l.collection_id !== col.id).concat(links)
            );
            setSelectedCollectionId(col.id);
          }}
          onDeleted={(colId) => {
            setCollections((prev) => prev.filter((c) => c.id !== colId));
            setCollectionLinks((prev) => prev.filter((l) => l.collection_id !== colId));
            if (selectedCollectionId === colId) setSelectedCollectionId(null);
            setCollectionModal(null);
          }}
        />
      )}

      {importOpen && tenant && (
        <ImportMenuModal
          t={t}
          language={language}
          tenantId={tenant.id}
          existingItemsCount={items.length}
          onClose={() => setImportOpen(false)}
        />
      )}

      {qrOpen && tenant && (
        <QrMenuModal t={t} tenant={tenant} onClose={() => setQrOpen(false)} />
      )}
    </div>
  );
}

// =================== Sub-components ===================

function EmptyState({
  t,
  onCreateCategory,
  onImport,
}: {
  t: (k: any) => string;
  onCreateCategory: () => void;
  onImport: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
      <div
        className="h-24 w-24 bg-zinc-50 rounded-full flex items-center justify-center mb-6 border-2"
        style={{ borderColor: "#c4956a" }}
      >
        <UtensilsCrossed className="w-10 h-10" style={{ color: "#c4956a" }} />
      </div>
      <h2 className="text-2xl font-black text-black tracking-tight">
        {t("menu_title") || "Menu"}
      </h2>
      <p className="text-black max-w-sm mt-2 leading-relaxed font-medium">
        {t("menu_empty_desc") ||
          "Crea una categoria oppure importa il menu del ristorante da PDF/URL."}
      </p>
      <div className="mt-8 flex gap-2">
        <button
          onClick={onCreateCategory}
          className="cursor-pointer px-6 py-3 text-black font-bold rounded-2xl border-2 inline-flex items-center"
          style={{ borderColor: "#c4956a" }}
        >
          <FolderPlus className="w-5 h-5 mr-2" />
          {t("menu_new_category") || "Nuova categoria"}
        </button>
        <button
          onClick={onImport}
          className="cursor-pointer px-6 py-3 text-white font-bold rounded-2xl inline-flex items-center"
          style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
        >
          <Upload className="w-5 h-5 mr-2" />
          {t("menu_import") || "Importa menu"}
        </button>
      </div>
    </div>
  );
}

function ItemEditModal({
  t,
  language,
  tenantId,
  categories,
  initial,
  onClose,
  onDelete,
}: {
  t: (k: any) => string;
  language: MenuLocale;
  tenantId: string;
  categories: MenuCategory[];
  initial: MenuItem | { categoryId: string | null };
  onClose: () => void;
  onDelete?: () => void;
}) {
  const supabase = createClient();
  const isEditing = "id" in initial;

  const [name, setName] = useState(isEditing ? initial.name : "");
  const [description, setDescription] = useState(isEditing ? initial.description : "");
  const [price, setPrice] = useState<string>(
    isEditing && initial.price != null ? String(initial.price) : ""
  );
  const [categoryId, setCategoryId] = useState<string>(
    isEditing ? initial.category_id || "" : initial.categoryId || ""
  );
  const [allergens, setAllergens] = useState<string[]>(
    isEditing ? initial.allergens : []
  );
  const [tags, setTags] = useState<string[]>(isEditing ? initial.tags : []);
  const [available, setAvailable] = useState<boolean>(isEditing ? initial.available : true);
  const [imageUrl, setImageUrl] = useState<string | null>(
    isEditing ? initial.image_url ?? null : null
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const toggleArrayValue = (current: string[], value: string): string[] =>
    current.includes(value) ? current.filter((v) => v !== value) : [...current, value];

  // Compress + upload a dish photo to the public "menu-images" bucket. We
  // downscale to ~1400px on the long edge and re-encode as WebP (q0.82) on the
  // client so a 4MB phone photo becomes ~150–250KB — Supabase Free shares one
  // 1GB bucket across all tenants, so every photo must be light.
  const compressToWebp = (file: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1400;
        let { width, height } = img;
        if (width > height && width > MAX) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else if (height >= width && height > MAX) {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no 2d context"));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
          "image/webp",
          0.82
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image decode failed"));
      };
      img.src = url;
    });

  const handlePhotoPick = async (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const blob = await compressToWebp(file);
      // Stable path per item keeps the bucket tidy and lets re-uploads overwrite.
      // For a brand-new dish (no id yet) we use a time-independent random suffix
      // built from the file's own bytes-length + name so it stays deterministic
      // within this session without Date.now().
      const itemKey = isEditing
        ? initial.id
        : `new-${tenantId.slice(0, 8)}-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32) || "dish"}`;
      const path = `${tenantId}/${itemKey}.webp`;
      const { error: upErr } = await supabase.storage
        .from("menu-images")
        .upload(path, blob, { contentType: "image/webp", upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("menu-images").getPublicUrl(path);
      // Cache-bust so an overwritten photo refreshes in the editor preview.
      setImageUrl(`${pub.publicUrl}?v=${blob.size}`);
    } catch (e) {
      console.error("[menu] photo upload failed", e);
      alert(`Errore caricamento foto: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const priceNum = price.trim() === "" ? null : Number(price.replace(",", "."));
    const payload = {
      tenant_id: tenantId,
      category_id: categoryId || null,
      name: name.trim(),
      description: description.trim(),
      price: priceNum != null && !Number.isNaN(priceNum) ? priceNum : null,
      currency: "EUR",
      allergens,
      tags,
      available,
      image_url: imageUrl,
    };
    let error: { message: string } | null = null;
    if (isEditing) {
      const res = await supabase
        .from("menu_items")
        .update(payload)
        .eq("id", initial.id)
        .select()
        .single();
      error = res.error;
    } else {
      const res = await supabase.from("menu_items").insert(payload).select().single();
      error = res.error;
    }
    setSaving(false);
    if (error) {
      console.error("[menu] save item failed", error);
      alert(`Errore salvataggio: ${error.message}`);
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between p-5 border-b shrink-0"
          style={{ borderColor: "#c4956a" }}
        >
          <h2 className="text-lg font-bold text-black">
            {isEditing
              ? t("menu_edit_item") || "Modifica piatto"
              : t("menu_new_item") || "Nuovo piatto"}
          </h2>
          <button
            onClick={onClose}
            className="cursor-pointer p-1.5 hover:bg-zinc-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Dish photo — optional, shown big on the public /m/<slug> menu. */}
          <div>
            <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5">
              {t("menu_item_photo") || "Foto piatto"}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => handlePhotoPick(e.target.files?.[0] ?? null)}
            />
            {imageUrl ? (
              <div className="relative w-full h-44 rounded-xl overflow-hidden border-2 group" style={{ borderColor: "#c4956a" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={name || "Foto piatto"} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="cursor-pointer px-3 py-1.5 rounded-lg bg-white text-black text-xs font-bold shadow"
                  >
                    {t("menu_item_photo_replace") || "Sostituisci"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageUrl(null)}
                    disabled={uploading}
                    className="cursor-pointer px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold shadow inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> {t("menu_item_photo_remove") || "Rimuovi"}
                  </button>
                </div>
                {uploading && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="cursor-pointer w-full h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 text-sm font-semibold transition-colors hover:bg-[rgba(196,149,106,0.08)]"
                style={{ borderColor: "#c4956a", color: "#7e5226", background: "rgba(252,246,237,0.4)" }}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    {t("menu_item_photo_uploading") || "Caricamento..."}
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-6 h-6" />
                    {t("menu_item_photo_add") || "Aggiungi una foto"}
                  </>
                )}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5">
                {t("menu_item_name") || "Nome piatto"}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("menu_item_name_placeholder") || "Es. Spaghetti alla carbonara"}
                className="w-full font-bold text-black border-2 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5">
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
            <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5">
              {t("menu_item_description") || "Ingredienti / descrizione"}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={
                t("menu_item_description_placeholder") || "Ingredienti, preparazione, note..."
              }
              className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5">
                {t("menu_item_category") || "Categoria"}
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full border-2 rounded-lg pl-3 pr-10 py-2 text-sm text-black focus:outline-none focus:ring-1 focus:ring-[#c4956a] appearance-none bg-no-repeat"
                style={{
                  borderColor: "#c4956a",
                  background:
                    "rgba(252,246,237,0.6) url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\") no-repeat right 14px center",
                }}
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
            <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5">
              {t("menu_item_allergens") || "Allergeni"}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_ALLERGENS.map((al) => {
                const active = allergens.includes(al);
                return (
                  <button
                    key={al}
                    type="button"
                    onClick={() => setAllergens(toggleArrayValue(allergens, al))}
                    className={`cursor-pointer text-[11px] uppercase font-bold tracking-wider px-2.5 py-1 rounded border-2 text-black transition-colors ${
                      active ? "bg-[#c4956a]/20" : "hover:bg-[#c4956a]/10"
                    }`}
                    style={{ borderColor: "#c4956a" }}
                  >
                    {allergenLabel(al, language)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5">
              {t("menu_item_tags") || "Tag"}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_TAGS.map((tg) => {
                const active = tags.includes(tg);
                return (
                  <button
                    key={tg}
                    type="button"
                    onClick={() => setTags(toggleArrayValue(tags, tg))}
                    className={`cursor-pointer text-[11px] uppercase font-bold tracking-wider px-2.5 py-1 rounded border-2 text-black transition-colors ${
                      active ? "bg-[#c4956a]/20" : "hover:bg-[#c4956a]/10"
                    }`}
                    style={{ borderColor: "#c4956a" }}
                  >
                    {tagLabel(tg, language)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          className="flex items-center justify-between p-4 border-t shrink-0"
          style={{ borderColor: "#c4956a" }}
        >
          <div>
            {isEditing && onDelete && (
              <button
                onClick={onDelete}
                className="cursor-pointer px-4 py-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg border-2 border-red-300 hover:border-red-400 inline-flex items-center text-sm font-bold"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                {t("delete") || "Elimina"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="cursor-pointer px-4 py-2 border-2 rounded-lg text-sm font-bold text-black hover:bg-zinc-50"
              style={{ borderColor: "#c4956a" }}
            >
              {t("cancel") || "Annulla"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 px-6 py-2 text-white text-sm font-bold rounded-lg shadow-sm flex items-center"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? t("saving") || "Salvataggio..." : t("save") || "Salva"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryEditModal({
  t,
  tenantId,
  existingMaxOrder,
  initial,
  onClose,
  onSaved,
  onDelete,
}: {
  t: (k: any) => string;
  tenantId: string;
  existingMaxOrder: number;
  initial: MenuCategory | null;
  onClose: () => void;
  onSaved: (cat: MenuCategory) => void;
  onDelete?: () => void;
}) {
  const supabase = createClient();
  const isEditing = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    let error: { message: string } | null = null;
    let saved: MenuCategory | null = null;
    if (isEditing) {
      const res = await supabase
        .from("menu_categories")
        .update({ name: name.trim() })
        .eq("id", initial!.id)
        .select()
        .single();
      error = res.error;
      saved = (res.data as MenuCategory) || null;
    } else {
      const res = await supabase
        .from("menu_categories")
        .insert({
          tenant_id: tenantId,
          name: name.trim(),
          sort_order: existingMaxOrder + 1,
        })
        .select()
        .single();
      error = res.error;
      saved = (res.data as MenuCategory) || null;
    }
    setSaving(false);
    if (error) {
      console.error("[menu] save category failed", error);
      alert(`Errore salvataggio categoria: ${error.message}`);
      return;
    }
    if (saved) onSaved(saved);
    onClose();
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
          className="flex items-center justify-between p-5 border-b shrink-0"
          style={{ borderColor: "#c4956a" }}
        >
          <h2 className="text-lg font-bold text-black">
            {isEditing
              ? t("menu_edit_category") || "Modifica categoria"
              : t("menu_new_category") || "Nuova categoria"}
          </h2>
          <button
            onClick={onClose}
            className="cursor-pointer p-1.5 hover:bg-zinc-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5">
            {t("menu_category_name") || "Nome categoria"}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              t("menu_category_name_placeholder") || "Es. Antipasti, Primi, Dolci..."
            }
            className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
            style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
            autoFocus
          />
        </div>

        <div
          className="flex items-center justify-between p-4 border-t shrink-0"
          style={{ borderColor: "#c4956a" }}
        >
          <div>
            {isEditing && onDelete && (
              <button
                onClick={onDelete}
                className="cursor-pointer px-4 py-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg border-2 border-red-300 hover:border-red-400 inline-flex items-center text-sm font-bold"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                {t("delete") || "Elimina"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="cursor-pointer px-4 py-2 border-2 rounded-lg text-sm font-bold text-black hover:bg-zinc-50"
              style={{ borderColor: "#c4956a" }}
            >
              {t("cancel") || "Annulla"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 px-6 py-2 text-white text-sm font-bold rounded-lg shadow-sm flex items-center"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? t("saving") || "Salvataggio..." : t("save") || "Salva"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportMenuModal({
  t,
  language,
  tenantId,
  existingItemsCount,
  onClose,
}: {
  t: (k: any) => string;
  language: MenuLocale;
  tenantId: string;
  existingItemsCount: number;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [tab, setTab] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<"idle" | "uploading" | "processing" | "preview" | "saving" | "done">("idle");
  const [extracted, setExtracted] = useState<ExtractedMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [savedCounts, setSavedCounts] = useState<{ cats: number; items: number } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // Progress bar. For multi-page menus the Edge Function reports real
  // processed/total page-chunks; for single-shot jobs (one OpenAI call, no
  // progress feed) we fall back to a decelerating time-based estimate. Either
  // way the bar is kept monotonic via progressRef so it never jumps backward,
  // and never freezes (the estimate keeps inching toward — but never reaching —
  // the cap, so it can't look "stuck at 92%").
  const [progressPct, setProgressPct] = useState(0);
  const progressRef = useRef(0);

  // Poll the job status while extraction runs on the Supabase Edge Function.
  // Large PDFs take 60-120s, well past Vercel's 60s cap, so the work is async.
  useEffect(() => {
    if (stage !== "processing" || !jobId) return;
    let cancelled = false;
    const startedAt = Date.now();
    // The Edge Function runs the OpenAI call in the background with its own
    // ~140s internal timeout (the 60s figure is only the synchronous HTTP
    // connection cap — fire-and-forget compute runs well past it; a real
    // 18-page menu completed at ~87s). So we give the worker until ~150s before
    // declaring it dead, instead of spinning forever. Most menus (text-layer
    // PDFs) finish in well under 30s.
    const DEAD_AFTER_MS = 150_000;

    const failNow = () => {
      if (cancelled) return;
      setError(
        t("menu_import_timeout") ||
          "Il menu è troppo grande per essere letto entro il limite di tempo. Prova a comprimerlo o a dividerlo in più file."
      );
      setStage("idle");
    };

    // Only ever move the bar forward. A "done" passes force=true to snap to 100.
    const setPct = (next: number, force = false) => {
      const clamped = Math.max(0, Math.min(100, Math.round(next)));
      if (force || clamped > progressRef.current) {
        progressRef.current = clamped;
        setProgressPct(clamped);
      }
    };

    // Fallback estimate when there's no real per-chunk signal (single OpenAI
    // call). Decelerating curve that approaches — but never reaches — 95%, so
    // the bar always keeps inching and never looks frozen.
    const estimate = (elapsed: number) => 95 * (1 - Math.exp(-elapsed / 28_000));

    const tick = async () => {
      const elapsed = Date.now() - startedAt;

      let data: {
        status?: string;
        result?: ExtractedMenu;
        error?: string;
        totalChunks?: number | null;
        processedChunks?: number;
      } | null = null;
      try {
        const res = await fetch(`/api/menu/import-job/${jobId}`);
        if (res.ok) data = await res.json();
        else if (res.status !== 404) {
          // 5xx — keep trying; transient.
        }
        // 404 → row not visible yet; fall through to the time estimate.
      } catch {
        // network blip — keep polling, advance the estimate below.
      }
      if (cancelled) return;

      if (data?.status === "done") {
        setExtracted(data.result as ExtractedMenu);
        setPct(100, true);
        setStage("preview");
        return;
      }
      if (data?.status === "error") {
        // Server already marked it failed — surface immediately, no waiting.
        setError(data.error || t("menu_import_failed") || "Estrazione fallita.");
        setStage("idle");
        return;
      }

      // Still pending/processing → advance the bar.
      const total = data?.totalChunks ?? null;
      if (total && total > 1) {
        // REAL progress for a multi-page menu. Map finished page-chunks into an
        // 8→88% band; the top is reserved for the final enrichment pass (runs
        // after the last chunk). A gentle time-based creep rides on top so the
        // bar still moves between waves and during enrichment — never frozen.
        const done = Math.min(data?.processedChunks ?? 0, total);
        const base = 8 + (done / total) * 80; // 8% .. 88%
        const creep = Math.min(7, (elapsed / 1000) * 0.15); // up to +7% over time
        setPct(base + creep);
      } else {
        // Single-shot job (text or one file): no real feed → decelerating estimate.
        setPct(estimate(elapsed));
      }

      if (elapsed > DEAD_AFTER_MS) {
        // We already read status above; if it wasn't done/error by now the
        // worker is dead. Fail fast instead of spinning forever.
        failNow();
      }
    };

    void tick();
    const iv = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [stage, jobId, t]);

  // Accept by MIME type OR by extension (browsers report a blank/generic type
  // for files dragged from some apps). Mirrors the server: PDF, images, .docx,
  // .csv. Limits live in @/lib/menu/limits so client + server can't drift.
  const isAcceptedFile = (f: File) =>
    !!VISION_MIME[f.type.toLowerCase()] ||
    ACCEPTED_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext));

  // Single entry point for a chosen file (picker OR drag-drop): validate type
  // and size up front and surface a clear error instead of failing later in
  // the upload with an opaque 4xx.
  const acceptFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!isAcceptedFile(f)) {
      setError(t("menu_import_bad_type") || "Unsupported file type.");
      setFile(null);
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(
        t("menu_import_too_big") || `File too large (max ${MAX_UPLOAD_MB} MB).`
      );
      setFile(null);
      return;
    }
    setError(null);
    setFile(f);
  };

  // Drag-and-drop. preventDefault on dragOver AND drop is what stops the
  // browser from navigating away and opening the dropped PDF in the tab
  // (the previous behaviour, which read to the user as "drag-drop is broken").
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragging) setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    setTab("file");
    acceptFile(e.dataTransfer?.files?.[0]);
  };

  const switchTab = (next: "file" | "url") => {
    setTab(next);
    setError(null);
  };

  const handleUpload = async () => {
    if (!file) return;
    setStage("uploading");
    setError(null);
    progressRef.current = 0;
    setProgressPct(0);
    try {
      const form = new FormData();
      form.append("tenant_id", tenantId);
      form.append("file", file);
      // Create an async job; the heavy OpenAI extraction runs on the Supabase
      // Edge Function (150s) so it survives Vercel's 60s cap. We then poll.
      const res = await fetch("/api/menu/import-job", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        setStage("idle");
        return;
      }
      setJobId(data.jobId);
      setStage("processing");
    } catch (e: any) {
      setError(e?.message || "Errore di rete");
      setStage("idle");
    }
  };

  const handleUrlImport = async () => {
    if (!url.trim()) return;
    setStage("uploading");
    setError(null);
    progressRef.current = 0;
    setProgressPct(0);
    try {
      // Same async job as file upload: the heavy OpenAI extraction runs on the
      // Supabase Edge Function (150s) so a vision-only menu behind a URL (e.g.
      // an image-only PDF) survives Vercel's 60s cap. We then poll.
      const res = await fetch("/api/menu/import-job", {
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
      setJobId(data.jobId);
      setStage("processing");
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
        // Replace the current menu (a re-upload means "this is the menu now").
        body: JSON.stringify({ tenant_id: tenantId, extracted, mode: "replace" }),
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
        onDragOver={stage === "idle" ? onDragOver : undefined}
        onDragLeave={stage === "idle" ? onDragLeave : undefined}
        onDrop={stage === "idle" ? onDrop : undefined}
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
                  onClick={() => switchTab("file")}
                  className={`cursor-pointer px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${
                    tab === "file"
                      ? "text-black"
                      : "border-transparent text-black hover:text-black"
                  }`}
                  style={tab === "file" ? { borderColor: "#c4956a" } : { borderColor: "transparent" }}
                >
                  <Upload className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                  {t("menu_import_tab_file") || "File"}
                </button>
                <button
                  onClick={() => switchTab("url")}
                  className={`cursor-pointer px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${
                    tab === "url"
                      ? "text-black"
                      : "border-transparent text-black hover:text-black"
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
                  className={`cursor-pointer border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                    dragging ? "bg-[#fcf6ed]" : "hover:bg-zinc-50"
                  }`}
                  style={{ borderColor: dragging ? "#a87642" : "#c4956a" }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/gif,.docx,text/csv,.csv"
                    onChange={(e) => {
                      acceptFile(e.target.files?.[0]);
                      // Reset so picking the same file again re-fires onChange.
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                  {dragging ? (
                    <div>
                      <Upload className="w-10 h-10 mx-auto mb-3 text-[#a87642]" />
                      <p className="text-sm font-bold text-[#a87642]">
                        {t("menu_import_drop_active") || "Rilascia qui il file"}
                      </p>
                    </div>
                  ) : file ? (
                    <div className="flex items-center justify-center gap-3">
                      {file.type.startsWith("image/") ? (
                        <ImageIcon className="w-8 h-8 text-black" />
                      ) : (
                        <FileText className="w-8 h-8 text-black" />
                      )}
                      <div className="text-left">
                        <p className="font-bold text-black text-sm">{file.name}</p>
                        <p className="text-xs text-black">
                          {(file.size / 1024).toFixed(0)} KB · {file.type || "PDF"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-10 h-10 mx-auto mb-3 text-black" />
                      <p className="text-sm font-bold text-black">
                        {t("menu_import_drop") || "Clicca o trascina qui un PDF, un'immagine, un Word o un CSV"}
                      </p>
                      <p className="text-xs text-black mt-1">
                        {t("menu_import_formats") || `PDF, JPEG, PNG, WEBP, Word, CSV — max ${MAX_UPLOAD_MB} MB`}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs uppercase font-bold tracking-widest text-black mb-1.5">
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
                  <p className="text-xs text-black mt-2">
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

          {(stage === "uploading" || stage === "processing") && (
            <div className="py-12 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-[#c4956a]" />
              <p className="font-bold text-black">
                {t("menu_import_analyzing") || "Sto leggendo il menu..."}
              </p>
              <p className="text-xs text-black mt-1">
                {t("menu_import_wait") || "Può richiedere fino a 2 minuti per menu grandi."}
              </p>
              {stage === "processing" && (
                <div className="mt-5 max-w-xs mx-auto">
                  <div className="h-2 w-full rounded-full bg-zinc-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#c4956a] transition-all duration-700 ease-out"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-black mt-1.5 tabular-nums">{progressPct}%</p>
                </div>
              )}
            </div>
          )}

          {stage === "preview" && extracted && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase font-bold tracking-widest text-black">
                    {t("menu_import_preview") || "Anteprima"}
                  </p>
                  <p className="text-sm font-bold text-black">
                    {extracted.categories.length} {t("menu_categories") || "categorie"} · {totalItems}{" "}
                    {t("menu_dishes") || "piatti"}
                  </p>
                </div>
                {extracted.raw_notes && (
                  <p className="text-xs text-black italic max-w-xs text-right">
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
                    language={language}
                    name={cat.name}
                    items={cat.items}
                    onUpdate={(ii, patch) => updatePreviewItem(ci, ii, patch)}
                    onRemove={(ii) => removePreviewItem(ci, ii)}
                  />
                ))}
                {extracted.uncategorized.length > 0 && (
                  <PreviewCategory
                    t={t}
                    language={language}
                    name={t("menu_uncategorized") || "Senza categoria"}
                    items={extracted.uncategorized}
                    onUpdate={(ii, patch) => updatePreviewItem("uncat", ii, patch)}
                    onRemove={(ii) => removePreviewItem("uncat", ii)}
                  />
                )}
              </div>

              {existingItemsCount > 0 && (
                <div className="mt-5 p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-900">
                    {(t("menu_import_replace_warning") as string) ||
                      "Questo sostituirà il menu attuale"}{" "}
                    ({existingItemsCount} {t("menu_dishes") || "piatti"}).{" "}
                    {(t("menu_import_replace_warning_hint") as string) ||
                      "I piatti esistenti verranno eliminati e sostituiti con quelli qui sopra."}
                  </p>
                </div>
              )}

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
            <div className="py-10 text-center">
              <CheckCircle2 className="w-14 h-14 mx-auto mb-4 text-emerald-500" />
              <p className="text-lg font-black text-black">
                {t("menu_import_done") || "Menu importato!"}
              </p>
              <p className="text-sm text-black mt-2">
                {savedCounts.cats} {t("menu_categories") || "categorie"} · {savedCounts.items}{" "}
                {t("menu_dishes") || "piatti"}
              </p>

              {/* The AI reads the menu automatically and can miss a dish or an
                  allergen/tag. Tell the user plainly to give it a once-over.
                  Icon + text are centered as a vertical stack to match the rest
                  of this confirmation panel. */}
              <div className="mt-5 mx-auto max-w-md p-4 bg-amber-50 border border-amber-300 rounded-xl text-center flex flex-col items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-amber-900">
                    {(t("menu_import_verify_title") as string) || "Controlla il menu"}
                  </p>
                  <p className="text-sm text-amber-900 mt-1">
                    {(t("menu_import_verify_body") as string) ||
                      "L'estrazione automatica può saltare qualche piatto o sbagliare un prezzo, un allergene o un tag. Dai un'occhiata alla lista e correggi quello che serve."}
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="cursor-pointer mt-6 px-6 py-2 text-white text-sm font-bold rounded-lg shadow-sm"
                style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              >
                {(t("menu_import_verify_cta") as string) || "Ho capito, controllo il menu"}
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
  language,
  name,
  items,
  onUpdate,
  onRemove,
}: {
  t: (k: any) => string;
  language: MenuLocale;
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
                    className="w-full text-xs text-black bg-transparent focus:outline-none focus:bg-white focus:border-b focus:border-[#c4956a] py-0.5 mt-0.5"
                  />
                )}
                {(it.allergens.length > 0 || it.tags.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {it.tags.map((tg) => (
                      <span
                        key={tg}
                        className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700"
                      >
                        {tagLabel(tg, language)}
                      </span>
                    ))}
                    {it.allergens.map((al) => (
                      <span
                        key={al}
                        className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-orange-50 text-orange-700"
                      >
                        {allergenLabel(al, language)}
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
          <p className="text-sm text-black mb-5 leading-relaxed">
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
            <p className="text-xs text-black mt-3 font-mono break-all text-center px-2">
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

// Create / edit a collection: name (classic quick-pick or custom) + a
// multi-select of EXISTING dishes (grouped by category, searchable). A dish
// stays in its home category; this only adds/removes its membership links.
function CollectionEditModal({
  t,
  language,
  tenantId,
  items,
  categories,
  existingCollections,
  existingLinks,
  existingMaxOrder,
  initial,
  onClose,
  onSaved,
  onDeleted,
}: {
  t: (k: any) => string;
  language: MenuLocale;
  tenantId: string;
  items: MenuItem[];
  categories: MenuCategory[];
  existingCollections: MenuCollection[];
  existingLinks: MenuCollectionItem[];
  existingMaxOrder: number;
  initial: MenuCollection | null;
  onClose: () => void;
  onSaved: (col: MenuCollection, links: MenuCollectionItem[]) => void;
  onDeleted: (collectionId: string) => void;
}) {
  const supabase = createClient();
  const isEditing = !!initial;

  const [kind, setKind] = useState<CollectionKind | null>(initial?.kind ?? null);
  const [name, setName] = useState(initial?.name ?? "");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  // Item ids currently checked into this collection.
  const [selected, setSelected] = useState<Set<string>>(() =>
    initial ? itemIdsInCollection(existingLinks, initial.id) : new Set()
  );

  // Which classic kinds are already used by another collection (so we disable
  // them — one collection per classic kind keeps the bot mapping unambiguous).
  const usedKinds = useMemo(() => {
    const s = new Set<CollectionKind>();
    for (const c of existingCollections) {
      if (c.kind && c.id !== initial?.id) s.add(c.kind);
    }
    return s;
  }, [existingCollections, initial]);

  const pickClassic = (k: CollectionKind) => {
    setKind(k);
    // Prefill the (still-editable) name with the localized classic name.
    setName(collectionLabel(k, "", language));
  };
  const useCustom = () => {
    setKind(null);
    setName("");
  };

  const toggleItem = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Dishes grouped by category for the picker, honoring the search box.
  const groupedItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (it: MenuItem) =>
      !q || it.name.toLowerCase().includes(q) || it.description.toLowerCase().includes(q);
    const byCat = new Map<string | null, MenuItem[]>();
    for (const it of items) {
      if (!match(it)) continue;
      const k = it.category_id;
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k)!.push(it);
    }
    // Order: categories in their sort order, then uncategorized last.
    const groups: { id: string | null; name: string; items: MenuItem[] }[] = [];
    for (const c of categories) {
      const list = byCat.get(c.id);
      if (list && list.length) groups.push({ id: c.id, name: c.name, items: list });
    }
    const uncat = byCat.get(null);
    if (uncat && uncat.length)
      groups.push({ id: null, name: t("menu_uncategorized") || "Senza categoria", items: uncat });
    return groups;
  }, [items, categories, search, t]);

  const canSave = name.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);

    let collectionId = initial?.id ?? null;
    let savedCol: MenuCollection | null = initial ?? null;

    // 1) upsert the collection row
    if (isEditing) {
      const res = await supabase
        .from("menu_collections")
        .update({ name: name.trim(), kind })
        .eq("id", initial!.id)
        .select()
        .single();
      if (res.error) {
        setSaving(false);
        alert(`Errore salvataggio raccolta: ${res.error.message}`);
        return;
      }
      savedCol = res.data as MenuCollection;
      collectionId = savedCol.id;
    } else {
      const res = await supabase
        .from("menu_collections")
        .insert({
          tenant_id: tenantId,
          name: name.trim(),
          kind,
          sort_order: existingMaxOrder + 1,
        })
        .select()
        .single();
      if (res.error) {
        setSaving(false);
        alert(`Errore salvataggio raccolta: ${res.error.message}`);
        return;
      }
      savedCol = res.data as MenuCollection;
      collectionId = savedCol.id;
    }

    // 2) diff membership and apply only the changes (avoids churn / transient
    //    empty state flashing to other tabs).
    const previous = isEditing ? itemIdsInCollection(existingLinks, initial!.id) : new Set<string>();
    const { toAdd, toRemove } = membershipDiff(previous, selected);

    if (toRemove.length > 0) {
      const del = await supabase
        .from("menu_collection_items")
        .delete()
        .eq("collection_id", collectionId!)
        .in("item_id", toRemove);
      if (del.error) {
        setSaving(false);
        alert(`Errore aggiornamento piatti: ${del.error.message}`);
        return;
      }
    }
    let insertedRows: MenuCollectionItem[] = [];
    if (toAdd.length > 0) {
      const ins = await supabase
        .from("menu_collection_items")
        .insert(toAdd.map((item_id) => ({ tenant_id: tenantId, collection_id: collectionId!, item_id })))
        .select();
      if (ins.error) {
        setSaving(false);
        alert(`Errore aggiunta piatti: ${ins.error.message}`);
        return;
      }
      insertedRows = (ins.data || []) as MenuCollectionItem[];
    }

    // Build the final link set for this collection (kept rows + inserted rows).
    const keptRows = existingLinks.filter(
      (l) => l.collection_id === collectionId && !toRemove.includes(l.item_id)
    );
    const finalLinks = [...keptRows, ...insertedRows];

    setSaving(false);
    if (savedCol) onSaved(savedCol, finalLinks);
    onClose();
  };

  const handleDelete = async () => {
    if (!initial) return;
    if (
      !confirm(
        t("menu_confirm_delete_collection") ||
          "Eliminare questa raccolta? I piatti resteranno nel menu."
      )
    )
      return;
    const { error } = await supabase.from("menu_collections").delete().eq("id", initial.id);
    if (error) {
      console.error("[menu] delete collection failed", error);
      alert(`Errore eliminazione raccolta: ${error.message}`);
      return;
    }
    onDeleted(initial.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b shrink-0" style={{ borderColor: "#c4956a" }}>
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5" style={{ color: "#c4956a" }} fill="#c4956a" />
            <h2 className="text-lg font-bold text-black">
              {isEditing
                ? t("menu_edit_collection") || "Modifica raccolta"
                : t("menu_new_collection") || "Nuova raccolta"}
            </h2>
          </div>
          <button onClick={onClose} className="cursor-pointer p-1.5 hover:bg-zinc-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Classic quick-picks (only prominent when creating) */}
          {!isEditing && (
            <div>
              <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5">
                {t("menu_collection_pick_classic") || "Raccolte pronte"}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {CLASSIC_COLLECTION_KINDS.map((k) => {
                  const used = usedKinds.has(k);
                  const active = kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={used}
                      onClick={() => pickClassic(k)}
                      className={`cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 text-[11px] font-bold tracking-wider px-2.5 py-1.5 rounded border-2 text-black transition-colors ${
                        active ? "bg-[#c4956a]/20" : "hover:bg-[#c4956a]/10"
                      }`}
                      style={{ borderColor: "#c4956a" }}
                      title={used ? t("menu_collection_already_exists") || "Già creata" : undefined}
                    >
                      {collectionLabel(k, "", language)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={useCustom}
                  className={`cursor-pointer text-[11px] font-bold tracking-wider px-2.5 py-1.5 rounded border-2 text-black transition-colors ${
                    kind === null ? "bg-[#c4956a]/20" : "hover:bg-[#c4956a]/10"
                  }`}
                  style={{ borderColor: "#c4956a" }}
                >
                  {t("menu_collection_custom") || "Personalizzata"}
                </button>
              </div>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5">
              {t("menu_collection_name") || "Nome raccolta"}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                // Typing a name by hand on a fresh modal means "custom".
                if (!isEditing && kind !== null) setKind(kind);
              }}
              placeholder={t("menu_collection_name_placeholder") || "Es. Menu del giorno, Consigliati..."}
              className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
            />
          </div>

          {/* Multi-select dishes */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-black uppercase tracking-widest">
                {t("menu_collection_select_dishes") || "Scegli i piatti"}
              </label>
              <span className="text-[11px] font-bold text-[#a87642]">
                {selected.size} {t("menu_collection_selected") || "selezionati"}
              </span>
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("menu_search_placeholder") || "Cerca piatto..."}
                className="w-full pl-9 pr-3 py-2 border-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
              />
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-black/60 italic py-4 text-center">
                {t("menu_collection_no_items") || "Non ci sono ancora piatti nel menu da aggiungere."}
              </p>
            ) : groupedItems.length === 0 ? (
              <p className="text-sm text-black/60 italic py-4 text-center">
                {t("menu_no_results") || "Nessun risultato"}
              </p>
            ) : (
              <div
                className="border-2 rounded-lg max-h-[34vh] overflow-y-auto divide-y"
                style={{ borderColor: "rgba(196,149,106,0.4)" }}
              >
                {groupedItems.map((g) => (
                  <div key={g.id ?? "uncat"}>
                    <div
                      className="px-3 py-1.5 text-[10px] uppercase font-black tracking-widest text-[#a87642] sticky top-0"
                      style={{ background: "rgba(252,246,237,0.98)" }}
                    >
                      {g.name}
                    </div>
                    {g.items.map((it) => {
                      const checked = selected.has(it.id);
                      return (
                        <label
                          key={it.id}
                          className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[#fcf6ed]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleItem(it.id)}
                            className="w-4 h-4 cursor-pointer accent-[#c4956a]"
                          />
                          <span className="flex-1 text-sm font-bold text-black truncate">{it.name}</span>
                          {it.price != null && (
                            <span className="text-xs text-black/60 whitespace-nowrap">
                              {it.price.toFixed(2)} {it.currency === "EUR" ? "€" : it.currency}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between p-4 border-t shrink-0" style={{ borderColor: "#c4956a" }}>
          <div>
            {isEditing && (
              <button
                onClick={handleDelete}
                className="cursor-pointer px-4 py-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg border-2 border-red-300 hover:border-red-400 inline-flex items-center text-sm font-bold"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                {t("delete") || "Elimina"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="cursor-pointer px-4 py-2 border-2 rounded-lg text-sm font-bold text-black hover:bg-zinc-50"
              style={{ borderColor: "#c4956a" }}
            >
              {t("cancel") || "Annulla"}
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 px-6 py-2 text-white text-sm font-bold rounded-lg shadow-sm flex items-center"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? t("saving") || "Salvataggio..." : t("save") || "Salva"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
