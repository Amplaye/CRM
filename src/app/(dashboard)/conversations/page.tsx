"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Conversation, Guest, Reservation } from "@/lib/types";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { MessageSquare, Phone, CheckCircle2, Search, X, CalendarCheck, AlertTriangle, Send, Bot, User, Bookmark, Flame, Trash2 } from "lucide-react";

interface ConvoWithGuest extends Conversation {
  guests?: Guest;
}

export default function ConversationsPage() {
  const { activeTenant: tenant } = useTenant();
  const { t } = useLanguage();
  const supabase = createClient();
  const searchParams = useSearchParams();
  const guestParam = searchParams.get("guest");

  const [conversations, setConversations] = useState<ConvoWithGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null);
  const [autoSelected, setAutoSelected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const [linkedRes, setLinkedRes] = useState<Reservation | null>(null);

  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch Conversations with guest data
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

      if (error) {
        console.error("Failed to load conversations", error);
        setLoading(false);
        return;
      }

      const convos = (data || []) as ConvoWithGuest[];
      setConversations(convos);
      setLoading(false);

      // Auto-select conversation if guest param is in URL
      if (guestParam && !autoSelected) {
        const match = convos.find(c => c.guest_id === guestParam);
        if (match) {
          setSelectedConvoId(match.id);
          setAutoSelected(true);
        }
      }
    };

    fetchConversations();

    const channel = supabase
      .channel("conversations_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `tenant_id=eq.${tenant.id}` }, () => {
        fetchConversations();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenant]);

  // React to URL guest param changes
  useEffect(() => {
    if (guestParam && conversations.length > 0) {
      const match = conversations.find(c => c.guest_id === guestParam);
      if (match) setSelectedConvoId(match.id);
    }
  }, [guestParam, conversations]);

  const selectedConvo = conversations.find(c => c.id === selectedConvoId) || null;
  const selectedGuest = selectedConvo?.guests || null;

  // Fetch linked reservation
  useEffect(() => {
    if (!selectedConvo || !tenant) { setLinkedRes(null); return; }

    const fetchLinked = async () => {
      if (selectedConvo.linked_reservation_id) {
        const { data } = await supabase
          .from("reservations")
          .select("*")
          .eq("id", selectedConvo.linked_reservation_id)
          .single();
        setLinkedRes(data as Reservation || null);
      } else {
        setLinkedRes(null);
      }
    };
    fetchLinked();
  }, [selectedConvo?.id, tenant]);

  // Scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selectedConvo?.transcript]);

  // Filter conversations by search
  const filtered = conversations.filter(conv => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const guestName = conv.guests?.name?.toLowerCase() || "";
    const guestPhone = conv.guests?.phone?.toLowerCase() || "";
    const summary = conv.summary?.toLowerCase() || "";
    return guestName.includes(q) || guestPhone.includes(q) || summary.includes(q);
  });

  // Handlers
  const handleSend = async () => {
    if (!replyText.trim() || !selectedConvo || !selectedGuest) return;
    setSending(true);
    try {
      // 1. Send real WhatsApp message via Twilio
      if (selectedConvo.channel === "whatsapp" && selectedGuest.phone) {
        const res = await fetch("/api/send-whatsapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: selectedGuest.phone, message: replyText })
        });
        const result = await res.json();
        if (!result.success) {
          console.error("WhatsApp send failed:", result.error);
        }
      }

      // 2. Save to transcript
      const newMessage = { role: "staff", content: replyText, timestamp: Date.now() };
      const updatedTranscript = [...(selectedConvo.transcript || []), newMessage];
      const updates: any = { transcript: updatedTranscript, updated_at: new Date().toISOString() };
      if (selectedConvo.status === "abandoned") updates.status = "active";
      await supabase.from("conversations").update(updates).eq("id", selectedConvo.id);
      setReplyText("");
    } catch (err) { console.error(err); }
    setSending(false);
  };

  const handleStatusChange = async (newStatus: Conversation["status"]) => {
    if (!selectedConvo) return;
    await supabase.from("conversations").update({ status: newStatus, updated_at: Date.now() }).eq("id", selectedConvo.id);
  };

  const toggleEscalation = async () => {
    if (!selectedConvo) return;
    const isEscalated = !selectedConvo.escalation_flag;
    await supabase.from("conversations").update({
      escalation_flag: isEscalated,
      status: isEscalated ? "escalated" : "active",
      updated_at: Date.now()
    }).eq("id", selectedConvo.id);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)));
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    const idsToDelete = Array.from(selectedIds);
    setConversations(prev => prev.filter(c => !selectedIds.has(c.id)));
    if (selectedConvoId && selectedIds.has(selectedConvoId)) setSelectedConvoId(null);
    setSelectedIds(new Set());
    await supabase.from("conversations").delete().in("id", idsToDelete);
    setDeleting(false);
  };

  const deleteSingle = async (id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (selectedConvoId === id) setSelectedConvoId(null);
    selectedIds.delete(id);
    setSelectedIds(new Set(selectedIds));
    await supabase.from("conversations").delete().eq("id", id);
  };

  const getGuestDisplay = (conv: ConvoWithGuest) => {
    if (conv.guests?.name && conv.guests.name !== "Unknown Guest") return conv.guests.name;
    if (conv.guests?.phone) return conv.guests.phone;
    return "Unknown Guest";
  };

  const getGuestPhone = (conv: ConvoWithGuest) => {
    return conv.guests?.phone || "";
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-4rem)] border-t" style={{ borderColor: '#c4956a' }}>

      {/* COLUMN 1: Inbox List */}
      <div className={`flex flex-col border-r transition-all duration-300 ${selectedConvo ? 'hidden md:flex md:w-[380px]' : 'w-full'}`} style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
        <div className="p-4 md:p-6 border-b z-10" style={{ borderColor: '#c4956a' }}>
          <h1 className="text-xl md:text-2xl font-bold text-zinc-900 tracking-tight">{t("conv_title")}</h1>
          <p className="mt-0.5 md:mt-1 text-xs md:text-sm text-black">{t("conv_subtitle")}</p>
          <div className="mt-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t("conv_search")}
              className="w-full pl-9 pr-3 py-2 border-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
            />
          </div>
          {filtered.length > 0 && (
            <div className="mt-3 flex items-center justify-between">
              <button onClick={selectAll} className="flex items-center gap-1.5 text-xs font-medium text-black/60 hover:text-black">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filtered.length && filtered.length > 0}
                  onChange={selectAll}
                  className="w-3.5 h-3.5 rounded accent-[#c4956a] cursor-pointer"
                />
                {selectedIds.size === filtered.length ? t("conv_deselect_all") : t("conv_select_all")}
              </button>
              {selectedIds.size > 0 && (
                <button
                  onClick={deleteSelected}
                  disabled={deleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("conv_delete")} ({selectedIds.size})
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 space-y-4">
              {[1,2,3].map(i => (
                <div key={i} className="animate-pulse flex items-start space-x-4 p-4 rounded-xl border-2" style={{ background: 'rgba(252,246,237,0.6)', borderColor: '#c4956a' }}>
                  <div className="w-10 h-10 bg-zinc-200 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-zinc-200 rounded w-1/4" />
                    <div className="h-3 bg-zinc-200 rounded w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-black">
              <MessageSquare className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
              <p className="text-sm font-medium text-zinc-900">{t("conv_empty")}</p>
              <p className="text-sm mt-1">{t("conv_empty_sub")}</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
              {filtered.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => setSelectedConvoId(conv.id)}
                  className={`p-4 hover:bg-[#c4956a]/5 cursor-pointer transition-colors relative ${selectedConvo?.id === conv.id ? 'bg-[#c4956a]/10' : ''}`}
                >
                  {conv.escalation_flag && (
                    <div className="absolute top-0 right-0 w-0 h-0 border-t-[24px] border-t-red-500 border-l-[24px] border-l-transparent">
                      <AlertTriangle className="absolute -top-[20px] -left-[12px] w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(conv.id)}
                      onChange={(e) => { e.stopPropagation(); toggleSelect(conv.id); }}
                      className="w-4 h-4 rounded accent-[#c4956a] flex-shrink-0 cursor-pointer"
                    />
                    <div className={`p-2 rounded-full ${conv.channel === 'whatsapp' ? 'bg-emerald-100' : 'bg-indigo-100'}`}>
                      {conv.channel === 'whatsapp' ?
                        <MessageSquare className="w-4 h-4 text-emerald-600" /> :
                        <Phone className="w-4 h-4 text-indigo-600" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline">
                        <span className="font-bold text-sm text-black truncate">{getGuestDisplay(conv)}</span>
                        <span className="text-[11px] text-black/40 flex-shrink-0 ml-2">
                          {new Date(conv.updated_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                      </div>
                      {getGuestPhone(conv) && (
                        <p className="text-xs text-black/50 mt-0.5">{getGuestPhone(conv)}</p>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-black line-clamp-2 mt-2 leading-relaxed">{conv.summary || "No summary available..."}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                        conv.status === 'resolved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        conv.status === 'escalated' ? 'bg-red-50 text-red-700 border-red-200' :
                        'bg-zinc-100 text-zinc-700 border-zinc-200'
                      }`}>
                        {conv.status}
                      </span>
                      {conv.intent && conv.intent !== 'unknown' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100">
                          {conv.intent.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSingle(conv.id); }}
                      className="p-1 text-black/20 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* COLUMN 2: Transcript Pane — full screen overlay on mobile */}
      {selectedConvo && (
        <div className="fixed inset-0 md:static md:inset-auto flex-1 flex flex-col relative z-30 md:z-auto" style={{ background: '#EFEAE2' }}>
          {/* Header with guest info */}
          <div className="px-4 md:px-6 py-3 md:py-4 border-b flex justify-between items-center z-10 sticky top-0" style={{ background: 'rgba(252,246,237,0.95)', borderColor: '#c4956a' }}>
            <div className="flex items-center space-x-3">
              <div className={`h-9 w-9 md:h-10 md:w-10 rounded-full flex items-center justify-center text-white font-bold text-sm md:text-base ${selectedConvo.channel === 'whatsapp' ? 'bg-emerald-500' : 'bg-indigo-500'}`}>
                {selectedGuest?.name ? selectedGuest.name.charAt(0).toUpperCase() : '?'}
              </div>
              <div>
                <h3 className="font-bold text-sm md:text-base text-black">
                  {selectedGuest?.name || "Unknown Guest"}
                </h3>
                <p className="text-[11px] md:text-xs text-black/50 font-medium">
                  {selectedGuest?.phone || ""} • {selectedConvo.channel === 'whatsapp' ? 'WhatsApp' : 'Voice Call'}
                </p>
              </div>
            </div>
            <button onClick={() => setSelectedConvoId(null)} className="p-1.5 text-black hover:bg-[#c4956a]/10 rounded-md">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Chat messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 md:p-6 space-y-3 relative z-0">
            <div className="flex justify-center mb-4">
              <span className="text-[11px] font-bold uppercase tracking-widest text-black/40 bg-white/60 px-3 py-1 rounded-md shadow-sm">
                {new Date(selectedConvo.created_at).toLocaleDateString()}
              </span>
            </div>

            {Array.isArray(selectedConvo.transcript) && selectedConvo.transcript.map((msg, i) => {
              const isUser = msg.role === 'user';
              const isStaff = msg.role === 'staff';
              if (msg.role === 'system') return null;

              return (
                <div key={i} className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm
                    ${isUser ? 'bg-white text-black rounded-tl-none' :
                      isStaff ? 'bg-zinc-800 text-white rounded-tr-none' :
                      'bg-emerald-100 text-emerald-900 rounded-tr-none'}`}>
                    {!isUser && (
                      <div className="flex items-center mb-1 space-x-1 opacity-70">
                        {isStaff ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                        <span className="text-[10px] font-bold uppercase tracking-wider">{isStaff ? t("conv_staff") : t("conv_ai")}</span>
                      </div>
                    )}
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    <div className="text-[10px] font-medium mt-1 text-right opacity-50">
                      {msg.timestamp > 1000000000000
                        ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
                        : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reply input */}
          <div className="p-4 border-t z-10 flex items-center space-x-3" style={{ background: 'rgba(252,246,237,0.9)', borderColor: '#c4956a' }}>
            <input
              type="text"
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              disabled={sending || selectedConvo.status === "resolved"}
              placeholder={selectedConvo.status === "resolved" ? t("conv_conversation_resolved") : "Type a reply..."}
              className="flex-1 border-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a] disabled:opacity-50"
              style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}
            />
            <button
              onClick={handleSend}
              disabled={sending || !replyText.trim() || selectedConvo.status === "resolved"}
              className="p-3 text-white rounded-xl transition-colors shadow-sm disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #c4956a 0%, #b8845c 100%)' }}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* COLUMN 3: Context Pane — hidden on mobile */}
      {selectedConvo && (
        <div className="hidden lg:flex w-[320px] border-l flex-col overflow-y-auto" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
          <div className="p-4 border-b" style={{ borderColor: '#c4956a' }}>
            <span className="text-xs font-bold text-black uppercase tracking-widest">{t("conv_details")}</span>
          </div>

          <div className="p-5 space-y-5">
            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleStatusChange(selectedConvo.status === 'resolved' ? 'active' : 'resolved')}
                className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-colors ${selectedConvo.status === 'resolved' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-[#c4956a] text-black hover:bg-[#c4956a]/5'}`}
              >
                <CheckCircle2 className={`w-5 h-5 mb-1 ${selectedConvo.status === 'resolved' ? 'text-emerald-500' : 'text-black/40'}`} />
                <span className="text-xs font-bold">{selectedConvo.status === 'resolved' ? t("conv_resolved_label") : t("conv_resolve")}</span>
              </button>
              <button
                onClick={toggleEscalation}
                className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-colors ${selectedConvo.escalation_flag ? 'border-red-300 bg-red-50 text-red-700' : 'border-[#c4956a] text-black hover:bg-[#c4956a]/5'}`}
              >
                <Flame className={`w-5 h-5 mb-1 ${selectedConvo.escalation_flag ? 'text-red-500 fill-current' : 'text-black/40'}`} />
                <span className="text-xs font-bold">{selectedConvo.escalation_flag ? t("conv_escalated_label") : t("conv_escalate")}</span>
              </button>
            </div>

            {/* AI Analysis */}
            <div className="rounded-xl border-2 p-4" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.5)' }}>
              <div className="flex items-center mb-3 text-black">
                <Bot className="w-4 h-4 mr-2" />
                <h3 className="text-xs font-bold uppercase tracking-wider">{t("conv_ai_analysis")}</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] font-bold text-black/40 uppercase tracking-wider block mb-1">{t("conv_intent_label")}</span>
                  <span className="inline-flex border-2 text-black px-2.5 py-1 rounded text-xs font-semibold" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }}>
                    {selectedConvo.intent ? selectedConvo.intent.replace('_', ' ') : 'unknown'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-black/40 uppercase tracking-wider block mb-1">{t("conv_sentiment_label")}</span>
                  <span className={`inline-flex px-2.5 py-1 rounded text-xs font-semibold ${
                    selectedConvo.sentiment === 'positive' ? 'bg-emerald-50 text-emerald-700' :
                    selectedConvo.sentiment === 'negative' ? 'bg-red-50 text-red-700' :
                    'bg-zinc-100 text-zinc-700'
                  }`}>
                    {selectedConvo.sentiment || 'neutral'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-black/40 uppercase tracking-wider block mb-1">{t("conv_summary_label")}</span>
                  <p className="text-sm text-black leading-relaxed">{selectedConvo.summary || "No summary"}</p>
                </div>
              </div>
            </div>

            {/* Guest Profile */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-black mb-3">{t("conv_guest")}</h3>
              {selectedGuest ? (
                <div className="border-2 rounded-lg p-3" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.5)' }}>
                  <div className="flex items-center">
                    <div className="w-9 h-9 rounded-full bg-[#c4956a]/20 flex items-center justify-center text-[#8b6540] font-bold text-sm">
                      {selectedGuest.name.charAt(0)}
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-bold text-black">{selectedGuest.name}</p>
                      <p className="text-xs text-black/50">{selectedGuest.phone}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-bold text-black">{selectedGuest.visit_count}</p>
                      <p className="text-[10px] text-black/40 uppercase">{t("conv_visits")}</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-black">{selectedGuest.no_show_count}</p>
                      <p className="text-[10px] text-black/40 uppercase">{t("conv_noshows")}</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-black">{selectedGuest.cancellation_count}</p>
                      <p className="text-[10px] text-black/40 uppercase">{t("conv_cancelled")}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-black/40 italic">{t("conv_no_guest")}</p>
              )}
            </div>

            {/* Linked Reservation */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-black mb-3">{t("conv_reservation")}</h3>
              {linkedRes ? (
                <div className="border-2 rounded-lg p-3" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.5)' }}>
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center text-black">
                      <CalendarCheck className="w-4 h-4 mr-2 text-[#c4956a]" />
                      <span className="text-sm font-bold">{linkedRes.date}</span>
                    </div>
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-bold uppercase">{linkedRes.status}</span>
                  </div>
                  <p className="text-xs text-black/60">{linkedRes.time} • {linkedRes.party_size} guests</p>
                </div>
              ) : (
                <div className="border-2 border-dashed rounded-lg p-3 text-center" style={{ borderColor: '#c4956a' }}>
                  <Bookmark className="w-4 h-4 text-black/30 mx-auto mb-1" />
                  <p className="text-xs text-black/40">{t("conv_no_reservation")}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
