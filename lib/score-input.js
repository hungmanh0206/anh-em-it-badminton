// Match score rules, shared by the score boxes and /api/match-result.
export const SCORE_FORMAT_ERROR = "Điểm chỉ được nhập số, tối đa 2 chữ số.";

// What a score box may hold once complete. The boxes never alter what was typed; they warn instead.
export const isScoreText = (text) => /^\d{1,2}$/.test(String(text ?? ""));

export const isValidScore = (score) => Number.isInteger(score) && score >= 0 && score <= 99;

// The message to show for two score boxes, or null when they can be saved.
export const scoreEntryError = (scoreAText, scoreBText) => {
  const texts = [scoreAText, scoreBText].map((text) => String(text ?? ""));
  if (texts.some((text) => text !== "" && !isScoreText(text))) return SCORE_FORMAT_ERROR;
  if (texts.some((text) => text === "")) return "Nhập đủ điểm của cả hai đội.";
  if (Number(texts[0]) === Number(texts[1])) return "Kết quả không được hòa.";
  return null;
};

// Scores after reloading saved matches: unsaved typing on other rows stays, while a row that was
// saved before and is missing now (deleted, possibly on another device) is cleared.
export const mergeSavedScores = (current, saved, previouslySavedRows) => ({
  ...Object.fromEntries(Object.entries(current).filter(([row]) => !previouslySavedRows.has(Number(row)))),
  ...saved,
});
