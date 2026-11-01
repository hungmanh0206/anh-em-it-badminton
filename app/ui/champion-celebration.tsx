"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

// Main colour and the second one used for the inner shell of a burst, per theme. Dark adds light on
// a dark sky; light paints deep colours, since adding light on a pale page would make them vanish.
const THEMES = {
  dark: {
    palettes: [["#ffc83d", "#fff3c4"], ["#ff4d6d", "#ffd1d8"], ["#34d399", "#d1fae5"], ["#4f9dff", "#dbeafe"], ["#f472b6", "#fce7f3"], ["#b57bff", "#f3e8ff"], ["#22d3ee", "#cffafe"]],
    gold: ["#ffc83d", "#ffe9a8"],
    rocket: "#fff6d8",
    blend: "lighter",
  },
  light: {
    palettes: [["#e08a00", "#f5b301"], ["#e11d48", "#fb7185"], ["#059669", "#34d399"], ["#2563eb", "#60a5fa"], ["#db2777", "#f472b6"], ["#7c3aed", "#a78bfa"], ["#0891b2", "#22d3ee"]],
    gold: ["#d97706", "#f59e0b"],
    rocket: "#b45309",
    blend: "source-over",
  },
} as const;
const FRAME_MS = 1000 / 60;
const ROCKET_GRAVITY = 0.12;
const MAX_SPARKS = 2600;

type Rocket = { x: number; y: number; px: number; py: number; vx: number; vy: number; palette: readonly string[] };
type Spark = { x: number; y: number; px: number; py: number; vx: number; vy: number; life: number; fade: number; drag: number; gravity: number; color: string; width: number };
type Flash = { x: number; y: number; life: number; color: string };

const between = (min: number, max: number) => min + Math.random() * (max - min);

