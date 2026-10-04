import { getResourceByPublicId, requireCloudinaryConfig } from "@/lib/cloudinary";
import { verifyNotificationSignature } from "@/lib/photos/cloudinary-sign";
import { extractNotificationTargets } from "@/lib/photos/notifications";
import { photosDbError } from "@/lib/photos/repository";
import { refreshAssets } from "@/lib/photos/sync";
import { createSupabaseAdmin, jsonError } from "@/lib/supabase-admin";

// POST /api/cloudinary/webhook — Cloudinary notification URL.
// Flow: verify signature -> collect asset ids -> re-read each asset from Cloudinary -> upsert or
// soft-delete in Supabase. It never writes to Cloudinary, so it cannot cause a webhook loop, and
// replays/duplicates are harmless because every write is keyed by cloudinary_asset_id.
export async function POST(request: Request) {
  try {
    const config = requireCloudinaryConfig();
    const body = await request.text();
    const verification = verifyNotificationSignature({
      body,
      timestamp: request.headers.get("x-cld-timestamp"),
      signature: request.headers.get("x-cld-signature"),
      apiSecret: config.apiSecret,
    });
    if (!verification.ok) return Response.json({ error: "Invalid signature" }, { status: 401 });

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const { type, assetIds, publicIds } = extractNotificationTargets(payload);
    const admin = createSupabaseAdmin();
    const targets = new Set(assetIds);

    // Notifications that only carry public ids: resolve via the index first, then Cloudinary.
    if (!targets.size && publicIds.length) {
      const { data, error } = await admin.from("photos").select("cloudinary_asset_id").in("public_id", publicIds);
      if (error) throw photosDbError(error);
      (data || []).forEach((row) => targets.add(row.cloudinary_asset_id));
      if (!targets.size) {
        for (const publicId of publicIds) {
          const resource = await getResourceByPublicId(config, publicId);
          if (resource?.asset_id) targets.add(resource.asset_id);
        }
      }
    }

    if (!targets.size) return Response.json({ ok: true, type, ignored: true });
    const result = await refreshAssets(admin, config, [...targets]);
    return Response.json({ ok: true, type, ...result });
  } catch (error) {
    // Non-2xx makes Cloudinary retry; the manual sync covers anything still missed.
    return jsonError(error);
  }
}
