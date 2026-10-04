import { after } from "next/server";
import { getCloudinaryConfig, requireCloudinaryConfig } from "@/lib/cloudinary";
import { folderLabel } from "@/lib/photos/folders";
import { PHOTO_COLUMNS, photosDbError, toApiPhoto, type PhotoRow } from "@/lib/photos/repository";
import { autoSyncMode, diagnoseRoot, lastSyncedAt, refreshAssets, runFullSync } from "@/lib/photos/sync";
import { ApiError, jsonError, requireAdmin, requireUser } from "@/lib/supabase-admin";

// The gallery load may run a full Cloudinary sync inline (empty index).
export const maxDuration = 60;

const PHOTO_PAGE_SIZE = 18;

// GET /api/photos?folder=<relative folder>&page=<1-based>&q=<name search>
// Numbered pages of PHOTO_PAGE_SIZE photos, newest first (taken_at, id keeps the order stable).
// Every response carries the total, the page count and the categories for the filter chips.
export async function GET(request: Request) {
  try {
    const { admin, profile } = await requireUser(request);
    const config = getCloudinaryConfig();
    if (!config) throw new ApiError(503, "Kho ảnh chưa được cấu hình Cloudinary.");

    const url = new URL(request.url);
    const folder = url.searchParams.get("folder");
    const requestedPage = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
    // Case-insensitive "contains" match on the display name; LIKE wildcards in the input are literal.
    const search = (url.searchParams.get("q") ?? "").normalize("NFC").trim().slice(0, 100);
    const namePattern = search ? `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null;

    if (requestedPage === 1) {
      const mode = autoSyncMode(await lastSyncedAt(admin));
      const sync = () => runFullSync(admin, config).catch((syncError) => console.error("Photo auto-sync failed", syncError instanceof Error ? syncError.message : syncError));
      if (mode === "now") await sync();
      else if (mode === "background") after(sync);
    }

    let countQuery = admin.from("photos").select("id", { count: "exact", head: true }).eq("is_deleted", false);
    if (folder !== null) countQuery = countQuery.eq("folder", folder);
    if (namePattern) countQuery = countQuery.ilike("display_name", namePattern);
    const [totalResult, folders] = await Promise.all([
      countQuery,
      admin.from("photo_folders").select("folder, photo_count, latest_taken_at").order("latest_taken_at", { ascending: false }),
    ]);
    if (totalResult.error) throw photosDbError(totalResult.error);
    if (folders.error) throw photosDbError(folders.error);

    const total = totalResult.count ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / PHOTO_PAGE_SIZE));
    // Asking past the end (e.g. after deleting the last photo of a page) returns the last page.
    const page = Math.min(requestedPage, pageCount);
    const from = (page - 1) * PHOTO_PAGE_SIZE;

    let pageQuery = admin.from("photos").select(PHOTO_COLUMNS).eq("is_deleted", false);
    if (folder !== null) pageQuery = pageQuery.eq("folder", folder);
    if (namePattern) pageQuery = pageQuery.ilike("display_name", namePattern);
    const { data, error } = total === 0
      ? { data: [], error: null }
      : await pageQuery.order("taken_at", { ascending: false }).order("id", { ascending: false }).range(from, from + PHOTO_PAGE_SIZE - 1);
    if (error) throw photosDbError(error);

    // Empty gallery: tell admins what Cloudinary holds so a wrong root folder or API key is obvious.
    const diagnostics = profile.role === "admin" && total === 0 && folder === null && !search ? await diagnoseRoot(config) : undefined;

    return Response.json({
      photos: ((data || []) as PhotoRow[]).map((row) => toApiPhoto(config.cloudName, row)),
      page,
      pageCount,
      pageSize: PHOTO_PAGE_SIZE,
      total,
      folders: ((folders.data || []) as { folder: string; photo_count: number }[]).map((row) => ({ folder: row.folder, label: folderLabel(row.folder), count: row.photo_count })),
      canManage: profile.role === "admin",
      ...(diagnostics ? { diagnostics } : {}),
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
