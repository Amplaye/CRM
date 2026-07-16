"use client";

import { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  Send,
  Bot,
  User,
  ChevronLeft,
  CheckCircle2,
  Pause,
  Play,
  Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface BaliConversation {
  id: string;
  guest_phone: string;
  guest_name: string | null;
  human_takeover: boolean;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_direction: string | null;
  unread_count: number;
}

interface BaliMessage {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender: "client" | "bot" | "human";
  body: string;
  created_at: string;
}

export default function BaliInboxPage() {
  const supabase = createClient();

  const [conversations, setConversations] = useState<BaliConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BaliMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [togglingTakeover, setTogglingTakeover] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch conversation list
  const fetchConversations = async () => {
    try {
      const res = await fetch("/api/admin/bali/conversations");
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  // Fetch messages for selected conversation
  const fetchMessages = async (id: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/admin/bali/messages?conversation_id=${id}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (err) {
      console.error(err);
    }
    setLoadingMessages(false);
  };

  useEffect(() => {
    fetchConversations();

    // Realtime: refresh list when any conversation changes
    const convChannel = supabase
      .channel("bali_conversations_realtime")
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "bali_conversations" },
        () => fetchConversations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(convChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When conversation selected, fetch messages and subscribe to new ones
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    fetchMessages(selectedId);

    const msgChannel = supabase
      .channel(`bali_messages_${selectedId}`)
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "bali_messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload: any) => {
          setMessages((prev) => {
            // Avoid duplicate from optimistic insert
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new as BaliMessage];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(msgChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const selectedConvo = conversations.find((c) => c.id === selectedId) || null;

  const filtered = conversations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.guest_name || "").toLowerCase().includes(q) ||
      c.guest_phone.toLowerCase().includes(q) ||
      (c.last_message_preview || "").toLowerCase().includes(q)
    );
  });

  const handleSend = async () => {
    if (!selectedId || !replyText.trim() || sending) return;
    setSending(true);
    const body = replyText.trim();
    setReplyText("");
    try {
      const res = await fetch("/api/admin/bali/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: selectedId, body }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert("Error: " + (data.error || "send failed"));
        setReplyText(body); // restore so user can retry
      }
      // Realtime will pick up the new message; also refetch convo list to update preview
      fetchConversations();
    } catch (err: any) {
      alert("Error: " + err.message);
      setReplyText(body);
    }
    setSending(false);
  };

  const toggleTakeover = async () => {
    if (!selectedConvo || togglingTakeover) return;
    setTogglingTakeover(true);
    try {
      const res = await fetch("/api/admin/bali/takeover", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: selectedConvo.id,
          human_takeover: !selectedConvo.human_takeover,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert("Error: " + (d.error || "takeover failed"));
      }
      fetchConversations();
    } catch (err: any) {
      alert("Error: " + err.message);
    }
    setTogglingTakeover(false);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-4rem)] overflow-hidden">
      {/* ── Conversations list ─── */}
      <div
        className={`border-r flex flex-col shrink-0 ${
          selectedId ? "hidden md:flex md:w-[380px]" : "w-full md:w-[380px]"
        }`}
        style={{ background: "rgba(252,246,237,0.85)", borderColor: "#c4956a" }}
      >
        <div className="p-5 border-b shrink-0" style={{ borderColor: "#c4956a" }}>
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-5 h-5 text-[#c4956a]" />
            <h1 className="text-lg font-bold text-black">Bali Inbox</h1>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, teléfono o mensaje…"
              className="w-full pl-9 pr-3 py-2 border-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
              style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 space-y-3 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 bg-zinc-200/40 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-black">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                {search ? "Sin resultados" : "Aún no hay conversaciones"}
              </p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "rgba(196,149,106,0.3)" }}>
              {filtered.map((c) => {
                const isSelected = selectedId === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`p-4 cursor-pointer transition-all ${
                      isSelected
                        ? "bg-white shadow-sm"
                        : "bg-transparent hover:bg-zinc-50/60"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-sm font-bold text-black truncate flex-1">
                        {c.guest_name || c.guest_phone}
                      </span>
                      <span className="text-[10px] text-black ml-2 shrink-0">
                        {formatTime(c.last_message_at)}
                      </span>
                    </div>
                    {c.guest_name && (
                      <p className="text-[10px] text-black mb-1">{c.guest_phone}</p>
                    )}
                    <p className="text-xs text-black line-clamp-1">
                      {c.last_message_direction === "outbound" ? (
                        <span className="text-black">→ </span>
                      ) : null}
                      {c.last_message_preview || "—"}
                    </p>
                    {c.human_takeover && (
                      <span className="inline-flex items-center gap-1 mt-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-100 text-orange-700">
                        <Pause className="w-2.5 h-2.5" /> BOT EN PAUSA
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Chat view ─── */}
      <div
        className={`flex-1 flex flex-col ${
          !selectedId ? "hidden md:flex" : ""
        }`}
        style={{ background: "rgba(252,246,237,0.7)" }}
      >
        {!selectedConvo ? (
          <div className="flex-1 flex items-center justify-center text-center text-black p-12">
            <div>
              <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-sm">Selecciona una conversación para empezar.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div
              className="px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0"
              style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => setSelectedId(null)}
                  className="md:hidden p-1 hover:bg-[#c4956a]/10 rounded"
                >
                  <ChevronLeft className="w-5 h-5 text-black" />
                </button>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-black truncate">
                    {selectedConvo.guest_name || selectedConvo.guest_phone}
                  </h2>
                  <p className="text-xs text-black">{selectedConvo.guest_phone}</p>
                </div>
              </div>
              <button
                onClick={toggleTakeover}
                disabled={togglingTakeover}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border-2 transition-all shrink-0 disabled:opacity-50"
                style={
                  selectedConvo.human_takeover
                    ? {
                        background: "#22c55e",
                        borderColor: "#22c55e",
                        color: "#fff",
                      }
                    : {
                        background: "rgba(252,246,237,0.6)",
                        borderColor: "#c4956a",
                        color: "#000",
                      }
                }
                title={
                  selectedConvo.human_takeover
                    ? "Liberar al bot para que vuelva a responder"
                    : "Tomar control y silenciar al bot"
                }
              >
                {selectedConvo.human_takeover ? (
                  <>
                    <Play className="w-3.5 h-3.5" /> Reactivar bot
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" /> Tomar control
                  </>
                )}
              </button>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-5 space-y-3"
            >
              {loadingMessages ? (
                <div className="space-y-3 animate-pulse">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 bg-zinc-200/40 rounded-2xl" />
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-sm text-black mt-8">
                  Sin mensajes aún.
                </p>
              ) : (
                messages.map((m) => {
                  const isInbound = m.direction === "inbound";
                  const isHuman = m.sender === "human";
                  const isBot = m.sender === "bot";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${
                        isInbound ? "justify-start" : "justify-end"
                      }`}
                    >
                      <div className="max-w-[75%]">
                        <div
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold mb-1"
                          style={
                            isInbound
                              ? { background: "rgba(0,0,0,0.05)", color: "rgba(0,0,0,0.5)" }
                              : isBot
                              ? { background: "rgba(196,149,106,0.15)", color: "#8a6740" }
                              : { background: "rgba(34,197,94,0.15)", color: "#16a34a" }
                          }
                        >
                          {isInbound ? (
                            <>
                              <User className="w-2.5 h-2.5" /> CLIENTE
                            </>
                          ) : isBot ? (
                            <>
                              <Bot className="w-2.5 h-2.5" /> BOT (ALE)
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-2.5 h-2.5" /> TÚ
                            </>
                          )}
                        </div>
                        <div
                          className="rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words"
                          style={
                            isInbound
                              ? {
                                  background: "#fff",
                                  color: "#000",
                                  borderTopLeftRadius: "4px",
                                  border: "1px solid rgba(196,149,106,0.2)",
                                }
                              : isHuman
                              ? {
                                  background: "linear-gradient(135deg, #22c55e, #16a34a)",
                                  color: "#fff",
                                  borderTopRightRadius: "4px",
                                }
                              : {
                                  background: "#c4956a",
                                  color: "#fff",
                                  borderTopRightRadius: "4px",
                                }
                          }
                        >
                          {m.body}
                        </div>
                        <p
                          className={`text-[10px] text-black mt-1 ${
                            isInbound ? "text-left" : "text-right"
                          }`}
                        >
                          {new Date(m.created_at).toLocaleTimeString("es-ES", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Reply box */}
            <div
              className="border-t p-4 shrink-0"
              style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.85)" }}
            >
              {!selectedConvo.human_takeover && (
                <div className="mb-2 px-3 py-2 rounded-lg text-[11px] flex items-center gap-2 bg-orange-50 text-orange-800 border border-orange-200">
                  <Bot className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    El bot está activo. Si envías un mensaje, el bot quedará pausado
                    automáticamente y tendrás que reactivarlo manualmente.
                  </span>
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Escribe tu mensaje… (Enter para enviar, Shift+Enter para salto de línea)"
                  rows={2}
                  className="flex-1 border-2 rounded-lg px-3 py-2 text-sm text-black resize-none focus:outline-none focus:ring-1 focus:ring-[#c4956a]"
                  style={{
                    borderColor: "#c4956a",
                    background: "rgba(252,246,237,0.6)",
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!replyText.trim() || sending}
                  className="p-3 rounded-lg text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  style={{
                    background:
                      "linear-gradient(135deg, #c4956a 0%, #b8845c 100%)",
                  }}
                  title="Enviar"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
