// A member's display name doubles as their login: "Đức Anh" signs in as "ducanh"
// (auth email `${username}@anhemit.club`). Shared by the add-member form and the API.
export const MEMBER_EMAIL_DOMAIN = "anhemit.club";
export const MEMBER_PASSWORD_MIN = 6;

export const usernameFromName = (name) => String(name || "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[đĐ]/g, "d")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

export const isValidMemberUsername = (username) => /^[a-z0-9]{2,24}$/.test(String(username || ""));
