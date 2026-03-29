"use client";

import { useEffect, useRef } from "react";

export function SandEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Create 300 sand particles
    const createParticles = () => {
      particles = [];
      for (let i = 0; i < 300; i++) {
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
    createParticles();

    const animate = () => {
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
