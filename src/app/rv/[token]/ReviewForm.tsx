"use client";

import { useState } from "react";
import { Star } from "lucide-react";

// Guest-facing review form (public, no CRM session). Copy is inlined per
// guest language — the dashboard i18n dictionaries are for the CRM UI, and
// this page must render for guests without loading them.

const COPY = {
  es: {
    title: (n: string, r: string) => `${n ? `¡Hola ${n}! ` : ""}¿Qué tal en ${r}?`,
    subtitle: "Tu opinión nos ayuda a mejorar. Solo te llevará un momento.",
    placeholder: "Cuéntanos cómo fue tu visita (opcional)",
    submit: "Enviar reseña",
    sending: "Enviando…",
    thanks: "¡Gracias por tu reseña!",
    google: "¿Nos la dejas también en Google? Nos ayuda muchísimo →",
    googleBtn: "Dejar reseña en Google",
    error: "No se pudo enviar. Inténtalo de nuevo.",
  },
  it: {
    title: (n: string, r: string) => `${n ? `Ciao ${n}! ` : ""}Com'è andata da ${r}?`,
    subtitle: "La tua opinione ci aiuta a migliorare. Ci vuole un attimo.",
    placeholder: "Raccontaci com'è andata (facoltativo)",
    submit: "Invia recensione",
    sending: "Invio…",
    thanks: "Grazie per la tua recensione!",
    google: "Ce la lasci anche su Google? Ci aiuta tantissimo →",
    googleBtn: "Lascia recensione su Google",
    error: "Invio non riuscito. Riprova.",
  },
  en: {
    title: (n: string, r: string) => `${n ? `Hi ${n}! ` : ""}How was ${r}?`,
    subtitle: "Your feedback helps us improve. It only takes a moment.",
    placeholder: "Tell us about your visit (optional)",
    submit: "Send review",
    sending: "Sending…",
    thanks: "Thanks for your review!",
    google: "Would you also leave it on Google? It helps us a lot →",
    googleBtn: "Review us on Google",
    error: "Could not send. Please try again.",
  },
  de: {
    title: (n: string, r: string) => `${n ? `Hallo ${n}! ` : ""}Wie war es bei ${r}?`,
    subtitle: "Dein Feedback hilft uns, besser zu werden. Dauert nur einen Moment.",
    placeholder: "Erzähl uns von deinem Besuch (optional)",
    submit: "Bewertung senden",
    sending: "Senden…",
    thanks: "Danke für deine Bewertung!",
    google: "Magst du sie auch auf Google hinterlassen? Das hilft uns sehr →",
    googleBtn: "Auf Google bewerten",
    error: "Senden fehlgeschlagen. Bitte erneut versuchen.",
  },
} as const;

export function ReviewForm(props: {
  token: string;
  tenantName: string;
  guestName: string;
  lang: keyof typeof COPY;
  reviewUrl: string;
  brandColor: string;
  initialRating: number;
  initialComment: string;
}) {
  const c = COPY[props.lang] || COPY.es;
  const [rating, setRating] = useState(props.initialRating);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(props.initialComment);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
    props.initialRating ? "done" : "idle",
  );

  const submit = async () => {
    if (!rating || state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: props.token, rating, comment }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <div className="text-center">
        <p className="text-4xl">🙏</p>
        <h1 className="mt-3 text-xl font-bold text-black">{c.thanks}</h1>
        {rating >= 4 && props.reviewUrl && (
          <>
            <p className="mt-3 text-sm text-black">{c.google}</p>
            <a
              href={props.reviewUrl}
              className="mt-4 inline-block rounded-xl px-6 py-3 text-sm font-semibold text-white"
              style={{ background: props.brandColor }}
            >
              {c.googleBtn}
            </a>
          </>
        )}
        <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-black">{props.tenantName}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-black text-center">{c.title(props.guestName, props.tenantName)}</h1>
      <p className="mt-2 text-sm text-black text-center">{c.subtitle}</p>
      <div className="mt-6 flex justify-center gap-2" role="radiogroup" aria-label="rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            className="p-1 transition-transform hover:scale-110"
          >
            <Star
              className="w-9 h-9"
              fill={(hover || rating) >= n ? "#f59e0b" : "transparent"}
              stroke={(hover || rating) >= n ? "#f59e0b" : "#c4956a"}
            />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder={c.placeholder}
        className="mt-5 block w-full rounded-xl border-2 px-4 py-3 text-sm text-black focus:outline-none focus:ring-2"
        style={{ borderColor: "#c4956a", background: "rgba(252,246,237,0.6)" }}
      />
      {state === "error" && <p className="mt-2 text-sm font-medium text-red-600">{c.error}</p>}
      <button
        type="button"
        disabled={!rating || state === "sending"}
        onClick={submit}
        className="mt-5 w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-40"
        style={{ background: props.brandColor }}
      >
        {state === "sending" ? c.sending : c.submit}
      </button>
    </div>
  );
}
