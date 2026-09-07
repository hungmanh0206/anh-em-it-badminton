import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { reorderMatchesForRest, summarizeMatchRestBalance } from "../lib/schedule-reorder.js";

const pageSource = fs.readFileSync("app/page.tsx", "utf8");
const scenarioRegex = /makeScheduleScenario\((\d+),\s*(\d+),\s*schedule\((\[[\s\S]*?\])\)(?:,\s*([^)]*?))?\)/g;

const matchTypeLabel = (team) => team.every((slot) => slot <= 4)
  ? "L1 + L1"
  : team.every((slot) => slot >= 5)
    ? "L2 + L2"
    : "L1 + L2";

const schedule = (patterns) => patterns.map(([a1, a2, b1, b2, type]) => {
  const teamA = [a1, a2];
  const teamB = [b1, b2];
  const teamALabel = matchTypeLabel(teamA);
  const teamBLabel = matchTypeLabel(teamB);
  return { teamA, teamB, type: type ?? (teamALabel === teamBLabel ? teamALabel : "LINH HOẠT") };
});

const canonicalMatch = (match) => JSON.stringify(match);
const canonicalMultiset = (matches) => matches.map(canonicalMatch).sort();

const readScheduleScenarios = () => {
  const scenarios = [];
  let match;
  while ((match = scenarioRegex.exec(pageSource))) {
    const participantCount = Number(match[1]);
    const level1Count = Number(match[2]);
    const patterns = Function(`return ${match[3]}`)();
    scenarios.push({
      id: participantCount === 5 ? "5-open" : `${participantCount}-${level1Count}L1-${participantCount - level1Count}L2`,
      participantCount,
      level1Count,
      matches: schedule(patterns),
    });
  }
  return scenarios;
};

const bestKnownMaxStreak = new Map([
  ["5-open", 4],
  ["6-1L1-5L2", 3],
  ["6-3L1-3L2", 3],
]);

test("schedule library reorder keeps every match unchanged", () => {
  for (const scenario of readScheduleScenarios()) {
    const reordered = reorderMatchesForRest(scenario.matches);
    assert.deepEqual(canonicalMultiset(reordered), canonicalMultiset(scenario.matches), scenario.id);
  }
});

test("schedule library reorder limits back-to-back play where the fixed matches allow it", () => {
  for (const scenario of readScheduleScenarios()) {
    const reordered = reorderMatchesForRest(scenario.matches);
    const before = summarizeMatchRestBalance(scenario.matches);
    const after = summarizeMatchRestBalance(reordered);
    const expectedMax = bestKnownMaxStreak.get(scenario.id) ?? (scenario.participantCount === 10 ? 1 : 2);

    assert.ok(after.maxStreak <= expectedMax, `${scenario.id}: max streak ${after.maxStreak}`);
    assert.ok(after.overTwoHits <= before.overTwoHits, `${scenario.id}: over-two hits increased`);
    assert.ok(after.transitionOverlap <= before.transitionOverlap, `${scenario.id}: consecutive-player overlap increased`);
  }
});