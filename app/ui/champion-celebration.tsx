"use client";

import { type ReactNode, useEffect, useRef } from "react";

const FIREWORK_COLORS = ["#ffd66d", "#ff6b6b", "#5eead4", "#7dd3fc", "#f9a8d4", "#ffffff"];
const SHOW_DURATION_MS = 7000;
const BURST_EVERY_MS = 420;
const SPARKS_PER_BURST = 64;

type Spark = { x: number; y: number; vx: number; vy: number; life: number; fade: number; color: string };

// Bursts of sparks that slow down, fall and fade, leaving short trails.
function Fireworks() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let width = 0;
    let height = 0;
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * scale;
      canvas.height = height * scale;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const sparks: Spark[] = [];
    const burst = () => {
      const x = width * (0.12 + Math.random() * 0.76);
      const y = height * (0.1 + Math.random() * 0.5);
      const color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
      const reach = Math.min(width, height) / 120 + 2;
      for (let index = 0; index < SPARKS_PER_BURST; index += 1) {
        const angle = (index / SPARKS_PER_BURST) * Math.PI * 2;
        const speed = reach * (0.45 + Math.random() * 0.55);
        sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, fade: 0.012 + Math.random() * 0.012, color: Math.random() < 0.8 ? color : "#ffffff" });
      }
    };

    const startedAt = performance.now();
    let lastBurst = 0;
    let frame = requestAnimationFrame(function draw(now) {
      const elapsed = now - startedAt;
      if (elapsed < SHOW_DURATION_MS && now - lastBurst > BURST_EVERY_MS) {
        burst();
        lastBurst = now;
      }
      // Fades what was drawn before, which is what leaves the trails.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index];
        spark.x += spark.vx;
        spark.y += spark.vy;
        spark.vx *= 0.97;
        spark.vy = spark.vy * 0.97 + 0.045;
        spark.life -= spark.fade;
        if (spark.life <= 0) {
          sparks.splice(index, 1);
          continue;
        }
        ctx.globalAlpha = spark.life;
        ctx.fillStyle = spark.color;
        ctx.beginPath();
        ctx.arc(spark.x, spark.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (elapsed < SHOW_DURATION_MS || sparks.length) frame = requestAnimationFrame(draw);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={canvasRef} className="champion-fireworks" aria-hidden="true" />;
}

// Centre-screen congratulations for the month's champion; a tap anywhere or Esc closes it.
export function ChampionCelebration({ avatar, crown, name, onClose }: { avatar: ReactNode; crown: ReactNode; name: string; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="champion-celebration" role="dialog" aria-modal="true" aria-label={`Chúc mừng nhà vô địch ${name}`} onClick={onClose}>
    <Fireworks />
    <button type="button" className="champion-close" aria-label="Đóng" onClick={onClose}>×</button>
    <div className="champion-stage">
      <div className="champion-avatar">{crown}{avatar}</div>
      <p>Chúc mừng nhà vô địch</p>
      <h2>{name}</h2>
    </div>
  </div>;
}
