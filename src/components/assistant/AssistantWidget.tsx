"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X, Send, ArrowRight, RotateCcw } from "lucide-react";
import { useLanguage } from "@/lib/contexts/LanguageContext";
import { answerQuery } from "@/lib/assistant/engine";
import {
  UI,
  topicById,
  SUGGESTED_TOPIC_IDS,
  type AssistantLang,
  type KbTopic,
} from "@/lib/assistant/kb";
import { safeSession } from "@/lib/safe-storage";

// The floating in-app helper. Fully local (see src/lib/assistant): every reply
// comes from the built-in knowledge base — free forever, works offline, and
// nothing typed here ever leaves the browser.

type ChatMessage =
  | { role: "user"; text: string }
  | { role: "bot"; text?: string; topicId?: string; relatedIds?: string[]; suggest?: boolean };

const STORE_KEY = "crm_assistant_chat_v1";
const MAX_MESSAGES = 60;

function loadChat(): ChatMessage[] {
  try {
    const raw = safeSession.get(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export function AssistantWidget() {
  const { language } = useLanguage();
  const lang = language as AssistantLang;
  const ui = UI[lang] || UI.en;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadChat());
  }, []);

  useEffect(() => {
    safeSession.set(STORE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  }, [messages]);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, messages]);

  const suggestions = useMemo(
    () => SUGGESTED_TOPIC_IDS.map(topicById).filter(Boolean) as KbTopic[],
    [],
  );

  const push = (...msgs: ChatMessage[]) =>
    setMessages((prev) => [...prev, ...msgs].slice(-MAX_MESSAGES));

  const ask = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const reply = answerQuery(text, lang);
    if (reply.kind === "topic" && reply.topic) {
      push(
        { role: "user", text },
        { role: "bot", topicId: reply.topic.id, relatedIds: reply.related.map((r) => r.id) },
      );
    } else {
      push(
        { role: "user", text },
        { role: "bot", text: reply.text, suggest: reply.kind === "fallback" },
      );
    }
    setInput("");
  };

  const askTopic = (topic: KbTopic) => {
    push(
      { role: "user", text: topic.title[lang] },
      { role: "bot", topicId: topic.id, relatedIds: topic.related || [] },
    );
  };

  const chip = (topic: KbTopic, key: string) => (
    <button
      key={key}
      onClick={() => askTopic(topic)}
      className="px-2.5 h-8 rounded-full border-2 text-xs font-bold text-black cursor-pointer hover:bg-[#c4956a]/10 max-w-full truncate"
      style={{ borderColor: "#c4956a", background: "rgba(255,255,255,0.7)" }}
    >
      {topic.title[lang]}
    </button>
  );

  const topicBubble = (topic: KbTopic, relatedIds: string[] | undefined, key: number) => {
    const related = (relatedIds || []).map(topicById).filter(Boolean) as KbTopic[];
    return (
      <div key={key} className="max-w-[92%] rounded-2xl rounded-bl-md border-2 p-3 space-y-2" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.9)" }}>
        <p className="text-sm font-bold text-black">{topic.title[lang]}</p>
        <p className="text-sm text-black whitespace-pre-line">{topic.answer[lang]}</p>
        {topic.steps?.[lang] && (
          <ol className="text-sm text-black list-decimal pl-5 space-y-0.5">
            {topic.steps[lang].map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
        {(topic.links || []).map((l, i) => (
          <button
            key={i}
            onClick={() => {
              setOpen(false);
              router.push(l.href);
            }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-bold text-white cursor-pointer mr-1.5"
            style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
          >
            {l.label[lang]} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ))}
        {related.length > 0 && (
          <div className="pt-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-black mb-1">{ui.relatedLabel}</p>
            <div className="flex flex-wrap gap-1.5">{related.map((r) => chip(r, `${key}-${r.id}`))}</div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={ui.openLabel}
          title={ui.title}
          className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full flex items-center justify-center text-white cursor-pointer shadow-lg transition-transform hover:scale-105"
          style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
        >
          <Sparkles className="w-6 h-6" />
        </button>
      )}

      {/* panel */}
      {open && (
        <div
          className="fixed z-40 bottom-4 right-4 left-4 sm:left-auto sm:w-[400px] max-h-[80dvh] flex flex-col rounded-2xl border-2 shadow-2xl overflow-hidden"
          style={{ borderColor: "#c4956a", background: "#FCF6ED" }}
        >
          <div className="flex items-center gap-2.5 px-4 py-3 text-white" style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}>
            <Sparkles className="w-5 h-5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-bold leading-tight">{ui.title}</p>
              <p className="text-xs opacity-90 leading-tight truncate">{ui.subtitle}</p>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="p-1.5 rounded-lg hover:bg-white/15 cursor-pointer"
                title={ui.clear}
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/15 cursor-pointer" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-[280px]">
            {/* welcome + suggestions */}
            <div className="max-w-[92%] rounded-2xl rounded-bl-md border-2 p-3 space-y-2" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.9)" }}>
              <p className="text-sm text-black">{ui.welcome}</p>
              <div className="flex flex-wrap gap-1.5">{suggestions.map((s) => chip(s, `w-${s.id}`))}</div>
            </div>

            {messages.map((m, idx) => {
              if (m.role === "user") {
                return (
                  <div key={idx} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm font-medium text-white" style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}>
                      {m.text}
                    </div>
                  </div>
                );
              }
              const topic = m.topicId ? topicById(m.topicId) : undefined;
              if (topic) return topicBubble(topic, m.relatedIds, idx);
              return (
                <div key={idx} className="max-w-[92%] rounded-2xl rounded-bl-md border-2 p-3 space-y-2" style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.9)" }}>
                  <p className="text-sm text-black whitespace-pre-line">{m.text}</p>
                  {m.suggest && (
                    <div className="flex flex-wrap gap-1.5">{suggestions.map((s) => chip(s, `${idx}-${s.id}`))}</div>
                  )}
                </div>
              );
            })}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2 p-3 border-t-2"
            style={{ borderColor: "#c4956a" }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ui.placeholder}
              className="flex-1 h-11 px-3 rounded-xl border-2 text-sm text-black bg-white"
              style={{ borderColor: "#c4956a" }}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-white disabled:opacity-40 cursor-pointer shrink-0"
              style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)" }}
              aria-label="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
