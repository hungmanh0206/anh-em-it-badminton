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
