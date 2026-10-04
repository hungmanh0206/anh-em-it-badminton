import { countRootImages, requireCloudinaryConfig } from "@/lib/cloudinary";
import { countActivePhotos, runFullSync } from "@/lib/photos/sync";
import { jsonError, requireAdmin } from "@/lib/supabase-admin";

// A full sync lists every asset in the root folder (500 per Cloudinary request).
export const maxDuration = 60;

// GET /api/photos/sync — counts on both sides for the admin panel.
export async function GET(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const config = requireCloudinaryConfig();
    const [cloudinaryCount, supabaseCount] = await Promise.all([countRootImages(config), countActivePhotos(admin)]);
    return Response.json({ cloudinaryCount, supabaseCount, rootFolder: config.rootFolder }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

// POST /api/photos/sync — idempotent reconciliation Cloudinary -> Supabase.
export async function POST(request: Request) {
  try {
    const { admin } = await requireAdmin(request);
    const config = requireCloudinaryConfig();
    const result = await runFullSync(admin, config);
    const supabaseCount = await countActivePhotos(admin);
    return Response.json({ ...result, supabaseCount });
  } catch (error) {
    return jsonError(error);
  }
}
