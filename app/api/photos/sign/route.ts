import { requireCloudinaryConfig } from "@/lib/cloudinary";
import { PHOTO_FORMATS } from "@/lib/photos/assets";
import { signParams } from "@/lib/photos/cloudinary-sign";
import { fullFolderPath, sanitizeFolderInput } from "@/lib/photos/folders";
import { ApiError, jsonError, requireAdmin } from "@/lib/supabase-admin";

// POST /api/photos/sign { folder } — signed parameters for a direct browser -> Cloudinary upload.
// Only the signature leaves the server; the API secret stays here. Image bytes never touch Vercel.
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const config = requireCloudinaryConfig();
    const body = await request.json().catch(() => ({})) as { folder?: unknown };
    const relative = sanitizeFolderInput(typeof body.folder === "string" ? body.folder : "");
    if (relative === null) throw new ApiError(400, "Tên thư mục chỉ gồm chữ thường không dấu, số, '-' hoặc '_' (ví dụ 2026/week-05).");

    const timestamp = Math.floor(Date.now() / 1000);
    const params = { folder: fullFolderPath(config.rootFolder, relative), timestamp, allowed_formats: PHOTO_FORMATS.join(",") };
    return Response.json({
      uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
      apiKey: config.apiKey,
      signature: signParams(params, config.apiSecret),
      ...params,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
