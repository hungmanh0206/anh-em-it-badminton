import { after } from "next/server";
import { getCloudinaryConfig, requireCloudinaryConfig } from "@/lib/cloudinary";
import { decodeCursor, encodeCursor } from "@/lib/photos/assets";
import { folderLabel } from "@/lib/photos/folders";
import { PHOTO_COLUMNS, photosDbError, toApiPhoto, type PhotoRow } from "@/lib/photos/repository";
import { autoSyncMode, lastSyncedAt, refreshAssets, runFullSync } from "@/lib/photos/sync";
import { ApiError, jsonError, requireAdmin, requireUser } from "@/lib/supabase-admin";

// The first gallery load may run a full Cloudinary sync inline (empty index).
export const maxDuration = 60;

const PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;

// GET /api/photos?folder=<relative folder>&cursor=<opaque>&limit=<n>
// Newest first with keyset pagination; the first page also returns categories and the total.
export async function GET(request: Request) {
  try {
    const { admin, profile } = await requireUser(request);
    const config = getCloudinaryConfig();
    if (!config) throw new ApiError(503, "Kho ảnh chưa được cấu hình Cloudinary.");

    const url = new URL(request.url);
    const folder = url.searchParams.get("folder");
    const cursorParam = url.searchParams.get("cursor");
    const cursor = decodeCursor(cursorParam);
    if (cursorParam && !cursor) throw new ApiError(400, "Trang ảnh không hợp lệ, vui lòng tải lại.");
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get("limit")) || PAGE_SIZE));

    let query = admin.from("photos").select(PHOTO_COLUMNS).eq("is_deleted", false);
    if (folder !== null) query = query.eq("folder", folder);
    // Values are quoted so the timestamp's ":" "." "+" are not parsed as filter syntax.
    if (cursor) query = query.or(`taken_at.lt."${cursor.takenAt}",and(taken_at.eq."${cursor.takenAt}",id.lt."${cursor.id}")`);
    const pageQuery = query.order("taken_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);

    const firstPage = !cursor;
    if (firstPage) {
      const mode = autoSyncMode(await lastSyncedAt(admin));
      const sync = () => runFullSync(admin, config).catch((syncError) => console.error("Photo auto-sync failed", syncError instanceof Error ? syncError.message : syncError));
      if (mode === "now") await sync();
      else if (mode === "background") after(sync);
    }
    const [page, folders, total] = await Promise.all([
      pageQuery,
      firstPage ? admin.from("photo_folders").select("folder, photo_count, latest_taken_at").order("latest_taken_at", { ascending: false }) : Promise.resolve(null),
      firstPage
        ? (() => {
          let countQuery = admin.from("photos").select("id", { count: "exact", head: true }).eq("is_deleted", false);
          if (folder !== null) countQuery = countQuery.eq("folder", folder);
          return countQuery;
        })()
        : Promise.resolve(null),
    ]);
    if (page.error) throw photosDbError(page.error);
    if (folders?.error) throw photosDbError(folders.error);
    if (total?.error) throw photosDbError(total.error);

    const rows = (page.data || []) as PhotoRow[];
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    const last = visible.at(-1);

    return Response.json({
      photos: visible.map((row) => toApiPhoto(config.cloudName, row)),
      nextCursor: hasMore && last ? encodeCursor(last.taken_at, last.id) : null,
      ...(firstPage ? {
        total: total?.count ?? 0,
        folders: ((folders?.data || []) as { folder: string; photo_count: number }[]).map((row) => ({ folder: row.folder, label: folderLabel(row.folder), count: row.photo_count })),
        canManage: profile.role === "admin",
      } : {}),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

// POST /api/photos { assetId } — called by the app right after a successful browser upload.
// The asset is re-read from Cloudinary (never trusting client data) and indexed with its uploader.
export async function POST(request: Request) {
  try {
    const { admin, user } = await requireAdmin(request);
    const config = requireCloudinaryConfig();
    const body = await request.json().catch(() => ({})) as { assetId?: unknown };
    const assetId = typeof body.assetId === "string" ? body.assetId.trim() : "";
    if (!/^[0-9a-f]{32}$/i.test(assetId)) throw new ApiError(400, "Mã ảnh Cloudinary không hợp lệ.");

    const result = await refreshAssets(admin, config, [assetId], { uploaded_by: user.id });
    if (!result.upserted) throw new ApiError(422, "Ảnh không tồn tại trên Cloudinary hoặc nằm ngoài thư mục kho ảnh.");

    const { data, error } = await admin.from("photos").select(PHOTO_COLUMNS).eq("cloudinary_asset_id", assetId).single();
    if (error) throw photosDbError(error);
    return Response.json({ photo: toApiPhoto(config.cloudName, data as PhotoRow) });
  } catch (error) {
    return jsonError(error);
  }
}
