import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDrawReassignmentPlan, isDrawSlotValid } from "../lib/draw-reassign.js";

const byId = (assignments) => new Map(assignments.map((assignment) => [assignment.memberId, assignment.drawnNumber]));
const assertUnique = (values) => assert.equal(new Set(values).size, values.length);

test("reassigns only members who already drew during an unfinished draw", () => {
  const rows = [
    { memberId: "l1-a", choice: "attending", level: 1, drawnNumber: 1 },
    { memberId: "l1-b", choice: "attending", level: 1, drawnNumber: 2 },
    { memberId: "l1-c", choice: "attending", level: 1, drawnNumber: null },
    { memberId: "l2-a", choice: "attending", level: 2, drawnNumber: 5 },
    { memberId: "l2-b", choice: "attending", level: 2, drawnNumber: null },
    { memberId: "l2-c", choice: "attending", level: 2, drawnNumber: null },
    { memberId: "l2-left", choice: "absent", level: 2, drawnNumber: 6 },
  ];

  const plan = buildDrawReassignmentPlan(rows, { assignAll: false, random: () => 0.42 });
  const assigned = byId(plan.assignments);

  assert.equal(plan.canOpenDraw, true);
  assert.equal(plan.allDrawn, false);
  assert.deepEqual([...assigned.keys()].sort(), ["l1-a", "l1-b", "l2-a"]);
  assert.ok(plan.clearMemberIds.includes("l2-left"));
  assertUnique([...assigned.values()]);
  for (const row of rows.filter((item) => assigned.has(item.memberId))) {
    assert.equal(isDrawSlotValid(row.level, assigned.get(row.memberId), plan.level1Count, plan.level2Count, plan.participantCount), true);
  }
});

test("assigns every attendee after the schedule was already opened", () => {
  const rows = [
    { memberId: "l1-a", choice: "attending", level: 1, drawnNumber: 1 },
    { memberId: "l1-b", choice: "attending", level: 1, drawnNumber: 2 },
    { memberId: "l1-c", choice: "attending", level: 1, drawnNumber: 3 },
    { memberId: "l1-new", choice: "attending", level: 1, drawnNumber: null },
    { memberId: "l2-a", choice: "attending", level: 2, drawnNumber: 5 },
    { memberId: "l2-b", choice: "attending", level: 2, drawnNumber: 6 },
    { memberId: "l2-c", choice: "attending", level: 2, drawnNumber: 7 },
    { memberId: "l2-d", choice: "attending", level: 2, drawnNumber: 8 },
  ];

  const plan = buildDrawReassignmentPlan(rows, { assignAll: true, random: () => 0.25 });
  const assigned = byId(plan.assignments);

  assert.equal(plan.canOpenDraw, true);
  assert.equal(plan.allDrawn, true);
  assert.deepEqual([...assigned.keys()].sort(), rows.map((row) => row.memberId).sort());
  assertUnique([...assigned.values()]);
  for (const row of rows) {
    assert.equal(isDrawSlotValid(row.level, assigned.get(row.memberId), plan.level1Count, plan.level2Count, plan.participantCount), true);
  }
});

test("clears stale numbers when the changed attendance cannot form a schedule", () => {
  const plan = buildDrawReassignmentPlan([
    { memberId: "a", choice: "attending", level: 1, drawnNumber: 1 },
    { memberId: "b", choice: "attending", level: 1, drawnNumber: 2 },
    { memberId: "c", choice: "attending", level: 2, drawnNumber: 5 },
    { memberId: "d", choice: "attending", level: 2, drawnNumber: 6 },
  ]);

  assert.equal(plan.canOpenDraw, false);
  assert.equal(plan.allDrawn, false);
  assert.deepEqual(plan.clearMemberIds.sort(), ["a", "b", "c", "d"]);
  assert.deepEqual(plan.assignments, []);
});
