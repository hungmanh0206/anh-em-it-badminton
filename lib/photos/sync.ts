// Cloudinary -> Supabase synchronisation. Cloudinary is the source of truth: every path below
// re-reads assets from Cloudinary and only writes to Supabase, so nothing here can trigger
// another Cloudinary change (no webhook loops). All operations are idempotent.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getResourceByAssetId, listAllImages, type CloudinaryConfig } from "@/lib/cloudinary";
import { assetFolderOf, resourceToPhotoRow } from "@/lib/photos/assets";
import { markPhotosDeleted, photosDbError, upsertPhotoRows } from "@/lib/photos/repository";

// Rows refreshed this recently are never deactivated by a full sync: Cloudinary's search index
// is eventually consistent, so a brand-new upload may not be searchable for a few seconds.
const RECENT_GRACE_MS = 10 * 60 * 1000;

// Re-reads specific assets and mirrors their current state (used by the webhook and upload registration).
export async function refreshAssets(admin: SupabaseClient, config: CloudinaryConfig, assetIds: string[], extra: Record<string, unknown> = {}) {
  const result = { upserted: 0, deleted: 0 };
  for (const assetId of [...new Set(assetIds)]) {
    const resource = await getResourceByAssetId(config, assetId);
    const row = resource ? resourceToPhotoRow(resource, config.rootFolder) : null;
    if (row) {
      await upsertPhotoRows(admin, [{ ...row, ...extra }]);
      result.upserted++;
    } else {
      // Gone from Cloudinary, not an image, or moved outside the root folder.
      await markPhotosDeleted(admin, [assetId]);
      result.deleted++;
    }
  }
  return result;
}

async function activeAssetIds(admin: SupabaseClient) {
  const rows: { cloudinary_asset_id: string; synced_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("photos")
      .select("cloudinary_asset_id, synced_at")
      .eq("is_deleted", false)
      .order("cloudinary_asset_id")
      .range(from, from + 999);
    if (error) throw photosDbError(error);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

// Full reconciliation: create missing rows, refresh changed ones, deactivate assets deleted on Cloudinary.
export async function runFullSync(admin: SupabaseClient, config: CloudinaryConfig) {
  const resources = await listAllImages(config);
  console.info("Photo sync", { rootFolder: config.rootFolder, accountImages: resources.length });
  const rows = resources.map((resource) => resourceToPhotoRow(resource, config.rootFolder)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const before = await activeAssetIds(admin);
  const known = new Set(before.map((row) => row.cloudinary_asset_id));
  const created = rows.filter((row) => !known.has(row.cloudinary_asset_id)).length;

  await upsertPhotoRows(admin, rows);

  const seen = new Set(rows.map((row) => row.cloudinary_asset_id));
  const cutoff = Date.now() - RECENT_GRACE_MS;
  const missing = before.filter((row) => !seen.has(row.cloudinary_asset_id) && Date.parse(row.synced_at) < cutoff).map((row) => row.cloudinary_asset_id);

  // Safety net: an empty listing while the index still has photos almost always means a wrong
  // root folder or credentials, so nothing is deactivated in that case.
  const skippedDeactivation = rows.length === 0 && before.length > 0;
  if (!skippedDeactivation) await markPhotosDeleted(admin, missing);

  return {
    cloudinaryCount: rows.length,
    created,
    updated: rows.length - created,
    deactivated: skippedDeactivation ? 0 : missing.length,
    skippedDeactivation,
  };
}

// Automatic reconciliation (no admin button): the gallery triggers a sync when the last one is
// older than AUTO_SYNC_INTERVAL_MS. Webhooks stay the primary path; this catches missed events.
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
let lastAutoSyncAttempt = 0;

export async function lastSyncedAt(admin: SupabaseClient) {
  const { data, error } = await admin.from("photos").select("synced_at").order("synced_at", { ascending: false }).limit(1);
  if (error) throw photosDbError(error);
  return data?.[0]?.synced_at ? Date.parse(data[0].synced_at) : null;
}

// "now" = sync before answering (empty index), "background" = sync after the response, null = fresh.
export function autoSyncMode(lastSynced: number | null, now = Date.now()): "now" | "background" | null {
  if (now - lastAutoSyncAttempt < AUTO_SYNC_INTERVAL_MS) return null;
  if (lastSynced !== null && now - lastSynced < AUTO_SYNC_INTERVAL_MS) return null;
  lastAutoSyncAttempt = now;
  return lastSynced === null ? "now" : "background";
}

// Admin-only troubleshooting when the gallery is empty: what Cloudinary actually holds vs the configured root.
export async function diagnoseRoot(config: CloudinaryConfig) {
  try {
    const resources = await listAllImages(config);
    const byFolder = new Map<string, number>();
    resources.forEach((resource) => {
      const folder = String(assetFolderOf(resource) || "").replace(/^\/+|\/+$/g, "") || "(thư mục gốc của tài khoản)";
      byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
    });
    return {
      rootFolder: config.rootFolder || "(toàn bộ tài khoản)",
      accountImages: resources.length,
      matching: resources.filter((resource) => resourceToPhotoRow(resource, config.rootFolder)).length,
      folders: [...byFolder.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, count]) => ({ name, count })),
    };
  } catch (error) {
    return { rootFolder: config.rootFolder, error: error instanceof Error ? error.message : "Không đọc được Cloudinary." };
  }
}

export async function countActivePhotos(admin: SupabaseClient) {
  const { count, error } = await admin.from("photos").select("id", { count: "exact", head: true }).eq("is_deleted", false);
  if (error) throw photosDbError(error);
  return count ?? 0;
}
