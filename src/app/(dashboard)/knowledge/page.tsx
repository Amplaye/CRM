"use client";

import { FileText, Plus, AlertCircle, RefreshCw } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useTenant } from "@/lib/contexts/TenantContext";
import { KnowledgeArticle } from "@/lib/types";

export default function KnowledgePage() {
  const { t } = useLanguage();
  const { activeTenant: tenant } = useTenant();
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    const q = query(
      collection(db, "knowledge_articles"),
      where("tenant_id", "==", tenant.id)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as KnowledgeArticle));
      docs.sort((a,b) => b.updated_at - a.updated_at);
      setArticles(docs);
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [tenant]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{t("know_title")}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t("know_subtitle")}</p>
        </div>
        <div className="mt-4 sm:mt-0 flex space-x-3">
          <button className="inline-flex items-center px-4 py-2 border border-zinc-200 text-sm font-medium rounded-md shadow-sm text-zinc-700 bg-white hover:bg-zinc-50 transition-colors cursor-not-allowed opacity-50">
            <RefreshCw className="-ml-1 mr-2 h-4 w-4" />
            {t("know_sync")}
          </button>
          <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-zinc-900 hover:bg-zinc-800 transition-colors">
            <Plus className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
            {t("know_add")}
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
         <table className="min-w-full divide-y divide-zinc-200">
          <thead className="bg-zinc-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t("know_col_title")}</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t("know_col_category")}</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t("know_col_status")}</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t("know_col_updated")}</th>
              <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-zinc-200">
            {loading ? (
             <tr>
               <td colSpan={5} className="py-16 text-center animate-pulse text-zinc-400">Loading...</td>
             </tr>
           ) : articles.length === 0 ? (
             <tr>
               <td colSpan={5} className="py-16 text-center text-zinc-500">
                 <FileText className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
                 <p className="text-sm font-medium text-zinc-900">No knowledge base articles</p>
                 <p className="text-sm mt-1">Add items to configure your AI</p>
               </td>
             </tr>
           ) : articles.map(article => (
                <tr key={article.id} className={`hover:bg-zinc-50 transition-colors cursor-pointer ${article.is_temporary ? 'bg-amber-50/20' : ''}`}>
                  <td className="px-6 py-4">
                     <div className="flex items-center">
                        <FileText className={`h-5 w-5 mr-3 ${article.status === 'active' ? 'text-zinc-900' : 'text-zinc-400'}`} />
                        <div>
                           <p className="text-sm font-medium text-zinc-900">{article.title}</p>
                           <p className="text-xs text-zinc-500 max-w-xs truncate">{article.content}</p>
                        </div>
                     </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 capitalize">{article.category}</td>
                  <td className="px-6 py-4 whitespace-nowrap flex space-x-2 items-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${article.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-800'}`}>
                        {article.status.toUpperCase()}
                      </span>
                      {article.is_temporary && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                          <AlertCircle className="w-3 h-3 mr-1" /> TEMPORARY
                        </span>
                      )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                     {new Date(article.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <span className="text-zinc-400 hover:text-zinc-900 cursor-pointer">{t("kb_action_edit")}</span>
                  </td>
                </tr>
            ))}
          </tbody>
         </table>
      </div>
    </div>
  );
}
