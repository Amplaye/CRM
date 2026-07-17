"use client";

// Carousel — renders ONE slide of the carousel (each slide is a separate 1080×1080
// image published as a carousel item). The composer renders this composition once
// per slide with a different `index` and uploads each frame. Reusing PostCard's
// look keeps the set visually consistent.

import { AbsoluteFill, Img } from "remotion";
import type { SocialCompositionProps } from "./types";

interface CarouselSlideProps extends SocialCompositionProps {
  index: number;
}

export function CarouselSlide({ restaurantName, brandColor, logoUrl, slides, index }: CarouselSlideProps) {
  const dish = slides[index] || slides[0] || { name: "" };
  const accent = brandColor || "#c4956a";
  const total = slides.length || 1;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0f0f0f", fontFamily: "Georgia, serif", fontStretch: "normal" }}>
      {dish.photoUrl ? (
        <Img
          src={dish.photoUrl}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <AbsoluteFill style={{ background: `linear-gradient(135deg, ${accent}, #1a1a1a)` }} />
      )}
      <AbsoluteFill
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0) 70%)" }}
      />
      {/* Slide counter dots. */}
      <div style={{ position: "absolute", top: 48, right: 56, display: "flex", gap: 12 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 16,
              height: 16,
              borderRadius: 999,
              backgroundColor: i === index ? accent : "rgba(255,255,255,0.5)",
            }}
          />
        ))}
      </div>
      <div style={{ position: "absolute", top: 48, left: 56, color: "#fff", fontSize: 36, fontWeight: 700 }}>
        {restaurantName}
      </div>
      <div style={{ position: "absolute", left: 56, right: 56, bottom: 72 }}>
        <div style={{ width: 96, height: 6, backgroundColor: accent, borderRadius: 3, marginBottom: 28 }} />
        <div style={{ color: "#fff", fontSize: 80, fontWeight: 700, lineHeight: 1.05 }}>{dish.name}</div>
        {dish.price ? (
          <div style={{ color: accent, fontSize: 52, fontWeight: 700, marginTop: 16 }}>{dish.price}</div>
        ) : null}
      </div>
      {logoUrl ? (
        <Img
          src={logoUrl}
          style={{ position: "absolute", bottom: 72, right: 56, width: 96, height: 96, borderRadius: 999, objectFit: "cover" }}
        />
      ) : null}
    </AbsoluteFill>
  );
}
