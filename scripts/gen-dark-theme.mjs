// Generates app/dark-generated.css: every colour written directly in the stylesheets, mapped to its
// dark-theme equivalent under the same selector and media query. Run after changing colours in CSS:
//   node scripts/gen-dark-theme.mjs
// Colours in var(--club-*) are handled by the token values in app/dark-theme.css.
import { readFileSync, writeFileSync } from "node:fs";
import postcss from "postcss";

const SKIP_FILES = new Set(["topbar.css", "glass.css", "glass-select.css", "dark-theme.css", "dark-generated.css", "champion-celebration.css", "draw-wheel.css"]);
// Parts that look the same in both themes, or no longer exist.
const SKIP_SELECTOR = /topbar|champion-|result-a-wins|result-b-wins|medal|\.sidebar|club-top1|club-card|welcome-|mobile-menu|\.logout|app-toast|:root/;
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const PREFIX = ':root[data-theme="dark"]';

function parse(text) {
  if (text[0] === "#") {
    const hex = text.slice(1);
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1 };
  }
  const [r, g, b, a = 1] = text.slice(text.indexOf("(") + 1, -1).split(/[\s,/]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
}

function hsl({ r, g, b }) {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z), min = Math.min(x, y, z), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const h = max === x ? ((y - z) / d + (y < z ? 6 : 0)) : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return { h: h * 60, s: d / (1 - Math.abs(2 * l - 1)), l };
}

const css = (h, s, l, a = 1) => `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${Math.round(a * 1000) / 1000})`;
const vivid = ({ s, l }) => s > 0.6 && l > 0.35 && l < 0.82;

function mapBackground(text) {
  const c = parse(text), { h, s, l } = hsl(c);
  if (!c.a) return text;
  if (l < 0.8 && !(l >= 0.72 && s < 0.5)) return text;
  if (vivid({ s, l })) return text;
  if (c.a < 0.5) return s < 0.3 ? `rgba(255, 255, 255, ${Math.round(c.a * 220) / 1000})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 450) / 1000})`;
  return s > 0.3 ? css(h, Math.min(s, 0.42), 0.17, c.a) : css(42, 0.1, 0.14 + (1 - l) * 0.3, c.a);
}

function mapText(text) {
  const c = parse(text), { h, s, l } = hsl(c);
  if (l >= 0.55 && c.a > 0.5) return text;
  if (l >= 0.55) return css(42, 0.2, 0.72);
  if (s < 0.35) return css(42, 0.2, c.a < 0.95 ? 0.56 + 0.34 * c.a : Math.min(0.95, Math.max(0.68, 1 - l * 0.65)));
  return css(h, Math.min(s, 0.85), Math.max(l + 0.34, 0.72));
}

function mapBorder(text) {
  const c = parse(text), { s, l } = hsl(c);
  if (!c.a) return text;
  if (l < 0.35 || (l >= 0.7 && s < 0.6)) return `rgba(255, 255, 255, ${l < 0.35 ? 0.12 : 0.14})`;
  return text;
}

function mapShadow(text) {
  const c = parse(text), { l } = hsl(c);
  if (l < 0.42) return `rgba(0, 0, 0, ${Math.round(Math.min(c.a * 2.4, 0.5) * 100) / 100})`;
  if (l > 0.88) return `rgba(255, 255, 255, ${Math.round(c.a * 120) / 1000})`;
  return text;
}

const mapperFor = (prop) => {
  if (/^(background|background-color|background-image)$/.test(prop)) return mapBackground;
  if (/^(color|-webkit-text-fill-color|caret-color|fill|stroke)$/.test(prop)) return mapText;
  if (/^(border|outline)/.test(prop)) return mapBorder;
  if (/^(box-shadow|text-shadow)$/.test(prop)) return mapShadow;
  return null;
};

// url(...) can hold colours inside SVG data; only the text around it is mapped.
const mapValue = (value, map) => value.split(/(url\([^)]*\))/).map((part, index) => (index % 2 ? part : part.replace(COLOR, map))).join("");

const hasVividBackground = (rule) => rule.nodes.some((node) => node.type === "decl" && /^background/.test(node.prop) && (/var\(--club-gold-[3-7]00\)/.test(node.value) || (node.value.match(COLOR) ?? []).some((text) => { const c = parse(text); return c.a > 0.6 && vivid(hsl(c)); })));

const layout = readFileSync("app/layout.tsx", "utf8");
const files = [...layout.matchAll(/import "\.\/([\w-]+\.css)";/g)].map((match) => match[1]).filter((file) => !SKIP_FILES.has(file));

const out = postcss.root();
for (const file of files) {
  const source = postcss.parse(readFileSync(`app/${file}`, "utf8"));
  const copy = (container, target) => {
    for (const node of container.nodes ?? []) {
      if (node.type === "atrule" && /keyframes/.test(node.name)) continue;
      if (node.type === "atrule") {
        const inner = postcss.atRule({ name: node.name, params: node.params });
        copy(node, inner);
        if (inner.nodes?.length) target.append(inner);
        continue;
      }
      if (node.type !== "rule") continue;
      const selectors = node.selectors.filter((selector) => !SKIP_SELECTOR.test(selector));
      if (!selectors.length) continue;
      const decls = [];
      const onGold = hasVividBackground(node);
      for (const decl of node.nodes) {
        if (decl.type !== "decl") continue;
        const map = mapperFor(decl.prop);
        if (!map) continue;
        if (map === mapText && onGold) {
          decls.push(postcss.decl({ prop: decl.prop, value: /var\(--club-ink/.test(decl.value) ? "#1a1408" : decl.value, important: decl.important }));
          continue;
        }
        // Unchanged values are kept too: a later "background: transparent" must still beat an earlier colour.
        decls.push(postcss.decl({ prop: decl.prop, value: mapValue(decl.value, map), important: decl.important }));
      }
      if (!decls.length) continue;
      const rule = postcss.rule({ selectors: selectors.map((selector) => `${PREFIX} ${selector}`) });
      decls.forEach((decl) => rule.append(decl));
      target.append(rule);
    }
  };
  copy(source, out);
}
const text = `/* Generated by scripts/gen-dark-theme.mjs. Do not edit: run the script after changing colours. */\n${out.toString()}\n`;
writeFileSync("app/dark-generated.css", text);
console.log(`${files.length} files, ${out.nodes.length} rules, ${Math.round(text.length / 1024)} KB`);
