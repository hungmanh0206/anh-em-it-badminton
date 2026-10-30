import assert from "node:assert/strict";
import test from "node:test";
import { isValidScore, sanitizeScoreInput, scoreEntryError } from "../lib/score-input.js";

test("score boxes keep digits only, two at most", () => {
  assert.equal(sanitizeScoreInput("21"), "21");
  assert.equal(sanitizeScoreInput("123"), "12");
  assert.equal(sanitizeScoreInput("2a1"), "21");
  assert.equal(sanitizeScoreInput("-5"), "5");
  assert.equal(sanitizeScoreInput("1.5"), "15");
  assert.equal(sanitizeScoreInput("1e5"), "15");
  assert.equal(sanitizeScoreInput(" 2 1 "), "21");
  assert.equal(sanitizeScoreInput("２１"), "");
  assert.equal(sanitizeScoreInput("abc!@#"), "");
  assert.equal(sanitizeScoreInput(undefined), "");
});

test("both scores are required and a match cannot be a draw", () => {
  assert.equal(scoreEntryError("", ""), "Nhập đủ điểm của cả hai đội.");
  assert.equal(scoreEntryError("21", ""), "Nhập đủ điểm của cả hai đội.");
  assert.equal(scoreEntryError("", "0"), "Nhập đủ điểm của cả hai đội.");
  assert.equal(scoreEntryError("21", "21"), "Kết quả không được hòa.");
  assert.equal(scoreEntryError("05", "5"), "Kết quả không được hòa.");
  assert.equal(scoreEntryError("100", "5"), "Điểm chỉ gồm số, tối đa 2 chữ số.");
  assert.equal(scoreEntryError("2a", "5"), "Điểm chỉ gồm số, tối đa 2 chữ số.");
  assert.equal(scoreEntryError("21", "0"), null);
  assert.equal(scoreEntryError("30", "29"), null);
});

test("the API accepts whole numbers from 0 to 99 only", () => {
  for (const score of [0, 21, 99]) assert.equal(isValidScore(score), true);
  for (const score of [-1, 100, 1.5, "21", null, undefined, Number.NaN]) assert.equal(isValidScore(score), false);
});
