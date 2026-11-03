import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_FOLDER, avatarPublicId, avatarPublicIdFromUrl, cardArtUrl, cardArtVersion, cardUploadVersion, isMemberAvatarUrl, withCardArtVersion } from "../lib/member-avatar.js";
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

test("celebration picture: only the member's own card upload is accepted, and its version is kept", () => {
  assert.equal(cardUploadVersion(`${base}/v77/${AVATAR_FOLDER}/card-nam.png`, cloud, "nam"), "v77");
  assert.equal(cardUploadVersion(`${base}/v77/card-nam.png`, cloud, "nam"), "v77");
  for (const url of [`${base}/v77/${AVATAR_FOLDER}/card-son.png`, `${base}/v77/${AVATAR_FOLDER}/avatar-nam.png`, `${base}/${AVATAR_FOLDER}/card-nam.png`, `https://evil.example/v77/card-nam.png`, null]) {
    assert.equal(cardUploadVersion(url, cloud, "nam"), null, String(url));
  }
  assert.equal(cardArtUrl(cloud, "nam", "v77"), `${base}/c_limit,h_900,f_auto,q_auto/v77/${AVATAR_FOLDER}/card-nam.png`);
});

test("celebration picture marker lives beside other description lines", () => {
  assert.equal(cardArtVersion(null), undefined);
  const withSub = "[aemit-role:sub-admin]";
  const marked = withCardArtVersion(withSub, "v5");
  assert.equal(marked, `${withSub}\n[aemit-card:v5]`);
  assert.equal(cardArtVersion(marked), "v5");
  const replaced = withCardArtVersion(marked, "none");
  assert.equal(replaced, `${withSub}\n[aemit-card:none]`);
  assert.equal(cardArtVersion(replaced), "none");
  assert.equal(cardArtVersion("[aemit-card:v5] trailing"), undefined);
});
