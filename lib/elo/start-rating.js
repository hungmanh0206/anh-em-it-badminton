import { ELO_INITIAL_RATING, ELO_LEVEL_ONE_SIZE } from "./constants.js";

// Members added after launch keep their starting ELO in profiles.description (next to the sub-admin
// marker), so every replay starts them there instead of at ELO_INITIAL_RATING.
const START_PATTERN = /\[aemit-elo-start:(-?\d+(?:\.\d+)?)\]/;

export const eloStartFromDescription = (description) => {
  const match = String(description || "").match(START_PATTERN);
  return match ? Number(match[1]) : null;
};

export const startRatingForProfile = (profile) => eloStartFromDescription(profile?.description) ?? ELO_INITIAL_RATING;

export const withEloStart = (description, rating) => [
  ...String(description || "").split("\n").map((line) => line.trim()).filter((line) => line && !START_PATTERN.test(line)),
  `[aemit-elo-start:${rating}]`,
].join("\n");

// A new member starts at the usual 1000, or just below the 4th best ELO when the Level 1 cut-off is
// lower than that, so they always join as Level 2.
export const newMemberStartRating = (activeRatings, levelOneSize = ELO_LEVEL_ONE_SIZE) => {
  const cutoff = [...activeRatings].sort((a, b) => b - a)[levelOneSize - 1];
  if (cutoff === undefined) return ELO_INITIAL_RATING;
  return Math.min(ELO_INITIAL_RATING, Math.floor((cutoff - 1) * 10) / 10);
};
