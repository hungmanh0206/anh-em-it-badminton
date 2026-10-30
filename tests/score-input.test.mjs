import assert from "node:assert/strict";
import test from "node:test";
import { isScoreText, isValidScore, SCORE_FORMAT_ERROR, scoreEntryError } from "../lib/score-input.js";

test("a score box holds one or two ASCII digits", () => {
  for (const text of ["0", "7", "21", "05", "99"]) assert.equal(isScoreText(text), true, text);
  for (const text of ["", "123", "2a", "a", "-5", "1.5", "1e5", " 21", "21 ", "２１", "2!", null, undefined]) assert.equal(isScoreText(text), false, String(text));
});

test("both scores are required, must be valid and cannot be a draw", () => {
  assert.equal(scoreEntryError("", ""), "Nhập đủ điểm của cả hai đội.");
  assert.equal(scoreEntryError("21", ""), "Nhập đủ điểm của cả hai đội.");
  assert.equal(scoreEntryError("", "0"), "Nhập đủ điểm của cả hai đội.");
  assert.equal(scoreEntryError("21", "21"), "Kết quả không được hòa.");
  assert.equal(scoreEntryError("05", "5"), "Kết quả không được hòa.");
  assert.equal(scoreEntryError("100", "5"), SCORE_FORMAT_ERROR);
  assert.equal(scoreEntryError("2a", "5"), SCORE_FORMAT_ERROR);
  assert.equal(scoreEntryError("2a", ""), SCORE_FORMAT_ERROR);
  assert.equal(scoreEntryError("21", "0"), null);
  assert.equal(scoreEntryError("30", "29"), null);
});

test("the API accepts whole numbers from 0 to 99 only", () => {
  for (const score of [0, 21, 99]) assert.equal(isValidScore(score), true);
  for (const score of [-1, 100, 1.5, "21", null, undefined, Number.NaN]) assert.equal(isValidScore(score), false);
});
