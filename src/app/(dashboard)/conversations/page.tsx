"use client";

import { useTenant } from "@/lib/contexts/TenantContext";
import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Conversation, Guest, Reservation } from "@/lib/types";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { MessageSquare, Phone, CheckCircle2, Search, X, CalendarCheck, AlertTriangle, Send, Bot, User, Bookmark, MoreVertical, Flame } from "lucide-react";

export default function ConversationsPage() {
  const { activeTenant: tenant } = useTenant();
  const { t } = useLanguage();
  const supabase = createClient();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null);

  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [linkedRes, setLinkedRes] = useState<Reservation | null>(null);

  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 1. Fetch Conversations
  useEffect(() => {
    if (!tenant) return;
    setLoading(true);

    const fetchConversations = async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("tenant_id", tenant.id)
        .limit(50);

      if (error) {
        console.error("Failed to load conversations", error);
        setLoading(false);
        return;
      }

      const convos = (data || []) as Conversation[];
      convos.sort((a,b) => b.updated_at - a.updated_at);
      setConversations(convos);
      setLoading(false);
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

  const selectedConvo = conversations.find(c => c.id === selectedConvoId) || null;

  // 2. Fetch Context (Guest & Reservation) when a conversation is clicked
  useEffect(() => {
    if (!selectedConvo || !tenant) return;

    const fetchContext = async () => {
      try {
        if (selectedConvo.guest_id) {
          const { data: gData } = await supabase
            .from("guests")
            .select("*")
            .eq("id", selectedConvo.guest_id)
            .single();
          if (gData) setSelectedGuest(gData as Guest);
        }

        if (selectedConvo.linked_reservation_id) {
          const { data: rData } = await supabase
            .from("reservations")
            .select("*")
            .eq("id", selectedConvo.linked_reservation_id)
            .single();
          if (rData) setLinkedRes(rData as Reservation);
          else setLinkedRes(null);
        } else {
          setLinkedRes(null);
        }
      } catch (err) {
         console.error(err);
      }
    };

    fetchContext();
  }, [selectedConvo?.id, tenant]);

  // Scroll to bottom of chat
  useEffect(() => {
    if (scrollRef.current) {
       scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selectedConvo?.transcript]);

  // Handlers
  const handleSend = async () => {
    if (!replyText.trim() || !selectedConvo) return;
    setSending(true);
    try {
      const newMessage = {
        role: "staff",
        content: replyText,
        timestamp: Date.now()
      };

      const updatedTranscript = [...(selectedConvo.transcript || []), newMessage];
      const updates: any = {
        transcript: updatedTranscript,
        updated_at: Date.now()
      };

      if (selectedConvo.status === "abandoned") {
         updates.status = "active";
      }

      await supabase.from("conversations").update(updates).eq("id", selectedConvo.id);
      setReplyText("");
    } catch (err) { console.error(err); }
    setSending(false);
  };

  const handleStatusChange = async (newStatus: Conversation["status"]) => {
    if (!selectedConvo) return;
    try {
      await supabase.from("conversations").update({ status: newStatus, updated_at: Date.now() }).eq("id", selectedConvo.id);
    } catch (err) { console.error(err); }
  };

  const toggleEscalation = async () => {
    if (!selectedConvo) return;
    try {
       const isEscalated = !selectedConvo.escalation_flag;
       await supabase.from("conversations").update({
         escalation_flag: isEscalated,
         status: isEscalated ? "escalated" : "active",
         updated_at: Date.now()
       }).eq("id", selectedConvo.id);
    } catch (err) { console.error(err); }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] border-t" style={{ borderColor: '#c4956a' }}>

      {/* COLUMN 1: Inbox List */}
      <div className={`flex flex-col border-r transition-all duration-300 ${selectedConvo ? 'w-[380px]' : 'w-full max-w-7xl mx-auto'}`} style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>
         <div className="p-6 border-b z-10" style={{ borderColor: '#c4956a' }}>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">{t("conv_title")}</h1>
            <p className="mt-1 text-sm text-black">{t("conv_subtitle")}</p>

            <div className="mt-6 flex space-x-2">
               <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black" />
                  <input type="text" placeholder={t("conv_search")} className="w-full pl-9 pr-3 py-2 border-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a] transition-colors" style={{ borderColor: '#c4956a', background: 'rgba(252,246,237,0.6)' }} />
               </div>
            </div>
         </div>

         <div className="flex-1 overflow-y-auto">
            {loading ? (
               <div className="p-6 space-y-4">
                  {[1,2,3,4].map(i => (
                     <div key={i} className="animate-pulse flex items-start space-x-4 p-4 rounded-xl border-2" style={{ background: 'rgba(252,246,237,0.6)', borderColor: '#c4956a' }}>
                        <div className="w-10 h-10 bg-zinc-200 rounded-full"></div>
                        <div className="flex-1 space-y-2">
                           <div className="h-4 bg-zinc-200 rounded w-1/4"></div>
                           <div className="h-3 bg-zinc-200 rounded w-3/4"></div>
                        </div>
                     </div>
                  ))}
               </div>
            ) : conversations.length === 0 ? (
               <div className="p-12 text-center text-black">
                  <MessageSquare className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
                  <p className="text-sm font-medium text-zinc-900">{t("conv_empty")}</p>
                  <p className="text-sm mt-1">{t("conv_empty_sub")}</p>
               </div>
            ) : (
               <div className="divide-y" style={{ borderColor: 'rgba(196,149,106,0.3)' }}>
                  {conversations.map(conv => (
                     <div
                        key={conv.id}
                        onClick={() => setSelectedConvoId(conv.id)}
                        className={`p-5 hover:bg-zinc-50 cursor-pointer transition-colors relative ${selectedConvo?.id === conv.id ? 'bg-white shadow-sm ring-1 ring-zinc-200 z-10' : ''}`}
                     >
                        {conv.escalation_flag && (
                          <div className="absolute top-0 right-0 w-0 h-0 border-t-[30px] border-t-red-500 border-l-[30px] border-l-transparent">
                             <AlertTriangle className="absolute -top-[26px] -left-[14px] w-3 h-3 text-white" />
                          </div>
                        )}
                        <div className="flex justify-between items-start mb-2">
                           <div className="flex items-center space-x-2">
                              {conv.channel === 'whatsapp' ?
                                 <div className="bg-emerald-100 p-1.5 rounded-md text-emerald-600"><MessageSquare className="w-3.5 h-3.5" /></div> :
                                 <div className="bg-indigo-100 p-1.5 rounded-md text-indigo-600"><Phone className="w-3.5 h-3.5" /></div>
                              }
                              <span className="font-bold text-sm text-zinc-900 truncate max-w-[150px]">
                                {selectedConvo?.id === conv.id && selectedGuest ? selectedGuest.name : `Guest ${conv.guest_id.substring(0,6)}`}
                              </span>
                           </div>
                           <span className="text-xs font-medium text-zinc-400">{new Date(conv.updated_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                        <p className="text-sm text-zinc-600 line-clamp-2 mt-1 pr-6 leading-relaxed">{conv.summary || "No summary available..."}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                           <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                             conv.status === 'resolved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                             conv.status === 'escalated' ? 'bg-red-50 text-red-700 border-red-200' :
                             'bg-zinc-100 text-zinc-700 border-zinc-200'
                           }`}>
                              {conv.status}
                           </span>
                           {conv.intent && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100">
                                 {conv.intent.replace('_', ' ')}
                              </span>
                           )}
                        </div>
                     </div>
                  ))}
               </div>
            )}
         </div>
      </div>

      {/* COLUMN 2: Transcript Pane */}
      {selectedConvo && (
         <div className="flex-1 flex flex-col relative bg-[#EFEAE2]">
            {/* WhatsApp Data Pattern Overlay */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: "url('https://static.whatsapp.net/rsrc.php/v3/yl/r/r2_oK9-1c9X.png')" }}></div>

            <div className="px-6 py-4 bg-white/90 backdrop-blur-md border-b border-zinc-200 flex justify-between items-center shadow-sm z-10 sticky top-0">
               <div className="flex items-center space-x-4">
                  <div className="h-10 w-10 bg-zinc-900 rounded-full flex items-center justify-center text-white font-bold relative">
                     {selectedConvo.channel === 'whatsapp' ? <MessageSquare className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                  </div>
                  <div>
                     <h3 className="font-bold text-zinc-900">
                        {selectedGuest ? selectedGuest.name : "Unknown Guest"}
                     </h3>
                     <p className="text-xs text-zinc-500 font-medium">{selectedConvo.channel === 'whatsapp' ? '+ WhatsApp' : 'Voice Call'}</p>
                  </div>
               </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 relative z-0">
               <div className="flex justify-center mb-6">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500 bg-white/60 backdrop-blur-sm px-3 py-1 rounded-md shadow-sm border border-black/5">
                     {new Date(selectedConvo.created_at).toLocaleDateString()}
                  </span>
               </div>

               {Array.isArray(selectedConvo.transcript) && selectedConvo.transcript.map((msg, i) => {
                  const isUser = msg.role === 'user';
                  const isStaff = msg.role === 'staff';

                  if (msg.role === 'system') return null; // hide system prompts

                  return (
                     <div key={i} className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm
                           ${isUser ? 'bg-white text-zinc-800 rounded-tl-none border border-black/5' :
                             isStaff ? 'bg-zinc-800 text-white rounded-tr-none' :
                             'bg-emerald-100 text-emerald-900 rounded-tr-none border border-emerald-200/50'}`}>

                           {/* Role Label for Assistants */}
                           {!isUser && (
                              <div className="flex items-center mb-1 space-x-1 opacity-70">
                                 {isStaff ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                                 <span className="text-[10px] font-bold uppercase tracking-wider">{isStaff ? 'Staff' : 'AI Agent'}</span>
                              </div>
                           )}

                           <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>

                           <div className={`text-[10px] font-medium mt-1 text-right opacity-60`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                           </div>
                        </div>
                     </div>
                  );
               })}
            </div>

            <div className="p-4 bg-zinc-100 border-t border-zinc-200 z-10 w-full flex items-center space-x-3">
               <input
                 type="text"
                 value={replyText}
                 onChange={e => setReplyText(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && handleSend()}
                 disabled={sending || selectedConvo.status === "resolved"}
                 placeholder={selectedConvo.status === "resolved" ? "Conversation is marked resolved" : "Type a manual staff reply..."}
                 className="flex-1 border-none shadow-sm rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-60 disabled:bg-zinc-200 bg-white"
               />
               <button
                 onClick={handleSend}
                 disabled={sending || !replyText.trim() || selectedConvo.status === "resolved"}
                 className="p-3 bg-zinc-900 text-white rounded-xl hover:bg-zinc-800 transition-colors shadow-sm disabled:opacity-50"
               >
                  <Send className="w-5 h-5" />
               </button>
            </div>
         </div>
      )}

      {/* COLUMN 3: AI Context & CRM Pane */}
      {selectedConvo && (
         <div className="w-[340px] border-l flex flex-col overflow-y-auto" style={{ background: 'rgba(252,246,237,0.85)', borderColor: '#c4956a' }}>

            {/* Header Actions */}
            <div className="p-4 border-b flex justify-between items-center" style={{ borderColor: '#c4956a' }}>
               <span className="text-xs font-bold text-black uppercase tracking-widest">Workspace</span>
               <button onClick={() => setSelectedConvoId(null)} className="p-1.5 text-black hover:text-black hover:bg-[#c4956a]/10 rounded-md transition-colors">
                  <X className="w-4 h-4" />
               </button>
            </div>

            <div className="p-5 space-y-6">

               {/* Quick Actions */}
               <div className="grid grid-cols-2 gap-2">
                  <button
                     onClick={() => handleStatusChange(selectedConvo.status === 'resolved' ? 'active' : 'resolved')}
                     className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-colors ${selectedConvo.status === 'resolved' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                     <CheckCircle2 className={`w-5 h-5 mb-1 ${selectedConvo.status === 'resolved' ? 'text-emerald-500' : 'text-zinc-400'}`} />
                     <span className="text-xs font-bold">{selectedConvo.status === 'resolved' ? 'Resolved' : 'Mark Resolved'}</span>
                  </button>
                  <button
                     onClick={toggleEscalation}
                     className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-colors ${selectedConvo.escalation_flag ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                  >
                     <Flame className={`w-5 h-5 mb-1 ${selectedConvo.escalation_flag ? 'text-red-500 fill-current' : 'text-zinc-400'}`} />
                     <span className="text-xs font-bold">{selectedConvo.escalation_flag ? 'Escalated' : 'Escalate'}</span>
                  </button>
               </div>

               {/* AI Intelligence Block */}
               <div className="bg-blue-50/50 rounded-xl border border-blue-100 p-4">
                  <div className="flex items-center mb-3 text-blue-800">
                     <Bot className="w-4 h-4 mr-2" />
                     <h3 className="text-xs font-bold uppercase tracking-wider">AI Analysis</h3>
                  </div>

                  <div className="space-y-4">
                     <div>
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block mb-1">Intent</span>
                        <div className="inline-flex bg-white border border-blue-100 text-blue-700 px-2.5 py-1 rounded text-xs font-semibold">
                           {selectedConvo.intent ? selectedConvo.intent.replace('_', ' ') : 'Analyzing...'}
                        </div>
                     </div>

                     <div>
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block mb-1">Live Summary</span>
                        <p className="text-sm text-blue-900 leading-relaxed font-medium">
                           {selectedConvo.summary || "Conversation ongoing..."}
                        </p>
                     </div>

                     {selectedConvo.extracted_entities && Object.keys(selectedConvo.extracted_entities).length > 0 && (
                        <div>
                           <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block mb-2">Extracted Entities</span>
                           <div className="bg-white rounded-lg border border-blue-100 divide-y divide-blue-50">
                              {Object.entries(selectedConvo.extracted_entities).map(([key, value]) => (
                                 <div key={key} className="px-3 py-2 flex justify-between items-center">
                                    <span className="text-xs font-medium text-blue-600 capitalize">{key.replace('_', ' ')}</span>
                                    <span className="text-xs font-bold text-blue-900">{String(value)}</span>
                                 </div>
                              ))}
                           </div>
                        </div>
                     )}
                  </div>
               </div>

               {/* Linked CRM Data */}
               <div className="space-y-4 pt-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-black">Linked Records</h3>

                  {/* Guest Profile Card */}
                  {selectedGuest ? (
                     <div className="bg-white border border-zinc-200 rounded-lg p-3 shadow-sm flex items-center justify-between group cursor-pointer hover:border-zinc-300">
                        <div className="flex items-center">
                           <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 font-bold text-xs">
                              {selectedGuest.name.charAt(0)}
                           </div>
                           <div className="ml-3">
                              <p className="text-sm font-bold text-zinc-900">{selectedGuest.name}</p>
                              <p className="text-xs text-zinc-500">Profile • {selectedGuest.visit_count} visits</p>
                           </div>
                        </div>
                        <User className="w-4 h-4 text-zinc-300 group-hover:text-zinc-500" />
                     </div>
                  ) : (
                     <p className="text-xs text-zinc-500 italic">No guest profile linked</p>
                  )}

                  {/* Reservation Card */}
                  {linkedRes ? (
                     <div className="bg-white border border-zinc-200 rounded-lg p-3 shadow-sm group cursor-pointer hover:border-zinc-300">
                        <div className="flex justify-between items-start mb-2">
                           <div className="flex text-zinc-900 items-center">
                              <CalendarCheck className="w-4 h-4 mr-2 text-terracotta-500" />
                              <span className="text-sm font-bold">Reservation</span>
                           </div>
                           <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded text-[10px] font-bold uppercase tracking-wider">{linkedRes.status}</span>
                        </div>
                        <div className="bg-zinc-50/50 rounded p-2 text-xs font-medium text-zinc-600">
                           {linkedRes.date} at {linkedRes.time} • Party of {linkedRes.party_size}
                        </div>
                     </div>
                  ) : (
                     <div className="bg-zinc-50 border border-zinc-200 border-dashed rounded-lg p-3 text-center">
                        <Bookmark className="w-4 h-4 text-zinc-400 mx-auto mb-1" />
                        <p className="text-xs text-zinc-500">No active reservation associated</p>
                     </div>
                  )}
               </div>

            </div>
         </div>
      )}

    </div>
  );
}
