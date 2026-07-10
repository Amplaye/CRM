"use client";

import { createContext, useContext, type CSSProperties, type ElementType, type ReactNode } from "react";

// Inline-editing primitives for the site templates. A template renders ONLY
// through <EditableText>/<EditableImage>, so the same component serves both
// the public page (editMode=false → plain markup, zero client behaviour) and
// the visual editor (editMode=true → click-to-edit in place). The content map
// is defaults ⊕ owner overrides, merged by the caller before providing.

type SiteContentCtx = {
  content: Record<string, string>;
  editMode: boolean;
  onEditText?: (id: string, value: string) => void;
  onEditImage?: (id: string) => void;
};

const Ctx = createContext<SiteContentCtx>({ content: {}, editMode: false });

export function SiteContentProvider({ value, children }: { value: SiteContentCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSiteContent(): SiteContentCtx {
  return useContext(Ctx);
}

/** Visual hint that a block is editable, without shifting layout. */
const EDIT_OUTLINE: CSSProperties = {
  outline: "1.5px dashed rgba(59,130,246,0.75)",
  outlineOffset: "3px",
  cursor: "text",
  borderRadius: "2px",
};
const EDIT_IMG_OUTLINE: CSSProperties = {
  outline: "2px dashed rgba(59,130,246,0.9)",
  outlineOffset: "-2px",
  cursor: "pointer",
};

export function EditableText({
  id,
  as: Tag = "span",
  className,
  style,
  fallback = "",
}: {
  id: string;
  /** Rendered element — h1/h2/p/span/blockquote… so templates keep semantics. */
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  /** Dynamic default (e.g. the tenant name) when the block has no content. */
  fallback?: string;
}) {
  const { content, editMode, onEditText } = useContext(Ctx);
  const value = content[id] ?? fallback;

  // Empty & public → render nothing (optional blocks vanish cleanly).
  if (!value && !editMode) return null;

  if (!editMode) {
    return (
      <Tag className={className} style={style}>
        {value}
      </Tag>
    );
  }

  // contentEditable is uncontrolled while typing (state commits on blur), so
  // the caret never jumps; empty blocks show a … placeholder to stay clickable.
  return (
    <Tag
      className={className}
      style={{ ...style, ...EDIT_OUTLINE, whiteSpace: "pre-wrap" }}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-block-id={id}
      onBlur={(e: React.FocusEvent<HTMLElement>) => {
        const next = (e.currentTarget.innerText || "").replace(/ /g, " ").trimEnd();
        if (next !== value) onEditText?.(id, next);
      }}
    >
      {value || "…"}
    </Tag>
  );
}

export function EditableImage({
  id,
  className,
  style,
  alt = "",
  fallback = "",
}: {
  id: string;
  className?: string;
  style?: CSSProperties;
  alt?: string;
  fallback?: string;
}) {
  const { content, editMode, onEditImage } = useContext(Ctx);
  const src = content[id] ?? fallback;

  if (!src && !editMode) return null;

  if (!editMode) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={className} style={style} loading="lazy" />;
  }

  // The img itself is the click target (no wrapper → no layout change).
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='400' height='300' fill='%23ddd'/%3E%3C/svg%3E"}
      alt={alt}
      className={className}
      style={{ ...style, ...EDIT_IMG_OUTLINE }}
      data-block-id={id}
      title="Clicca per cambiare l'immagine"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onEditImage?.(id);
      }}
    />
  );
}

/** Plain accessor for places where a template needs the raw string (e.g. an
 * aria-label or a CSS background) instead of a rendered element. */
export function useBlockValue(id: string, fallback = ""): string {
  const { content } = useContext(Ctx);
  return content[id] ?? fallback;
}

/** Marquee / carousel text. Public mode renders `children` (the template's own
 * animated ribbon). Edit mode swaps in a static, click-to-edit single line of
 * the raw "·"-separated source so owners can change the scrolling words in the
 * visual editor — the animation would make an inline caret unusable, so we edit
 * the source string, not the moving copy. Items stay separated by " · ". */
export function EditableMarquee({
  id,
  fallback = "",
  bandStyle,
  children,
}: {
  id: string;
  fallback?: string;
  /** Applied to the edit-mode band so it reads like the real ribbon. */
  bandStyle?: CSSProperties;
  children: ReactNode;
}) {
  const { content, editMode, onEditText } = useContext(Ctx);
  const value = content[id] ?? fallback;

  if (!editMode) return <>{children}</>;

  return (
    <div className="w-full overflow-hidden py-2.5" style={bandStyle} title="Testo del carosello — separa le voci con ·">
      <div
        className="mx-auto max-w-4xl px-5 text-center text-xs font-semibold uppercase tracking-[0.2em]"
        style={{ ...EDIT_OUTLINE, whiteSpace: "pre-wrap" }}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-block-id={id}
        onBlur={(e: React.FocusEvent<HTMLElement>) => {
          const next = (e.currentTarget.innerText || "").replace(/ /g, " ").trim();
          if (next !== value) onEditText?.(id, next);
        }}
      >
        {value || "…"}
      </div>
    </div>
  );
}
