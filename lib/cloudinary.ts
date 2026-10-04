// Server-only Cloudinary access (Admin/Search/Upload APIs over fetch). The API secret never
// leaves the server: browsers only receive signed upload parameters and CDN delivery URLs.
import { ApiError } from "@/lib/supabase-admin";
import { signParams } from "@/lib/photos/cloudinary-sign";
import { normalizeRoot } from "@/lib/photos/folders";

export type CloudinaryResource = {
  asset_id: string;
  public_id: string;
  version?: number;
  resource_type?: string;
  type?: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
  created_at?: string;
  folder?: string;
  asset_folder?: string;
  display_name?: string;
};

export type CloudinaryConfig = { cloudName: string; apiKey: string; apiSecret: string; rootFolder: string };

const REQUEST_TIMEOUT_MS = 15000;

export function getCloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret, rootFolder: normalizeRoot(process.env.CLOUDINARY_ROOT_FOLDER ?? process.env.CLOUDINARY_FAMILY_MOMENTS_FOLDER ?? "badminton") };
}

export function requireCloudinaryConfig(): CloudinaryConfig {
  const config = getCloudinaryConfig();
  if (!config) throw new ApiError(503, "Kho ảnh chưa được cấu hình Cloudinary (thiếu CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET).");
  return config;
}

async function cloudinaryFetch(config: CloudinaryConfig, path: string, init: RequestInit & { auth?: "basic" | "none" } = {}) {
  const { auth = "basic", ...rest } = init;
  const headers = new Headers(rest.headers);
  if (auth === "basic") headers.set("Authorization", `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64")}`);
  let response: Response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}${path}`, { ...rest, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ApiError(504, timedOut ? "Cloudinary không phản hồi (timeout). Vui lòng thử lại." : "Không kết nối được Cloudinary.");
  }
  return response;
}

const cloudinaryError = async (response: Response, fallback: string) => {
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return new ApiError(response.status >= 500 ? 502 : response.status, payload?.error?.message ? `Cloudinary: ${payload.error.message}` : fallback);
};

// Fresh asset details by stable asset_id; null when the asset no longer exists.
export async function getResourceByAssetId(config: CloudinaryConfig, assetId: string): Promise<CloudinaryResource | null> {
  const response = await cloudinaryFetch(config, `/resources/${encodeURIComponent(assetId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await cloudinaryError(response, "Không đọc được thông tin ảnh từ Cloudinary.");
  return await response.json() as CloudinaryResource;
}

// Asset details by public_id (fallback for notifications that only carry public ids).
export async function getResourceByPublicId(config: CloudinaryConfig, publicId: string): Promise<CloudinaryResource | null> {
  const response = await cloudinaryFetch(config, `/resources/image/upload/${publicId.split("/").map(encodeURIComponent).join("/")}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await cloudinaryError(response, "Không đọc được thông tin ảnh từ Cloudinary.");
  return await response.json() as CloudinaryResource;
}

// Folder search fields differ between fixed and dynamic folder accounts, so every uploaded image
// is listed and filtered by folder in code (relativeFolder); fine for a club-sized account.
const IMAGE_EXPRESSION = "resource_type:image AND type:upload";

async function searchPage(config: CloudinaryConfig, maxResults: number, nextCursor?: string) {
  const response = await cloudinaryFetch(config, "/resources/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expression: IMAGE_EXPRESSION, max_results: maxResults, sort_by: [{ created_at: "desc" }], ...(nextCursor ? { next_cursor: nextCursor } : {}) }),
  });
  if (!response.ok) throw await cloudinaryError(response, "Không tìm được danh sách ảnh trên Cloudinary.");
  return await response.json() as { total_count: number; resources: CloudinaryResource[]; next_cursor?: string };
}

// Every uploaded image in the account, 500 per request (callers filter by root folder).
export async function listAllImages(config: CloudinaryConfig) {
  const all: CloudinaryResource[] = [];
  let cursor: string | undefined;
  do {
    const page = await searchPage(config, 500, cursor);
    all.push(...page.resources);
    cursor = page.next_cursor;
  } while (cursor);
  return all;
}

// Renames the asset's display name (dynamic-folder accounts). public_id, and so every delivery
// URL, stays the same. Cloudinary is updated first; callers re-read it to refresh the index.
export async function updateDisplayName(config: CloudinaryConfig, assetId: string, displayName: string) {
  const response = await cloudinaryFetch(config, `/resources/${encodeURIComponent(assetId)}`, {
    method: "PUT",
    body: new URLSearchParams({ display_name: displayName }),
  });
  if (response.status === 404) throw new ApiError(404, "Ảnh không còn trên Cloudinary.");
  if (!response.ok) throw await cloudinaryError(response, "Cloudinary không đổi được tên ảnh.");
  return await response.json() as CloudinaryResource;
}

// Deletes an asset (signed Upload API destroy). "not found" counts as already deleted.
export async function destroyImage(config: CloudinaryConfig, publicId: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id: publicId, timestamp, invalidate: "true" };
  const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])), api_key: config.apiKey, signature: signParams(params, config.apiSecret) });
  const response = await cloudinaryFetch(config, "/image/destroy", { method: "POST", body, auth: "none" });
  if (!response.ok) throw await cloudinaryError(response, "Cloudinary không xóa được ảnh.");
  const payload = await response.json() as { result?: string };
  if (payload.result !== "ok" && payload.result !== "not found") throw new ApiError(502, `Cloudinary không xóa được ảnh (${payload.result ?? "không rõ lỗi"}).`);
  return payload.result;
}
