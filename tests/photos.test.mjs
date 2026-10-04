import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deliveryUrls, resourceToPhotoRow } from "../lib/photos/assets.js";
import { signParams, verifyNotificationSignature } from "../lib/photos/cloudinary-sign.js";
import { folderLabel, fullFolderPath, relativeFolder, sanitizeFolderInput } from "../lib/photos/folders.js";
import { extractNotificationTargets } from "../lib/photos/notifications.js";

test("signParams matches Cloudinary's documented example", () => {
  const signature = signParams({ eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", public_id: "sample_image", timestamp: 1315060510 }, "abcd");
  assert.equal(signature, "bfd09f95f331f558cbd1320e67aa8d488770583e");
});

test("signParams sorts keys and skips empty values", () => {
  const a = signParams({ timestamp: 1, folder: "badminton", empty: "" }, "s");
  assert.equal(a, createHash("sha1").update("folder=badminton&timestamp=1s").digest("hex"));
});

test("webhook signature: valid sha1 and sha256, rejects tampering and stale timestamps", () => {
  const body = JSON.stringify({ notification_type: "upload", asset_id: "a".repeat(32) });
  const timestamp = "1790000000";
  const secret = "topsecret";
  const now = 1790000100;
  for (const algorithm of ["sha1", "sha256"]) {
    const signature = createHash(algorithm).update(body + timestamp + secret).digest("hex");
    assert.deepEqual(verifyNotificationSignature({ body, timestamp, signature, apiSecret: secret, nowSeconds: now }), { ok: true });
    assert.equal(verifyNotificationSignature({ body: body + " ", timestamp, signature, apiSecret: secret, nowSeconds: now }).ok, false);
    assert.equal(verifyNotificationSignature({ body, timestamp, signature, apiSecret: secret, nowSeconds: now + 3 * 86400 }).reason, "expired");
  }
  assert.equal(verifyNotificationSignature({ body, timestamp, signature: null, apiSecret: secret, nowSeconds: now }).reason, "missing");
});

test("relativeFolder keeps only assets inside the root folder", () => {
  assert.equal(relativeFolder("badminton/2026/week-01", "badminton"), "2026/week-01");
  assert.equal(relativeFolder("badminton", "badminton"), "");
  assert.equal(relativeFolder("/badminton/members/", "badminton"), "members");
  assert.equal(relativeFolder("badminton-old/x", "badminton"), null);
  assert.equal(relativeFolder("other", "badminton"), null);
  assert.equal(relativeFolder("Family-Moments/2026/Week-01", "family-moments"), "2026/Week-01");
  assert.equal(relativeFolder("Kho ảnh anh em IT/2026", "Kho ảnh anh em IT "), "2026");
  assert.equal(relativeFolder("Kho ảnh anh em IT", "kho ảnh anh em it"), "");
});

test("sanitizeFolderInput accepts safe paths only", () => {
  assert.equal(sanitizeFolderInput("2026/week-05"), "2026/week-05");
  assert.equal(sanitizeFolderInput(" /tournament-01/ "), "tournament-01");
  assert.equal(sanitizeFolderInput(""), "");
  assert.equal(sanitizeFolderInput("Tuần 5"), null);
  assert.equal(sanitizeFolderInput("../x"), null);
  assert.equal(sanitizeFolderInput("a/b/c/d/e"), null);
  assert.equal(fullFolderPath("badminton", "2026/week-05"), "badminton/2026/week-05");
  assert.equal(fullFolderPath("badminton", ""), "badminton");
});

test("folderLabel derives readable categories from folder names", () => {
  assert.equal(folderLabel("2026/week-01"), "Tuần 1 · 2026");
  assert.equal(folderLabel("2026/tournament-01"), "Giải đấu 1 · 2026");
  assert.equal(folderLabel("members"), "Thành viên");
  assert.equal(folderLabel("banners"), "Banner");
  assert.equal(folderLabel("2026"), "2026");
  assert.equal(folderLabel(""), "Chung");
  assert.equal(folderLabel("friendly-match"), "Friendly match");
});

test("resourceToPhotoRow maps dynamic and fixed folder assets, rejects others", () => {
  const dynamic = resourceToPhotoRow({ asset_id: "abc", public_id: "IMG_1", asset_folder: "badminton/2026/week-02", resource_type: "image", type: "upload", format: "JPG", width: 4000, height: 3000, bytes: 123, version: 17, created_at: "2026-10-04T01:02:03Z", display_name: "IMG_1" }, "badminton");
  assert.equal(dynamic.folder, "2026/week-02");
  assert.equal(dynamic.format, "jpg");
  assert.equal(dynamic.taken_at, "2026-10-04T01:02:03.000Z");
  assert.equal(dynamic.is_deleted, false);
  const fixed = resourceToPhotoRow({ asset_id: "def", public_id: "badminton/members/anh", resource_type: "image", type: "upload" }, "badminton");
  assert.equal(fixed.folder, "members");
  assert.equal(resourceToPhotoRow({ asset_id: "x", public_id: "other/y", resource_type: "image" }, "badminton"), null);
  assert.equal(resourceToPhotoRow({ asset_id: "x", public_id: "badminton/v", resource_type: "video" }, "badminton"), null);
  assert.equal(resourceToPhotoRow({ public_id: "badminton/no-id" }, "badminton"), null);
});

test("deliveryUrls point straight at the Cloudinary CDN with resized transformations", () => {
  const urls = deliveryUrls("demo", { public_id: "badminton/2026/week 1/ảnh", version: 5 });
  assert.equal(urls.thumbUrl, "https://res.cloudinary.com/demo/image/upload/c_fill,g_auto,w_480,h_480,q_auto,f_auto/v5/badminton/2026/week%201/%E1%BA%A3nh");
  assert.match(urls.fullUrl, /\/c_limit,w_1920,h_1920,q_auto,f_auto\/v5\//);
});

test("extractNotificationTargets covers upload, delete, rename and non-image events", () => {
  assert.deepEqual(extractNotificationTargets({ notification_type: "upload", asset_id: "a1", public_id: "badminton/x", resource_type: "image" }), { type: "upload", assetIds: ["a1"], publicIds: ["badminton/x"] });
  const deleted = extractNotificationTargets({ notification_type: "delete", resources: [{ asset_id: "a2", public_id: "p2", resource_type: "image" }, { asset_id: "v1", public_id: "vid", resource_type: "video" }] });
  assert.deepEqual(deleted.assetIds, ["a2"]);
  const renamed = extractNotificationTargets({ notification_type: "rename", from_public_id: "old", to_public_id: "new" });
  assert.deepEqual(renamed, { type: "rename", assetIds: [], publicIds: ["old", "new"] });
  assert.deepEqual(extractNotificationTargets(null), { type: null, assetIds: [], publicIds: [] });
});
