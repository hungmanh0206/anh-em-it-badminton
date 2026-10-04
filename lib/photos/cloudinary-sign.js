import { createHash, timingSafeEqual } from "node:crypto";

// Cloudinary signed-request signature: sort params by key, join as k=v with "&",
// append the API secret and hash (SHA-1 by default). Empty values are skipped.
export function signParams(params, apiSecret, algorithm = "sha1") {
  const toSign = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${Array.isArray(params[key]) ? params[key].join(",") : params[key]}`)
    .join("&");
  return createHash(algorithm).update(toSign + apiSecret).digest("hex");
}

const safeEqualHex = (a, b) => {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

// Webhook signature: hash(rawBody + timestamp + apiSecret), hex, sent as X-Cld-Signature with X-Cld-Timestamp.
// Accounts can be configured for SHA-1 or SHA-256, so both are accepted.
// The timestamp window only limits replays; handlers re-read the asset from Cloudinary anyway.
export function verifyNotificationSignature({ body, timestamp, signature, apiSecret, nowSeconds = Math.floor(Date.now() / 1000), maxAgeSeconds = 24 * 60 * 60 }) {
  if (!body || !timestamp || !signature || !apiSecret) return { ok: false, reason: "missing" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad-timestamp" };
  if (Math.abs(nowSeconds - ts) > maxAgeSeconds) return { ok: false, reason: "expired" };
  const payload = `${body}${timestamp}${apiSecret}`;
  const matches = ["sha1", "sha256"].some((algorithm) => safeEqualHex(createHash(algorithm).update(payload).digest("hex"), String(signature).toLowerCase()));
  return matches ? { ok: true } : { ok: false, reason: "mismatch" };
}