// Rockets climb from the bottom edge and burst into peonies, rings and gold willows, each spark
// drawn as a streak on a slowly fading canvas. Speeds are per 60fps frame, scaled by the real frame time.
function Fireworks() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const theme = THEMES[document.documentElement.dataset.theme === "dark" ? "dark" : "light"];
    const PALETTES = theme.palettes;
    const GOLD = theme.gold;
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

    const rockets: Rocket[] = [];
    const sparks: Spark[] = [];
    const flashes: Flash[] = [];
    const launch = () => {
      const x = width * between(0.1, 0.9);
      const y = height + 8;
      const climb = y - height * between(0.1, 0.46);
      rockets.push({ x, y, px: x, py: y, vx: between(-0.7, 0.7), vy: -Math.sqrt(2 * ROCKET_GRAVITY * climb), palette: PALETTES[Math.floor(Math.random() * PALETTES.length)] });
    };
    const addSpark = (x: number, y: number, angle: number, speed: number, color: string, options: Partial<Spark> = {}) => {
      if (sparks.length < MAX_SPARKS) sparks.push({ x, y, px: x, py: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, fade: between(0.012, 0.02), drag: 0.965, gravity: 0.035, color, width: 2, ...options });
    };
    const explode = (x: number, y: number, palette: readonly string[]) => {
      const reach = Math.max(4.2, Math.min(7.5, Math.min(width, height) / 110));
      const kind = Math.random();
      if (kind < 0.3) {
        // Gold willow: long drooping strands.
        for (let index = 0; index < 110; index += 1) addSpark(x, y, between(0, Math.PI * 2), reach * between(0.25, 0.8), GOLD[index % 2], { fade: between(0.006, 0.0095), drag: 0.975, gravity: 0.05, width: 1.6 });
        flashes.push({ x, y, life: 1, color: GOLD[0] });
        return;
      }
      if (kind < 0.6) {
        // Clean ring around a small pale core.
        for (let index = 0; index < 64; index += 1) addSpark(x, y, (index / 64) * Math.PI * 2, reach * 0.95, palette[0], { fade: 0.015 });
        for (let index = 0; index < 30; index += 1) addSpark(x, y, between(0, Math.PI * 2), reach * between(0.1, 0.42), palette[1], { fade: 0.022 });
      } else {
        // Peony: a full sphere with an inner shell of the paler colour.
        for (let index = 0; index < 96; index += 1) addSpark(x, y, between(0, Math.PI * 2), reach * Math.sqrt(between(0.2, 1)), palette[0]);
        for (let index = 0; index < 44; index += 1) addSpark(x, y, between(0, Math.PI * 2), reach * between(0.15, 0.5), palette[1], { fade: 0.024 });
      }
      flashes.push({ x, y, life: 1, color: palette[0] });
    };

    let last = performance.now();
    let nextLaunch = last;
    let frame = requestAnimationFrame(function draw(now) {
      const step = Math.min((now - last) / FRAME_MS, 3);
      last = now;
      if (now >= nextLaunch) {
        const volley = rockets.length === 0 && sparks.length === 0 ? 3 : Math.random() < 0.3 ? 2 : 1;
        for (let index = 0; index < volley; index += 1) launch();
        nextLaunch = now + between(380, 720);
      }

      // Fades what was drawn before, which is what leaves the trails.
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(0, 0, 0, ${1 - 0.8 ** step})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = theme.blend;
      ctx.lineCap = "round";

      for (let index = rockets.length - 1; index >= 0; index -= 1) {
        const rocket = rockets[index];
        rocket.px = rocket.x;
        rocket.py = rocket.y;
        rocket.x += rocket.vx * step;
        rocket.y += rocket.vy * step;
        rocket.vy += ROCKET_GRAVITY * step;
        addSpark(rocket.x, rocket.y, between(0, Math.PI * 2), between(0.1, 0.5), GOLD[1], { fade: 0.06, width: 1.2 });
        ctx.globalAlpha = 1;
        ctx.strokeStyle = theme.rocket;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(rocket.px, rocket.py);
        ctx.lineTo(rocket.x, rocket.y);
        ctx.stroke();
        if (rocket.vy >= -0.5) {
          explode(rocket.x, rocket.y, rocket.palette);
          rockets.splice(index, 1);
        }
      }

      for (let index = flashes.length - 1; index >= 0; index -= 1) {
        const flash = flashes[index];
        const radius = 110;
        const glow = ctx.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, radius);
        glow.addColorStop(0, flash.color);
        glow.addColorStop(1, `${flash.color}00`);
        ctx.globalAlpha = flash.life * 0.3;
        ctx.fillStyle = glow;
        ctx.fillRect(flash.x - radius, flash.y - radius, radius * 2, radius * 2);
        flash.life -= 0.14 * step;
        if (flash.life <= 0) flashes.splice(index, 1);
      }

      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index];
        spark.px = spark.x;
        spark.py = spark.y;
        spark.x += spark.vx * step;
        spark.y += spark.vy * step;
        const drag = spark.drag ** step;
        spark.vx *= drag;
        spark.vy = spark.vy * drag + spark.gravity * step;
        spark.life -= spark.fade * step;
        if (spark.life <= 0) {
          sparks.splice(index, 1);
          continue;
        }
        // Sparks glitter as they die out.
        ctx.globalAlpha = spark.life < 0.35 ? spark.life * between(0.6, 2.4) : spark.life;
        ctx.strokeStyle = spark.color;
        ctx.lineWidth = spark.width;
        ctx.beginPath();
        ctx.moveTo(spark.px, spark.py);
        ctx.lineTo(spark.x, spark.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={canvasRef} className="champion-fireworks" aria-hidden="true" />;
}

// Centre-screen congratulations for the month's champion; a tap anywhere or Esc closes it.
export function ChampionCelebration({ avatar, crown, crownOrigin, name, onClose }: { avatar: ReactNode; crown: ReactNode; crownOrigin: DOMRect | null; name: string; onClose: () => void }) {
  const avatarRef = useRef<HTMLDivElement>(null);
  // The crown starts over the one on the champion's card, then grows and lands on the head.
  useLayoutEffect(() => {
    const wrapper = avatarRef.current;
    const icon = wrapper?.querySelector<HTMLElement>(".app-icon");
    if (!wrapper || !icon || !crownOrigin) return;
    const box = wrapper.getBoundingClientRect();
    const dx = crownOrigin.left + crownOrigin.width / 2 - (box.left + icon.offsetLeft);
    const dy = crownOrigin.top + crownOrigin.height / 2 - (box.top + icon.offsetTop + icon.offsetHeight / 2);
    wrapper.style.setProperty("--crown-dx", `${dx}px`);
    wrapper.style.setProperty("--crown-dy", `${dy}px`);
    wrapper.style.setProperty("--crown-scale", String(crownOrigin.width / icon.offsetWidth));
  }, [crownOrigin]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="champion-celebration" role="dialog" aria-modal="true" aria-label={`Chúc mừng nhà vô địch ${name}`} onClick={onClose}>
    <Fireworks />
    <button type="button" className="champion-close" aria-label="Đóng" onClick={onClose}>×</button>
    <div className="champion-stage">
      <div ref={avatarRef} className="champion-avatar">{crown}{avatar}</div>
      <p>Chúc mừng nhà vô địch</p>
      <h2>{name}</h2>
    </div>
  </div>;
}
