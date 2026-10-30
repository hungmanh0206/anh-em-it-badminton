// Match score rules, shared by the score boxes and /api/match-result.
export const MAX_SCORE_DIGITS = 2;

// Keeps what a score box may hold: ASCII digits only, at most two (covers typing and pasting).
export const sanitizeScoreInput = (value) => String(value ?? "").replace(/\D/g, "").slice(0, MAX_SCORE_DIGITS);

export const isValidScore = (score) => Number.isInteger(score) && score >= 0 && score <= 99;

// The message to show for two score boxes, or null when they can be saved.
export const scoreEntryError = (scoreAText, scoreBText) => {
  const texts = [scoreAText, scoreBText].map((text) => String(text ?? ""));
  if (texts.some((text) => text === "")) return "Nhập đủ điểm của cả hai đội.";
  if (texts.some((text) => !/^\d{1,2}$/.test(text))) return "Điểm chỉ gồm số, tối đa 2 chữ số.";
  if (Number(texts[0]) === Number(texts[1])) return "Kết quả không được hòa.";
  return null;
};
