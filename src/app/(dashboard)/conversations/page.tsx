"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Conversation, Guest, Reservation } from "@/lib/types";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { MessageSquare, Phone, Search, X, AlertTriangle, Send, Bot, User, Trash2 } from "lucide-react";
import { useSeenSnapshotAndMark } from "@/lib/hooks/useLastSeen";

interface ConvoWithGuest extends Conversation {
  guests?: Guest;
}

export default function ConversationsPage() {
  const { activeTenant: tenant } = useTenant();
  const { t } = useLanguage();
  const supabase = createClient();
  const searchParams = useSearchParams();
  const guestParam = searchParams.get("guest");
  const seenAt = useSeenSnapshotAndMark(tenant?.id, "conversations");

  const [conversations, setConversations] = useState<ConvoWithGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null);
  const [autoSelected, setAutoSelected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    const fetchConversations = async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, guests(*)")
        .eq("tenant_id", tenant.id)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) { console.error(error); setLoading(false); return; }
      const convos = (data || []) as ConvoWithGuest[];
      setConversations(convos);
      setLoading(false);
      if (guestParam && !autoSelected) {
        const match = convos.find(c => c.guest_id === guestParam);
        if (match) { setSelectedConvoId(match.id); setAutoSelected(true); }
      }
    };
    fetchConversations();
    const channel = supabase.channel("conversations_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `tenant_id=eq.${tenant.id}` }, () => fetchConversations())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenant]);

  useEffect(() => {
    if (guestParam && conversations.length > 0) {
      const match = conversations.find(c => c.guest_id === guestParam);
      if (match) setSelectedConvoId(match.id);
    }
  }, [guestParam, conversations]);

  const selectedConvo = conversations.find(c => c.id === selectedConvoId) || null;
  const selectedGuest = selectedConvo?.guests || null;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [selectedConvo?.transcript]);

  const filtered = conversations.filter(conv => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (conv.guests?.name?.toLowerCase() || "").includes(q) || (conv.guests?.phone?.toLowerCase() || "").includes(q) || (conv.summary?.toLowerCase() || "").includes(q);
  });

  const handleSend = async () => {
    if (!replyText.trim() || !selectedConvo || !selectedGuest) return;
    setSending(true);
    try {
      if (selectedConvo.channel === "whatsapp" && selectedGuest.phone) {
        await fetch("/api/send-whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: selectedGuest.phone, message: replyText }) });
      }
      const newMessage = { role: "staff", content: replyText, timestamp: Date.now() };
      const updatedTranscript = [...(selectedConvo.transcript || []), newMessage];
      const updates: any = { transcript: updatedTranscript, updated_at: new Date().toISOString() };
      if (selectedConvo.status === "abandoned") updates.status = "active";
      await supabase.from("conversations").update(updates).eq("id", selectedConvo.id);
      setReplyText("");
    } catch (err) { console.error(err); }
    setSending(false);
  };

  const toggleSelect = (id: string) => { setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const selectAll = () => { selectedIds.size === filtered.length ? setSelectedIds(new Set()) : setSelectedIds(new Set(filtered.map(c => c.id))); };
  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const ids = Array.from(selectedIds);
    setConversations(prev => prev.filter(c => !selectedIds.has(c.id)));
    if (selectedConvoId && selectedIds.has(selectedConvoId)) setSelectedConvoId(null);
    setSelectedIds(new Set());
    await supabase.from("conversations").delete().in("id", ids);
    setDeleting(false);
  };

  const getGuestDisplay = (conv: ConvoWithGuest) => {
    if (conv.guests?.name && conv.guests.name !== "Unknown Guest") return conv.guests.name;
    return conv.guests?.phone || "Unknown Guest";
  };

  const getLastMessage = (conv: ConvoWithGuest) => {
    const t = conv.transcript;
    if (!Array.isArray(t) || t.length === 0) return conv.summary || "";
    return t[t.length - 1]?.content || "";
  };

  const getMsgCount = (conv: ConvoWithGuest) => Array.isArray(conv.transcript) ? conv.transcript.length : 0;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-4rem)]">

      {/* INBOX LIST */}
      <div className={`flex flex-col border-r ${selectedConvo ? 'hidden md:flex md:w-[380px]' : 'w-full md:w-[380px]'}`} style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
        <div className="p-4 md:p-5 border-b" style={{ borderColor: '#c4956a' }}>
          <h1 className="text-xl font-bold text-black">{t("conv_title")}</h1>
          <div className="mt-3 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t("conv_search")}
              className="w-full pl-9 pr-3 py-2 border-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
          </div>
          {selectedIds.size > 0 && (
            <div className="mt-2 flex items-center justify-between">
              <button onClick={selectAll} className="text-xs font-medium text-black">{t("conv_select_all")}</button>
              <button onClick={deleteSelected} disabled={deleting}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-red-600 bg-red-50 border border-red-200 disabled:opacity-50">
                <Trash2 className="w-3 h-3" /> {selectedIds.size}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-zinc-100 rounded-xl animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <MessageSquare className="w-10 h-10 text-black/20 mx-auto mb-3" />
              <p className="text-sm font-medium text-black">{t("conv_empty")}</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'rgba(196,149,106,0.2)' }}>
              {filtered.map(conv => {
                const convUpdated = (conv as any).updated_at || (conv as any).created_at;
                const isNew = convUpdated && convUpdated > seenAt && selectedConvo?.id !== conv.id;
                return (
                <div key={conv.id} onClick={() => setSelectedConvoId(conv.id)}
                  className={`px-4 py-3 cursor-pointer transition-colors active:bg-[#c4956a]/10 ${selectedConvo?.id === conv.id ? 'bg-[#c4956a]/10' : ''} ${isNew ? 'is-new-row' : ''}`}>
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={selectedIds.has(conv.id)}
                      onChange={(e) => { e.stopPropagation(); toggleSelect(conv.id); }}
                      className="w-4 h-4 rounded accent-[#c4956a] flex-shrink-0 cursor-pointer" />
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${conv.channel === 'whatsapp' ? 'bg-emerald-500' : 'bg-indigo-500'}`}>
                      {getGuestDisplay(conv).charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-sm text-black truncate">{getGuestDisplay(conv)}</span>
                        <span className="text-[10px] text-black flex-shrink-0 ml-2">
                          {new Date(conv.updated_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                      </div>
                      <p className="text-xs text-black truncate mt-0.5">{getLastMessage(conv)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {conv.escalation_flag && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                      {getMsgCount(conv) > 0 && (
                        <span className="text-[9px] font-bold text-black bg-[#c4956a]/20 px-1.5 py-0.5 rounded-full">{getMsgCount(conv)}</span>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* TRANSCRIPT — takes full remaining width */}
      {selectedConvo ? (
        <div className="fixed inset-0 md:static md:inset-auto flex-1 flex flex-col z-30 md:z-auto" style={{ background: '#EFEAE2' }}>
          <div className="px-4 md:px-6 py-3 border-b flex justify-between items-center" style={{ background: 'rgba(252,246,237,0.95)', borderColor: '#c4956a' }}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm ${selectedConvo.channel === 'whatsapp' ? 'bg-emerald-500' : 'bg-indigo-500'}`}>
                {selectedGuest?.name ? selectedGuest.name.charAt(0).toUpperCase() : '?'}
              </div>
              <div>
                <h3 className="font-bold text-sm text-black">{selectedGuest?.name || "Unknown Guest"}</h3>
                <p className="text-xs text-black">{selectedGuest?.phone || ""} · {selectedConvo.channel === 'whatsapp' ? t("conv_whatsapp") : t("conv_call_channel")}</p>
              </div>
            </div>
            <button onClick={() => setSelectedConvoId(null)} className="p-1.5 border-2 border-red-400 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2">
            <div className="flex justify-center mb-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-black/50 bg-white/60 px-3 py-1 rounded-full">
                {new Date(selectedConvo.created_at).toLocaleDateString()}
              </span>
            </div>
            {Array.isArray(selectedConvo.transcript) && selectedConvo.transcript.map((msg, i) => {
              const isUser = msg.role === 'user';
              const isStaff = msg.role === 'staff';
              if (msg.role === 'system') return null;
              return (
                <div key={i} className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2 shadow-sm ${
                    isUser ? 'bg-white text-black rounded-bl-none' :
                    isStaff ? 'bg-[#c4956a] text-white rounded-br-none' :
                    'bg-emerald-100 text-black rounded-br-none'}`}>
                    {!isUser && (
                      <div className="flex items-center gap-1 mb-0.5 opacity-60">
                        {isStaff ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                        <span className="text-[9px] font-bold uppercase">{isStaff ? t("conv_staff") : t("conv_ai")}</span>
                      </div>
                    )}
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-[9px] mt-0.5 text-right opacity-40">
                      {msg.timestamp > 1000000000000 ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t flex items-center gap-2" style={{ background: 'rgba(252,246,237,0.95)', borderColor: '#c4956a' }}>
            <input type="text" value={replyText} onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              disabled={sending || selectedConvo.status === "resolved"}
              placeholder={selectedConvo.status === "resolved" ? t("conv_conversation_resolved") : t("conv_reply_placeholder")}
              className="flex-1 border-2 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a] disabled:opacity-50"
              style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
            <button onClick={handleSend} disabled={sending || !replyText.trim() || selectedConvo.status === "resolved"}
              className="p-2.5 text-white rounded-xl disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #d4a574, #c4956a)' }}>
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center" style={{ background: 'rgba(252,246,237,0.85)' }}>
          <div className="text-center">
            <MessageSquare className="w-12 h-12 text-black/10 mx-auto mb-3" />
            <p className="text-sm font-medium text-black">{t("conv_empty")}</p>
          </div>
        </div>
      )}

      {/* Context panel removed — chat takes full width */}
    </div>
  );
}
