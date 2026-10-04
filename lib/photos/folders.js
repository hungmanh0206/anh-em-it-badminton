// Folder helpers for the photo gallery. Folders are stored relative to the configured
// Cloudinary root folder (e.g. root "badminton": "badminton/2026/week-01" -> "2026/week-01").

const trimSlashes = (value) => String(value ?? "").replace(/^\/+|\/+$/g, "");

export const normalizeRoot = (root) => trimSlashes(root);

// Returns the folder relative to root, or null when the asset is outside the root.
export function relativeFolder(assetFolder, root) {
  const folder = trimSlashes(assetFolder);
  const base = normalizeRoot(root);
  if (!base) return folder;
  if (folder === base) return "";
  if (folder.startsWith(`${base}/`)) return folder.slice(base.length + 1);
  return null;
}

// Folder names created from the app: lowercase letters, digits, "-" and "_" per segment, up to 4 levels.
export function sanitizeFolderInput(input) {
  const segments = trimSlashes(input).split("/").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length > 4) return null;
  for (const segment of segments) {
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(segment)) return null;
  }
  return segments.join("/");
}

export const fullFolderPath = (root, relative) => [normalizeRoot(root), trimSlashes(relative)].filter(Boolean).join("/");

const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

function segmentLabel(segment) {
  const week = /^(?:week|tuan)[-_ ]?0*(\d+)$/i.exec(segment);
  if (week) return `Tuần ${week[1]}`;
  const tournament = /^(?:tournament|giai(?:-?dau)?)[-_ ]?0*(\d+)?$/i.exec(segment);
  if (tournament) return tournament[1] ? `Giải đấu ${tournament[1]}` : "Giải đấu";
  const month = /^(?:month|thang)[-_ ]?0*(\d{1,2})$/i.exec(segment);
  if (month) return `Tháng ${month[1]}`;
  if (/^members?$/i.test(segment)) return "Thành viên";
  if (/^banners?$/i.test(segment)) return "Banner";
  if (/^events?$/i.test(segment)) return "Sự kiện";
  return capitalize(segment.replace(/[-_]+/g, " "));
}

// Human label for a relative folder, e.g. "2026/week-01" -> "Tuần 1 · 2026", "" -> "Chung".
export function folderLabel(folder) {
  const segments = trimSlashes(folder).split("/").filter(Boolean);
  if (!segments.length) return "Chung";
  const year = segments.find((segment) => /^\d{4}$/.test(segment));
  const named = segments.filter((segment) => segment !== year);
  const label = named.length ? named.map(segmentLabel).join(" / ") : year;
  return year && named.length ? `${label} · ${year}` : label;
}
