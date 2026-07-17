"use client";

// Phone mockup for a social post — the Instagram/Facebook equivalent of the
// marketing PhoneMock. Shows the rendered media (or a placeholder), the account
// header and the caption exactly as it will appear in-feed, so the owner sees
// the real thing before approving. Device shell mirrors marketing's PhoneMock.

import { Camera, ThumbsUp, Heart, MessageCircle, Send } from "lucide-react";

export interface SocialPostPreviewProps {
  target: "instagram" | "facebook";
  accountName: string;
  caption: string;
  /** First rendered media URL, or a data/blob URL for live preview. */
  mediaUrl?: string;
  isVideo?: boolean;
  emptyLabel: string;
}

export function SocialPostPreview({ target, accountName, caption, mediaUrl, isVideo, emptyLabel }: SocialPostPreviewProps) {
  const isIg = target === "instagram";
  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className="rounded-[2.2rem] bg-neutral-900 p-2.5 shadow-xl">
        <div className="overflow-hidden rounded-[1.7rem] bg-white">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-white">
              {isIg ? <Camera size={16} /> : <ThumbsUp size={16} />}
            </div>
            <span className="text-sm font-semibold text-black">{accountName || (isIg ? "instagram" : "facebook")}</span>
          </div>
          {/* Media */}
          <div className="flex aspect-square w-full items-center justify-center bg-neutral-100">
            {mediaUrl ? (
              isVideo ? (
                <video src={mediaUrl} className="h-full w-full object-cover" muted playsInline loop autoPlay />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl} alt="" className="h-full w-full object-cover" />
              )
            ) : (
              <span className="px-6 text-center text-sm text-black">{emptyLabel}</span>
            )}
          </div>
          {/* Action row */}
          <div className="flex items-center gap-4 px-3 py-2 text-black">
            <Heart size={18} />
            <MessageCircle size={18} />
            <Send size={18} />
          </div>
          {/* Caption */}
          <div className="px-3 pb-4 text-sm text-black">
            <span className="font-semibold">{accountName}</span>{" "}
            <span className="whitespace-pre-wrap">{caption}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
