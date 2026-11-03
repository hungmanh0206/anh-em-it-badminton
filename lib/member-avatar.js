// Avatars set from "Sửa thành viên" live on Cloudinary, one image per member, outside the photo
// gallery's folder. profiles.avatar_url keeps the delivery URL. Shared by the API and the tests.
export const AVATAR_FOLDER = "member-avatars";
export const AVATAR_SIZE = 320;

export const avatarPublicId = (username) => `avatar-${username}`;

const avatarPath = (url, cloudName) => {
  const prefix = `https://res.cloudinary.com/${cloudName}/image/upload/`;
  return typeof url === "string" && url.startsWith(prefix) ? url.slice(prefix.length) : null;
};

// The public_id of a stored avatar URL: fixed-folder accounts prefix it with the folder, dynamic ones do not.
export function avatarPublicIdFromUrl(url, cloudName) {
  const match = /^v\d+\/(.+)\.png$/.exec(avatarPath(url, cloudName) ?? "");
  return match ? match[1] : null;
}

// Only this member's own avatar upload is accepted, so no other address can end up in a page's CSS.
export function isMemberAvatarUrl(url, cloudName, username) {
  const publicId = avatarPublicIdFromUrl(url, cloudName);
  return publicId === avatarPublicId(username) || publicId === `${AVATAR_FOLDER}/${avatarPublicId(username)}`;
}

// The celebration picture ("ảnh ăn mừng"): a full-body cut-out shown on member cards and behind the champion card.
// It sits next to the avatar as <folder>/card-<username>. Which upload is current is kept as a marker line in
// profiles.description ("[aemit-card:v123]", or "[aemit-card:none]" once removed), like the sub-admin marker, so no
// new column is needed; a profile without a marker uses the art uploaded with the club's first members.
export const CARD_ART_MAX_HEIGHT = 1100;
export const cardPublicId = (username) => `card-${username}`;
const CARD_MARKER = /^\[aemit-card:(v\d+|none)\]$/;

export function cardArtVersion(description) {
  for (const line of String(description || "").split("\n")) {
    const match = CARD_MARKER.exec(line.trim());
    if (match) return match[1];
  }
  return undefined;
}

export function withCardArtVersion(description, version) {
  const lines = String(description || "").split("\n").map((line) => line.trim()).filter((line) => line && !CARD_MARKER.test(line));
  return [...lines, `[aemit-card:${version}]`].join("\n");
}

// The version of this member's own card upload ("v123"), or null for any other address.
export function cardUploadVersion(url, cloudName, username) {
  const prefix = `https://res.cloudinary.com/${cloudName}/image/upload/`;
  if (typeof url !== "string" || !url.startsWith(prefix)) return null;
  const match = /^(v\d+)\/(.+)\.png$/.exec(url.slice(prefix.length));
  if (!match) return null;
  return match[2] === cardPublicId(username) || match[2] === `${AVATAR_FOLDER}/${cardPublicId(username)}` ? match[1] : null;
}

// Delivery address, resized and in a modern format. The version makes a new upload show at once.
export function cardArtUrl(cloudName, username, version) {
  return `https://res.cloudinary.com/${cloudName}/image/upload/c_limit,h_900,f_auto,q_auto/${version ? `${version}/` : ""}${AVATAR_FOLDER}/${cardPublicId(username)}.png`;
}
