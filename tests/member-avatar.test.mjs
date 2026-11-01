import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_FOLDER, avatarPublicId, avatarPublicIdFromUrl, isMemberAvatarUrl } from "../lib/member-avatar.js";
import { resourceToPhotoRow } from "../lib/photos/assets.js";

const cloud = "club";
const base = `https://res.cloudinary.com/${cloud}/image/upload`;

test("accepts a member's own upload in both Cloudinary folder modes", () => {
  assert.equal(isMemberAvatarUrl(`${base}/v123/avatar-nam.png`, cloud, "nam"), true);
  assert.equal(isMemberAvatarUrl(`${base}/v123/${AVATAR_FOLDER}/avatar-nam.png`, cloud, "nam"), true);
});

test("rejects anything else", () => {
  for (const url of [
    `${base}/v123/avatar-son.png`,
    `${base}/v123/avatar-nam.jpg`,
    `${base}/avatar-nam.png`,
    `https://res.cloudinary.com/other/image/upload/v123/avatar-nam.png`,
    `https://evil.example/${base}/v123/avatar-nam.png`,
    `${base}/v123/avatar-nam.png");}body{display:none`,
    "",
    null,
    42,
  ]) assert.equal(isMemberAvatarUrl(url, cloud, "nam"), false, String(url));
});

test("finds the public id to delete from a stored URL", () => {
  assert.equal(avatarPublicIdFromUrl(`${base}/v9/${AVATAR_FOLDER}/avatar-nam.png`, cloud), `${AVATAR_FOLDER}/avatar-nam`);
  assert.equal(avatarPublicIdFromUrl(`${base}/v9/avatar-nam.png`, cloud), "avatar-nam");
  assert.equal(avatarPublicIdFromUrl(null, cloud), null);
  assert.equal(avatarPublicIdFromUrl("https://example.com/a.png", cloud), null);
});

test("avatars never show up in the photo gallery, even when the gallery covers the whole account", () => {
  const resource = (extra) => ({ asset_id: "a1", public_id: avatarPublicId("nam"), resource_type: "image", type: "upload", ...extra });
  assert.equal(resourceToPhotoRow(resource({ asset_folder: AVATAR_FOLDER }), ""), null);
  assert.equal(resourceToPhotoRow(resource({ public_id: `${AVATAR_FOLDER}/avatar-nam` }), ""), null);
  assert.equal(resourceToPhotoRow(resource({ asset_folder: AVATAR_FOLDER }), "badminton"), null);
  assert.notEqual(resourceToPhotoRow({ ...resource({ asset_folder: "2026" }), public_id: "photo" }, ""), null);
});
