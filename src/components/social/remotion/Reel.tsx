"use client";

// 1080×1920 reel: a sequence of dishes, each shown for REEL_SECONDS_PER_SLIDE
// with a subtle zoom + a fade-up title. Pure Remotion animation driven by the
// frame clock, so the <Player> preview and renderMediaOnWeb produce the same
// video. Duration = slides.length * REEL_SECONDS_PER_SLIDE * REEL_FPS frames
// (computed by the caller and passed as durationInFrames).

import { AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, spring, useVideoConfig } from "remotion";
import type { SocialCompositionProps } from "./types";
import { REEL_FPS, REEL_SECONDS_PER_SLIDE } from "./types";

function Slide({
  name,
  price,
  photoUrl,
  accent,
  restaurantName,
}: {
  name: string;
  price?: string;
  photoUrl?: string;
  accent: string;
  restaurantName: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const per = REEL_SECONDS_PER_SLIDE * fps;
  // Ken-Burns zoom across the slide's own frame window.
  const scale = interpolate(frame, [0, per], [1.08, 1.16], { extrapolateRight: "clamp" });
  // Title springs up in the first ~0.6s.
  const rise = spring({ frame, fps, config: { damping: 200 }, durationInFrames: Math.round(fps * 0.6) });
  const y = interpolate(rise, [0, 1], [40, 0]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#0f0f0f", fontFamily: "Georgia, serif" }}>
      {photoUrl ? (
        <Img
          src={photoUrl}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }}
        />
      ) : (
        <AbsoluteFill style={{ background: `linear-gradient(135deg, ${accent}, #111)` }} />
      )}
      <AbsoluteFill
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.15) 100%)" }}
      />
      <div style={{ position: "absolute", top: 80, left: 64, color: "#fff", fontSize: 44, fontWeight: 700 }}>
        {restaurantName}
      </div>
      <div style={{ position: "absolute", left: 64, right: 64, bottom: 160, transform: `translateY(${y}px)`, opacity: rise }}>
        <div style={{ width: 110, height: 8, backgroundColor: accent, borderRadius: 4, marginBottom: 32 }} />
        <div style={{ color: "#fff", fontSize: 104, fontWeight: 700, lineHeight: 1.03 }}>{name}</div>
        {price ? <div style={{ color: accent, fontSize: 64, fontWeight: 700, marginTop: 20 }}>{price}</div> : null}
      </div>
    </AbsoluteFill>
  );
}

export function Reel({ restaurantName, brandColor, slides }: SocialCompositionProps) {
  const accent = brandColor || "#c4956a";
  const per = REEL_SECONDS_PER_SLIDE * REEL_FPS;
  const list = slides.length ? slides : [{ name: restaurantName }];
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {list.map((s, i) => (
        <Sequence key={i} from={i * per} durationInFrames={per}>
          <Slide name={s.name} price={s.price} photoUrl={s.photoUrl} accent={accent} restaurantName={restaurantName} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
