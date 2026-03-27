"use client";

import { FileText, Plus, Search, Archive, BookOpen, Clock, User, ChevronRight, Save, X, History, Trash2, Filter, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc, setDoc, getDocs, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { KnowledgeArticle } from "@/lib/types";
import { useAuth } from "@/lib/contexts/AuthContext";

export default function KnowledgePage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const { user } = useAuth();
  
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

  useEffect(() => {
    if (!tenant) return;
    
    const fetchArticles = async () => {
       const q = query(collection(db, "knowledge_articles"), where("tenant_id", "==", tenant.id));
       const unsubscribe = onSnapshot(q, (snapshot) => {
         const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as KnowledgeArticle));
         docs.sort((a,b) => b.updated_at - a.updated_at);
         setArticles(docs);
         setLoading(false);
       });
       return unsubscribe;
    };

    fetchArticles().then(unsub => {
       return () => unsub();
    });
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
           updated_at: Date.now(),
           author_id: user.uid
        };

        if (selectedArticleId) {
           const currentVersion = selectedArticle?.version || 1;
           payload.version = currentVersion + 1;
           await updateDoc(doc(db, "knowledge_articles", selectedArticleId), payload);
        } else {
           const aRef = doc(collection(db, "knowledge_articles"));
           payload.id = aRef.id;
           payload.version = 1;
           payload.created_at = Date.now();
           await setDoc(aRef, payload);
           setSelectedArticleId(aRef.id);
        }
        setIsEditing(false);
     } catch (err) { console.error(err); }
     setSaving(false);
  };

  const handleDelete = async (id: string) => {
     if (!confirm("Are you sure you want to delete this article?")) return;
     try {
        await deleteDoc(doc(db, "knowledge_articles", id));
        if (selectedArticleId === id) setSelectedArticleId(null);
     } catch (err) { console.error(err); }
  }

  return (
    <div className="p-0 h-[calc(100vh-4rem)] flex bg-zinc-50 overflow-hidden">
      
      {/* Article List Pane */}
      <div className="w-[400px] border-r border-zinc-200 bg-white flex flex-col shrink-0">
         <div className="p-6 border-b border-zinc-100 shrink-0">
            <h1 className="text-xl font-bold text-zinc-900 tracking-tight">Knowledge Base</h1>
            <p className="text-xs text-zinc-500 mt-1">AI reference materials and operation policies.</p>
            
            <div className="mt-6 flex space-x-2">
               <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                  <input type="text" placeholder="Search articles..." className="w-full pl-9 pr-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" />
               </div>
               <button onClick={() => handleStartEdit()} className="p-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors shadow-sm">
                  <Plus className="w-5 h-5" />
               </button>
            </div>
         </div>

         <div className="flex-1 overflow-y-auto bg-zinc-50/20">
            {loading ? (
               <div className="p-6 space-y-4 animate-pulse">
                  {[1,2,3,4].map(i => <div key={i} className="h-16 bg-zinc-200 rounded-xl" />)}
               </div>
            ) : articles.length === 0 ? (
               <div className="p-12 text-center text-zinc-400">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-10" />
                  <p className="text-sm font-bold">No articles yet</p>
               </div>
            ) : (
               <div className="divide-y divide-zinc-100">
                  {articles.map(article => (
                     <div 
                        key={article.id} 
                        onClick={() => setSelectedArticleId(article.id)}
                        className={`p-5 cursor-pointer transition-all relative ${selectedArticleId === article.id ? 'bg-white shadow-sm ring-1 ring-zinc-200 z-10' : 'bg-transparent hover:bg-zinc-50/80'}`}
                     >
                        <div className="flex justify-between items-start mb-1">
                           <span className={`text-[10px] uppercase font-bold tracking-widest ${article.status === 'published' ? 'text-emerald-600' : 'text-zinc-400'}`}>
                              {article.status}
                           </span>
                           <span className="text-[10px] font-mono text-zinc-400">v{article.version}</span>
                        </div>
                        <h3 className="font-bold text-zinc-900 text-sm leading-tight truncate">{article.title}</h3>
                        <p className="text-xs text-zinc-500 line-clamp-1 mt-1">{article.category} • Updated {new Date(article.updated_at).toLocaleDateString()}</p>
                     </div>
                  ))}
               </div>
            )}
         </div>
      </div>

      {/* Content View / Edit Pane */}
      <div className="flex-1 overflow-y-auto flex flex-col bg-white">
         {isEditing ? (
            <div className="flex-1 flex flex-col p-8 max-w-4xl mx-auto w-full space-y-8 animate-in fade-in slide-in-from-bottom-2">
               <div className="flex items-center justify-between border-b border-zinc-100 pb-6">
                  <div className="flex items-center space-x-1">
                     <button onClick={() => setIsEditing(false)} className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-full transition-colors mr-2">
                        <X className="w-5 h-5" />
                     </button>
                     <h2 className="text-xl font-bold text-zinc-900">{selectedArticleId ? 'Edit Article' : 'New Article'}</h2>
                  </div>
                  <button 
                     onClick={handleSave} 
                     disabled={saving || !editTitle.trim()}
                     className="px-6 py-2 bg-zinc-900 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-zinc-800 transition-colors flex items-center disabled:opacity-50"
                  >
                     <Save className="w-4 h-4 mr-2" />
                     {saving ? 'Saving...' : 'Save & Publish Version'}
                  </button>
               </div>

               <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                     <div>
                        <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Title</label>
                        <input 
                           type="text" 
                           value={editTitle}
                           onChange={e => setEditTitle(e.target.value)}
                           className="w-full text-2xl font-bold text-zinc-900 bg-transparent border-none focus:ring-0 p-1 placeholder:text-zinc-300" 
                           placeholder="How to handle nut allergies..."
                        />
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Category</label>
                           <select 
                              value={editCategory}
                              onChange={e => setEditCategory(e.target.value as any)}
                              className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                           >
                              <option value="general">General</option>
                              <option value="policies">Policies</option>
                              <option value="menu">Menu</option>
                              <option value="troubleshooting">Troubleshooting</option>
                           </select>
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Status</label>
                           <select 
                              value={editStatus}
                              onChange={e => setEditStatus(e.target.value as any)}
                              className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                           >
                              <option value="draft">Draft</option>
                              <option value="published">Published</option>
                              <option value="archived">Archived</option>
                           </select>
                        </div>
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1.5 ml-1">Risk Tags (comma separated)</label>
                        <input 
                           type="text" 
                           value={editRiskTags}
                           onChange={e => setEditRiskTags(e.target.value)}
                           className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" 
                           placeholder="legal, safety, high-risk..."
                        />
                     </div>
                  </div>
                  <div className="bg-zinc-900/5 rounded-2xl p-6 flex flex-col">
                     <div className="flex items-center space-x-2 text-zinc-400 mb-4">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">AI Agent Note</span>
                     </div>
                     <p className="text-xs text-zinc-600 leading-relaxed font-medium">
                        This content is indexed by the AI Agent for RAG (Retrieval-Augmented Generation). 
                        Be concise and focus on immutable facts or policies the agent must strictly follow during calls or chats.
                     </p>
                  </div>
               </div>

               <div className="flex-1 flex flex-col">
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2 ml-1">Article Content (Markdown supported)</label>
                  <textarea 
                     value={editContent}
                     onChange={e => setEditContent(e.target.value)}
                     className="flex-1 w-full bg-zinc-50 border border-zinc-200 rounded-xl p-6 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-zinc-900 font-mono"
                     placeholder="# Policies... \n\n1. Always ask about allergies..."
                  />
               </div>
            </div>
         ) : selectedArticle ? (
            <div className="flex-1 flex flex-col p-8 max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-right-2">
               <div className="flex items-center justify-between border-b border-zinc-100 pb-8 mb-8">
                  <div className="flex items-center space-x-4">
                     <div className="h-14 w-14 rounded-2xl bg-zinc-900 flex items-center justify-center text-white shadow-lg">
                        <FileText className="w-7 h-7" />
                     </div>
                     <div>
                        <p className="text-xs font-black uppercase tracking-widest text-zinc-400">{selectedArticle.category}</p>
                        <h2 className="text-3xl font-black text-zinc-900 tracking-tight">{selectedArticle.title}</h2>
                     </div>
                  </div>
                  <div className="flex items-center space-x-2">
                     <button 
                        onClick={() => handleDelete(selectedArticle.id)}
                        className="p-2.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                     >
                        <Trash2 className="w-5 h-5" />
                     </button>
                     <button 
                        onClick={() => handleStartEdit(selectedArticle)}
                        className="px-6 py-2.5 bg-zinc-900 text-white text-sm font-bold rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center"
                     >
                        <Settings2 className="w-4 h-4 mr-2" />
                        Edit Article
                     </button>
                  </div>
               </div>

               <div className="flex items-center space-x-6 mb-10 text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  <div className="flex items-center bg-zinc-100 px-3 py-1.5 rounded-lg">
                     <Clock className="w-3.5 h-3.5 mr-2" /> Version {selectedArticle.version}
                  </div>
                  <div className="flex items-center bg-zinc-100 px-3 py-1.5 rounded-lg">
                     <User className="w-3.5 h-3.5 mr-2" /> Author: {selectedArticle.author_id.substring(0,8)}
                  </div>
                  <div className="flex items-center bg-zinc-100 px-3 py-1.5 rounded-lg">
                     <History className="w-3.5 h-3.5 mr-2" /> {new Date(selectedArticle.updated_at).toLocaleDateString()}
                  </div>
               </div>

               <div className="flex-1 prose prose-zinc max-w-none">
                  <div className="whitespace-pre-wrap text-zinc-800 leading-relaxed text-lg bg-zinc-50/50 p-8 rounded-3xl border border-zinc-100 shadow-sm">
                     {selectedArticle.content}
                  </div>
               </div>

               {selectedArticle.risk_tags.length > 0 && (
                  <div className="mt-10 border-t border-zinc-100 pt-8">
                     <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 mb-4 ml-1">AI Safety Risk Tags</h4>
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
               <h2 className="text-2xl font-black text-zinc-900 tracking-tight">AI Knowledge Base</h2>
               <p className="text-zinc-500 max-w-sm mt-2 leading-relaxed font-medium">Select an article from the list or create a new one to start training your operational agents.</p>
               <button 
                  onClick={() => handleStartEdit()} 
                  className="mt-8 px-8 py-3 bg-zinc-900 text-white font-bold rounded-2xl shadow-xl hover:shadow-2xl hover:bg-zinc-800 transition-all flex items-center group"
               >
                  <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform" />
                  Create First Article
               </button>
            </div>
         )}
      </div>

    </div>
  );
}
