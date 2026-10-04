// Pulls asset identifiers out of a Cloudinary notification. Only identifiers are used: the
// handler re-reads each asset from Cloudinary, so payload metadata is never trusted.
// Covers upload, delete, rename, move/asset-folder and display-name notifications, and any
// unknown type that carries asset_id / public_id at the top level or in `resources`.
export function extractNotificationTargets(payload) {
  const assetIds = new Set();
  const publicIds = new Set();
  if (!payload || typeof payload !== "object") return { type: null, assetIds: [], publicIds: [] };
  const add = (item) => {
    if (!item || typeof item !== "object") return;
    if (item.resource_type && item.resource_type !== "image") return;
    if (typeof item.asset_id === "string" && item.asset_id) assetIds.add(item.asset_id);
    for (const key of ["public_id", "from_public_id", "to_public_id"]) {
      if (typeof item[key] === "string" && item[key]) publicIds.add(item[key]);
    }
  };
  add(payload);
  if (Array.isArray(payload.resources)) payload.resources.forEach(add);
  return { type: typeof payload.notification_type === "string" ? payload.notification_type : null, assetIds: [...assetIds], publicIds: [...publicIds] };
}
