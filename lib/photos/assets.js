import { relativeFolder } from "./folders.js";

// Image formats the gallery accepts (uploads are also restricted to these via allowed_formats).
export const PHOTO_FORMATS = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif"];
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024; // Cloudinary free-plan image upload limit

// The folder an asset lives in: `asset_folder` in dynamic-folder accounts, `folder` (public_id prefix) otherwise.
export const assetFolderOf = (resource) => resource?.asset_folder ?? resource?.folder ?? (String(resource?.public_id ?? "").includes("/") ? String(resource.public_id).split("/").slice(0, -1).join("/") : "");

// Maps a Cloudinary resource (Admin/Search API or upload response) to a `photos` row.
// Returns null when the asset is not an image inside the configured root folder.
export function resourceToPhotoRow(resource, root) {
  if (!resource || !resource.asset_id || !resource.public_id) return null;
  if (resource.resource_type && resource.resource_type !== "image") return null;
  if (resource.type && resource.type !== "upload") return null;
  const folder = relativeFolder(assetFolderOf(resource), root);
  if (folder === null) return null;
  const toInt = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : null);
  return {
    cloudinary_asset_id: String(resource.asset_id),
    public_id: String(resource.public_id),
    version: toInt(resource.version),
    folder,
    format: resource.format ? String(resource.format).toLowerCase() : null,
    width: toInt(resource.width),
    height: toInt(resource.height),
    bytes: toInt(resource.bytes),
    display_name: resource.display_name ? String(resource.display_name) : String(resource.public_id).split("/").pop(),
    taken_at: resource.created_at ? new Date(resource.created_at).toISOString() : new Date().toISOString(),
    is_deleted: false,
    deleted_at: null,
  };
}

const encodePublicId = (publicId) => String(publicId).split("/").map(encodeURIComponent).join("/");

// CDN delivery URLs built from the public_id: a cropped thumbnail for the grid and a
// size-limited image for the lightbox. Browsers load these straight from Cloudinary.
export function deliveryUrls(cloudName, { public_id: publicId, version }) {
  const base = `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload`;
  const path = `${version ? `v${version}/` : ""}${encodePublicId(publicId)}`;
  return {
    thumbUrl: `${base}/c_fill,g_auto,w_480,h_480,q_auto,f_auto/${path}`,
    fullUrl: `${base}/c_limit,w_1920,h_1920,q_auto,f_auto/${path}`,
    mediumUrl: `${base}/c_limit,w_1080,h_1080,q_auto,f_auto/${path}`,
  };
}
