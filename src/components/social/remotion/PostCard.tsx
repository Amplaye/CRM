"use client";

// 1080×1080 single-image feed post: one dish photo, its name + price, the
// restaurant name and brand accent. Pure Remotion — no timers, static frame —
// so it renders identically in the <Player> preview and in renderMediaOnWeb.

import { AbsoluteFill, Img } from "remotion";
import type { SocialCompositionProps } from "./types";

export function PostCard({ restaurantName, brandColor, logoUrl, slides }: SocialCompositionProps) {
  const dish = slides[0] || { name: "" };
  const accent = brandColor || "#c4956a";
  return (
    <AbsoluteFill style={{ backgroundColor: "#0f0f0f", fontFamily: "Georgia, serif" }}>
      {dish.photoUrl ? (
        <Img
          src={dish.photoUrl}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <AbsoluteFill style={{ background: `linear-gradient(135deg, ${accent}, #1a1a1a)` }} />
      )}
      {/* Bottom scrim so text stays legible over any photo. */}
      <AbsoluteFill
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 45%, rgba(0,0,0,0) 70%)",
        }}
      />
      {/* Top brand bar. */}
      <div
        style={{
          position: "absolute",
          top: 48,
          left: 56,
          right: 56,
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        {logoUrl ? (
          <Img src={logoUrl} style={{ width: 84, height: 84, borderRadius: 999, objectFit: "cover" }} />
        ) : null}
        <span style={{ color: "#ffffff", fontSize: 40, fontWeight: 700, letterSpacing: 0.5 }}>
          {restaurantName}
        </span>
      </div>
      {/* Dish name + price. */}
      <div style={{ position: "absolute", left: 56, right: 56, bottom: 72 }}>
        <div style={{ width: 96, height: 6, backgroundColor: accent, borderRadius: 3, marginBottom: 28 }} />
        <div style={{ color: "#ffffff", fontSize: 84, fontWeight: 700, lineHeight: 1.05 }}>{dish.name}</div>
        {dish.price ? (
          <div style={{ color: accent, fontSize: 56, fontWeight: 700, marginTop: 16 }}>{dish.price}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
