"use client";

import { useEffect, useRef } from "react";

export function SandEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Respect the user's reduced-motion preference: skip the animation entirely
    // (no canvas paints, no rAF loop). Owners who set this — and the OS sets it
    // under low-power mode — get a calm, static background instead of jank.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let animationId: number;
    let particles: Array<{
      x: number;
      y: number;
      size: number;
      speedX: number;
      speedY: number;
      opacity: number;
      color: string;
    }> = [];

    // Lighter particle load on phones: a full-screen rAF canvas of 100 particles
    // makes the long onboarding form stutter while scrolling on mid/low-end
    // devices. Halve it on small viewports.
    const particleCount = window.innerWidth < 768 ? 40 : 100;

    // Create the sand particles
    const createParticles = () => {
      particles = [];
      for (let i = 0; i < particleCount; i++) {
        const r = 160 + Math.random() * 50;
        const g = 120 + Math.random() * 50;
        const b = 70 + Math.random() * 50;
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: 0.5 + Math.random() * 1.5,
          speedX: 0.3 + Math.random() * 1.2,
          speedY: -0.1 + Math.random() * 0.2,
          opacity: 0.15 + Math.random() * 0.35,
          color: `${r},${g},${b}`,
        });
      }
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Re-seed: resizing (orientation change, mobile keyboard show/hide) clears
      // the canvas geometry, so without this the field would thin out or sit
      // half-empty after the first resize.
      createParticles();
    };
    resize();
    window.addEventListener("resize", resize);

    // Drifting dust doesn't need 60fps: capping at ~30 halves the continuous
    // canvas cost so the decorative layer never competes with real work.
    const FRAME_MS = 33;
    let lastFrame = 0;
    const animate = (ts = 0) => {
      if (ts - lastFrame < FRAME_MS) {
        animationId = requestAnimationFrame(animate);
        return;
      }
      lastFrame = ts;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        // Draw particle as a soft dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${p.opacity})`;
        ctx.fill();

        // Draw a tiny motion trail
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.speedX * 4, p.y - p.speedY * 4);
        ctx.strokeStyle = `rgba(${p.color},${p.opacity * 0.3})`;
        ctx.lineWidth = p.size * 0.5;
        ctx.stroke();

        // Move with wind
        p.x += p.speedX;
        p.y += p.speedY;

        // Add slight wave motion
        p.y += Math.sin(p.x * 0.01) * 0.15;

        // Reset when off screen
        if (p.x > canvas.width + 10) {
          p.x = -10;
          p.y = Math.random() * canvas.height;
        }
        if (p.y < -10 || p.y > canvas.height + 10) {
          p.y = Math.random() * canvas.height;
          p.x = -10;
        }
      }

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
    />
  );
}
