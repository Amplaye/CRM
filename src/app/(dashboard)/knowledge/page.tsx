"use client";

import { FileText, Plus, Search, Archive, BookOpen, Clock, User, ChevronRight, ChevronLeft, Save, X, History, Trash2, Filter, AlertTriangle, Settings2, GripVertical } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { KnowledgeArticle } from "@/lib/types";
import { useAuth } from "@/lib/contexts/AuthContext";

export default function KnowledgePage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const { user } = useAuth();
  const supabase = createClient();

  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState<KnowledgeArticle["category"]>("general");
  const [editStatus, setEditStatus] = useState<KnowledgeArticle["status"]>("draft");
  const [editRiskTags, setEditRiskTags] = useState("");

  const [saving, setSaving] = useState(false);

  const syncRetellKB = async () => {
    if (!tenant) return;
    try {
      await fetch("/api/sync-kb-retell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenant.id }),
      });
    } catch (err) {
      console.error("Auto-sync KB error:", err);
    }
  };

  useEffect(() => {
    if (!tenant) return;

    const fetchArticles = async () => {
      const { data, error } = await supabase
        .from("knowledge_articles")
        .select("*")
        .eq("tenant_id", tenant.id);

      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }

      const docs = (data || []) as KnowledgeArticle[];
      docs.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
      setArticles(docs);
      setLoading(false);
    };

    fetchArticles();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchArticles(), 500);
    };

    const channel = supabase
      .channel("knowledge_articles_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "knowledge_articles", filter: `tenant_id=eq.${tenant.id}` }, () => debouncedFetch())
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [tenant]);

  const selectedArticle = articles.find(a => a.id === selectedArticleId) || null;

  const handleStartEdit = (article?: KnowledgeArticle) => {
     if (article) {
        setSelectedArticleId(article.id);
        setEditTitle(article.title);
        setEditContent(article.content);
        setEditCategory(article.category);
        setEditStatus(article.status);
        setEditRiskTags(article.risk_tags.join(", "));
     } else {
        setSelectedArticleId(null);
        setEditTitle("New Article");
        setEditContent("");
        setEditCategory("general");
        setEditStatus("draft");
        setEditRiskTags("");
     }
     setIsEditing(true);
  };

  const handleSave = async () => {
     if (!tenant || !user) return;
     setSaving(true);
     try {
        const payload: Partial<KnowledgeArticle> = {
           tenant_id: tenant.id,
           title: editTitle,
           content: editContent,
           category: editCategory,
           status: editStatus,
           risk_tags: editRiskTags.split(",").map(t => t.trim()).filter(t => t !== ""),
           updated_at: new Date().toISOString(),
           author_id: user.id
        };

        if (selectedArticleId) {
           const currentVersion = selectedArticle?.version || 1;
           payload.version = currentVersion + 1;
           const { tenant_id: _tid, ...updatePayload } = payload as any;
           const { error: updateErr } = await supabase.from("knowledge_articles").update(updatePayload).eq("id", selectedArticleId);
           if (updateErr) { console.error("KB update error:", updateErr); alert("Error: " + updateErr.message); }
           else {
             // Update local state immediately
             setArticles(prev => prev.map(a => a.id === selectedArticleId ? { ...a, ...payload, id: selectedArticleId } as KnowledgeArticle : a));
           }
        } else {
           payload.version = 1;
           payload.created_at = new Date().toISOString();
           payload.display_order = (articles.reduce((max, a) => Math.max(max, a.display_order ?? 0), 0)) + 1;
           const { data: inserted, error: insertErr } = await supabase.from("knowledge_articles").insert(payload).select("*").single();
           if (insertErr) { console.error("KB insert error:", insertErr); alert("Error: " + insertErr.message); }
           else if (inserted) {
             setSelectedArticleId(inserted.id);
             setArticles(prev => [inserted as KnowledgeArticle, ...prev]);
           }
        }
        setIsEditing(false);
        syncRetellKB();
     } catch (err) { console.error(err); }
     setSaving(false);
  };

  const handleDelete = async (id: string) => {
     if (!confirm(t("know_delete_confirm"))) return;
     try {
        await supabase.from("knowledge_articles").delete().eq("id", id);
        if (selectedArticleId === id) setSelectedArticleId(null);
        syncRetellKB();
     } catch (err) { console.error(err); }
  }

  // Drag-and-drop reorder state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const touchStartY = useRef<number>(0);
  const touchDragIdx = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const finishReorder = useCallback(async (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const reordered = [...articles];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    // Reassign display_order sequentially
    const updated = reordered.map((a, i) => ({ ...a, display_order: i }));
    setArticles(updated);
    setDragIdx(null);
    setDragOverIdx(null);
    // Persist all changed orders
    await Promise.all(updated.map(a =>
      supabase.from("knowledge_articles").update({ display_order: a.display_order }).eq("id", a.id)
    ));
    syncRetellKB();
  }, [articles, supabase]);

  // Touch drag handlers for mobile
  const handleTouchStartDrag = (e: React.TouchEvent, idx: number) => {
    touchStartY.current = e.touches[0].clientY;
    touchDragIdx.current = idx;
    setDragIdx(idx);
  };

  const handleTouchMoveDrag = useCallback((e: React.TouchEvent) => {
    if (touchDragIdx.current === null || !listRef.current) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    const items = listRef.current.querySelectorAll('[data-drag-item]');
    let overIdx = touchDragIdx.current;
    items.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (y > rect.top && y < rect.bottom) overIdx = i;
    });
    setDragOverIdx(overIdx);
  }, []);

  const handleTouchEndDrag = useCallback(() => {
    if (touchDragIdx.current !== null && dragOverIdx !== null) {
      finishReorder(touchDragIdx.current, dragOverIdx);
    }
    touchDragIdx.current = null;
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragOverIdx, finishReorder]);

  // Native touch listener to prevent scroll while dragging
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (touchDragIdx.current !== null) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  });

  return (
    <div className="p-0 h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-4rem)] flex overflow-hidden">

      {/* Article List Pane — hidden on mobile when article is open */}
      <div className={`border-r flex flex-col shrink-0 ${selectedArticleId || isEditing ? 'hidden md:flex md:w-[400px]' : 'w-full md:w-[400px]'}`} style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
         <div className="p-6 border-b shrink-0" style={{ borderColor: '#c4956a' }}>
            <h1 className="text-xl font-bold text-black tracking-tight">{t("know_title")}</h1>
            <p className="text-xs text-black mt-1">{t("know_subtitle")}</p>

            <div className="mt-6 flex space-x-2">
               <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black" />
                  <input type="text" placeholder={t("know_search_placeholder") || "Search articles..."} className="w-full pl-9 pr-3 py-2 border-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
               </div>
               <button onClick={() => handleStartEdit()} className="p-2 text-white rounded-lg transition-colors shadow-sm" style={{ background: 'linear-gradient(135deg, #d4a574, #c4956a)' }} title="New article">
                  <Plus className="w-5 h-5" />
               </button>
            </div>
         </div>

         <div className="flex-1 overflow-y-auto">
            {loading ? (
               <div className="p-6 space-y-4 animate-pulse">
                  {[1,2,3,4].map(i => <div key={i} className="h-16 bg-zinc-200 rounded-xl" />)}
               </div>
            ) : articles.length === 0 ? (
               <div className="p-12 text-center text-black">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-10" />
                  <p className="text-sm font-bold">{t("know_no_articles") || "No articles yet"}</p>
               </div>
            ) : (
               <div ref={listRef} className="divide-y" style={{ borderColor: 'rgba(196,149,106,0.3)' }}
                 onTouchMove={handleTouchMoveDrag} onTouchEnd={handleTouchEndDrag} onTouchCancel={handleTouchEndDrag}
               >
                  {articles.map((article, idx) => (
                     <div
                        key={article.id}
                        data-drag-item
                        draggable
                        onDragStart={() => setDragIdx(idx)}
                        onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                        onDragEnd={() => { if (dragIdx !== null && dragOverIdx !== null) finishReorder(dragIdx, dragOverIdx); setDragIdx(null); setDragOverIdx(null); }}
                        onClick={() => setSelectedArticleId(article.id)}
                        className={`p-4 sm:p-5 cursor-pointer transition-all relative ${
                          dragOverIdx === idx && dragIdx !== null && dragIdx !== idx ? 'border-t-2 border-blue-400' : ''
                        } ${dragIdx === idx ? 'opacity-40' : ''} ${
                          selectedArticleId === article.id ? 'bg-white shadow-sm ring-1 ring-zinc-200 z-10' : 'bg-transparent hover:bg-zinc-50/80'
                        }`}
                     >
                        <div className="flex items-start gap-2">
                           <div
                             className="pt-1 cursor-grab active:cursor-grabbing text-black hover:text-black touch-none flex-shrink-0"
                             onTouchStart={(e) => { e.stopPropagation(); handleTouchStartDrag(e, idx); }}
                           >
                              <GripVertical className="w-4 h-4" />
                           </div>
                           <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-center mb-1">
                                 <span className={`text-[10px] uppercase font-bold tracking-widest ${article.status === 'published' ? 'text-emerald-600' : 'text-black'}`}>
                                    {article.status}
                                 </span>
                              </div>
                              <h3 className="font-bold text-black text-sm leading-tight truncate">{article.title}</h3>
                              <p className="text-xs text-black line-clamp-1 mt-1">{article.category} • {t("know_updated_on") || "Updated"} {new Date(article.updated_at).toLocaleDateString()}</p>
                           </div>
                        </div>
                     </div>
                  ))}
               </div>
            )}
         </div>
      </div>

      {/* Content View / Edit Pane — full screen on mobile */}
      <div className={`flex-1 overflow-y-auto flex flex-col ${!selectedArticleId && !isEditing ? 'hidden md:flex' : ''}`} style={{ background: 'rgba(252,246,237,0.85)' }}>
         {isEditing ? (
            <div className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto w-full space-y-4 sm:space-y-6 lg:space-y-8 animate-in fade-in slide-in-from-bottom-2">
               <div className="flex items-center justify-between border-b pb-4 md:pb-6" style={{ borderColor: '#c4956a' }}>
                  <div className="flex items-center space-x-1">
                     <button onClick={() => { setIsEditing(false); setSelectedArticleId(null); }} className="p-1.5 border-2 border-red-400 text-red-500 hover:bg-red-50 rounded-lg transition-colors mr-2">
                        <X className="w-4 h-4" />
                     </button>
                     <h2 className="text-xl font-bold text-black">{selectedArticleId ? t("know_edit_article") : t("know_new_article")}</h2>
                  </div>
                  <button
                     onClick={handleSave}
                     disabled={saving || !editTitle.trim()}
                     className="px-6 py-2 text-white text-sm font-bold rounded-lg shadow-sm transition-colors flex items-center disabled:opacity-50"
                     style={{ background: 'linear-gradient(135deg, #d4a574, #c4956a)' }}
                  >
                     <Save className="w-4 h-4 mr-2" />
                     {saving ? t("saving") : t("know_save_publish")}
                  </button>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
                  <div className="space-y-4">
                     <div>
                        <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5 ml-1">{t("know_title_label")}</label>
                        <input
                           type="text"
                           value={editTitle}
                           onChange={e => setEditTitle(e.target.value)}
                           className="w-full text-2xl font-bold text-black bg-transparent border-none focus:ring-0 p-1 placeholder:text-black"
                           placeholder={t("know_title_placeholder")}
                        />
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5 ml-1">{t("know_category_label")}</label>
                           <select
                              value={editCategory}
                              onChange={e => setEditCategory(e.target.value as any)}
                              className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                           >
                              <option value="general">{t("know_general")}</option>
                              <option value="policies">{t("know_policies")}</option>
                              <option value="menu">{t("know_menu")}</option>
                              <option value="troubleshooting">{t("know_troubleshooting")}</option>
                           </select>
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5 ml-1">{t("know_status_label")}</label>
                           <select
                              value={editStatus}
                              onChange={e => setEditStatus(e.target.value as any)}
                              className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                           >
                              <option value="draft">{t("know_draft")}</option>
                              <option value="published">{t("know_published")}</option>
                              <option value="archived">{t("know_archived")}</option>
                           </select>
                        </div>
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-black uppercase tracking-widest mb-1.5 ml-1">{t("know_risk_tags")}</label>
                        <input
                           type="text"
                           value={editRiskTags}
                           onChange={e => setEditRiskTags(e.target.value)}
                           className="w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a] placeholder:text-black/50" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                           placeholder={t("know_risk_placeholder")}
                        />
                     </div>
                  </div>
               </div>

               <div className="flex-1 flex flex-col">
                  <label className="block text-xs font-bold text-black uppercase tracking-widest mb-2 ml-1">{t("know_content_label")}</label>
                  <textarea
                     value={editContent}
                     onChange={e => setEditContent(e.target.value)}
                     className="flex-1 w-full border-2 rounded-xl p-6 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-[#c4956a] font-mono placeholder:text-black/50"
                     style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
                     placeholder={t("know_content_placeholder")}
                  />
               </div>
            </div>
         ) : selectedArticle ? (
            <div className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-right-2">
               {/* Mobile back button */}
               <button onClick={() => setSelectedArticleId(null)} className="md:hidden flex items-center text-sm font-medium text-black mb-3 -ml-1">
                  <ChevronLeft className="w-4 h-4 mr-1" /> {t("know_back")}
               </button>
               <div className="flex flex-col md:flex-row md:items-center justify-between border-b pb-4 md:pb-8 mb-4 md:mb-8 gap-3" style={{ borderColor: '#c4956a' }}>
                  <div className="flex items-center space-x-3 md:space-x-4 min-w-0">
                     <div className="h-10 w-10 md:h-14 md:w-14 rounded-xl md:rounded-2xl flex items-center justify-center text-white shadow-lg flex-shrink-0" style={{ background: 'linear-gradient(135deg, #d4a574, #c4956a)' }}>
                        <FileText className="w-5 h-5 md:w-7 md:h-7" />
                     </div>
                     <div className="min-w-0">
                        <p className="text-[10px] md:text-xs font-black uppercase tracking-widest text-black">{selectedArticle.category}</p>
                        <h2 className="text-xl md:text-3xl font-black text-black tracking-tight truncate">{selectedArticle.title}</h2>
                     </div>
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                     <button
                        onClick={() => handleDelete(selectedArticle.id)}
                        className="p-2.5 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                     >
                        <Trash2 className="w-5 h-5" />
                     </button>
                     <button
                        onClick={() => handleStartEdit(selectedArticle)}
                        className="px-6 py-2.5 text-white text-sm font-bold rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center"
                        style={{ background: 'linear-gradient(135deg, #d4a574, #c4956a)' }}
                     >
                        <Settings2 className="w-4 h-4 mr-2" />
                        {t("know_edit_article")}
                     </button>
                  </div>
               </div>

               <div className="flex flex-wrap items-center gap-2 mb-6 md:mb-10 text-xs font-bold text-black uppercase tracking-wider">
                  <div className="flex items-center bg-zinc-100 px-3 py-1.5 rounded-lg">
                     <History className="w-3.5 h-3.5 mr-2" /> {new Date(selectedArticle.updated_at).toLocaleDateString()}
                  </div>
               </div>

               <div className="flex-1 prose prose-zinc max-w-none">
                  <div className="whitespace-pre-wrap text-black leading-relaxed text-lg bg-zinc-50/50 p-8 rounded-3xl border-2" style={{ borderColor: '#c4956a' }}>
                     {selectedArticle.content}
                  </div>
               </div>

               {selectedArticle.risk_tags.length > 0 && (
                  <div className="mt-10 border-t pt-8" style={{ borderColor: '#c4956a' }}>
                     <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-black mb-4 ml-1">{t("know_ai_safety_risk") || "AI Safety Risk Tags"}</h4>
                     <div className="flex flex-wrap gap-2">
                        {selectedArticle.risk_tags.map(tag => (
                           <span key={tag} className="px-3 py-1.5 bg-red-50 text-red-700 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-red-100 flex items-center">
                              <AlertTriangle className="w-3 h-3 mr-1.5" /> {tag}
                           </span>
                        ))}
                     </div>
                  </div>
               )}
            </div>
         ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center animate-in fade-in duration-500">
               <div className="h-24 w-24 bg-zinc-50 rounded-full flex items-center justify-center mb-6">
                  <BookOpen className="w-10 h-10 text-zinc-200" />
               </div>
               <h2 className="text-2xl font-black text-black tracking-tight">{t("know_title")}</h2>
               <p className="text-black max-w-sm mt-2 leading-relaxed font-medium">{t("know_empty_desc") || "Select an article from the list or create a new one to start training your operational agents."}</p>
               <button
                  onClick={() => handleStartEdit()}
                  className="mt-8 px-8 py-3 text-white font-bold rounded-2xl transition-all flex items-center group"
                  style={{ background: 'linear-gradient(135deg, #d4a574, #c4956a)' }}
               >
                  <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform" />
                  {t("know_create_first") || "Create First Article"}
               </button>
            </div>
         )}
      </div>

    </div>
  );
}
