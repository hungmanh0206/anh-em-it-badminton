const allowedLevel1CountsByParticipants = new Map([
  [5, [0, 1, 2, 3, 4, 5]],
  [6, [0, 1, 2, 3, 4]],
  [7, [1, 2, 3, 4]],
  [8, [2, 3, 4]],
  [9, [3, 4]],
  [10, [4]],
]);

export const toDrawLevel = (level) => Number(level) === 1 ? 1 : 2;

export const hasScheduleScenario = (participantCount, level1Count) =>
  allowedLevel1CountsByParticipants.get(participantCount)?.includes(level1Count) ?? false;

export const drawSlotsForLevel = (level, level1Count, level2Count, participantCount = level1Count + level2Count) => {
  if (participantCount === 5) return [1, 2, 3, 4, 5];
  const count = Math.max(0, level === 1 ? level1Count : level2Count);
  const start = level === 1 ? 1 : 5;
  return Array.from({ length: count }, (_, index) => start + index);
};

export const isDrawSlotValid = (level, slot, level1Count, level2Count, participantCount = level1Count + level2Count) =>
  drawSlotsForLevel(level, level1Count, level2Count, participantCount).includes(slot);

const shuffle = (items, random = Math.random) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
};

const assignFromPool = (rows, pool, random) => {
  const shuffledSlots = shuffle(pool, random);
  return rows.map((row, index) => ({
    memberId: row.memberId,
    level: row.level,
    drawnNumber: shuffledSlots[index],
  }));
};

export function buildDrawReassignmentPlan(rows, { assignAll = false, random = Math.random } = {}) {
  const normalizedRows = rows.map((row) => ({
    ...row,
    level: toDrawLevel(row.level),
    drawnNumber: typeof row.drawnNumber === "number" ? row.drawnNumber : null,
    isActive: row.isActive !== false,
  }));
  const activeRows = normalizedRows.filter((row) => row.isActive);
  const attendingRows = activeRows.filter((row) => row.choice === "attending");
  const participantCount = attendingRows.length;
  const level1Count = attendingRows.filter((row) => row.level === 1).length;
  const level2Count = participantCount - level1Count;
  const canOpenDraw = hasScheduleScenario(participantCount, level1Count);

  if (!canOpenDraw) {
    return {
      canOpenDraw: false,
      participantCount,
      level1Count,
      level2Count,
      clearMemberIds: normalizedRows.filter((row) => row.drawnNumber !== null).map((row) => row.memberId),
      assignments: [],
      allDrawn: false,
    };
  }

  const rowsToAssign = attendingRows.filter((row) => assignAll || row.drawnNumber !== null);
  const rowsToAssignIds = new Set(rowsToAssign.map((row) => row.memberId));
  const clearMemberIds = normalizedRows
    .filter((row) => row.drawnNumber !== null && (!row.isActive || row.choice !== "attending" || rowsToAssignIds.has(row.memberId)))
    .map((row) => row.memberId);

  const assignments = participantCount === 5
    ? assignFromPool(rowsToAssign, [1, 2, 3, 4, 5], random)
    : [
      ...assignFromPool(rowsToAssign.filter((row) => row.level === 1), drawSlotsForLevel(1, level1Count, level2Count, participantCount), random),
      ...assignFromPool(rowsToAssign.filter((row) => row.level === 2), drawSlotsForLevel(2, level1Count, level2Count, participantCount), random),
    ];
  const assignmentByMember = new Map(assignments.map((assignment) => [assignment.memberId, assignment.drawnNumber]));
  const allDrawn = attendingRows.every((row) => {
    const assignedSlot = assignmentByMember.get(row.memberId);
    if (typeof assignedSlot === "number") return isDrawSlotValid(row.level, assignedSlot, level1Count, level2Count, participantCount);
    return row.drawnNumber !== null && isDrawSlotValid(row.level, row.drawnNumber, level1Count, level2Count, participantCount);
  });

  return {
    canOpenDraw: true,
    participantCount,
    level1Count,
    level2Count,
    clearMemberIds,
    assignments,
    allDrawn,
  };
}
