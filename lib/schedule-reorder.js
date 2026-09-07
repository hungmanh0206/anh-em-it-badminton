const matchSlots = (match) => [...match.teamA, ...match.teamB];

export const summarizeMatchRestBalance = (matches) => {
  const slotNumbers = [...new Set(matches.flatMap(matchSlots))].sort((a, b) => a - b);
  const currentStreaks = new Map(slotNumbers.map((slot) => [slot, 0]));
  const maxStreaks = new Map(slotNumbers.map((slot) => [slot, 0]));
  let overTwoHits = 0;
  let transitionOverlap = 0;
  let previousSlots = new Set();

  for (const match of matches) {
    const currentSlots = new Set(matchSlots(match));

    for (const slot of slotNumbers) {
      const nextStreak = currentSlots.has(slot) ? (currentStreaks.get(slot) ?? 0) + 1 : 0;
      currentStreaks.set(slot, nextStreak);
      maxStreaks.set(slot, Math.max(maxStreaks.get(slot) ?? 0, nextStreak));
      if (nextStreak > 2) overTwoHits += nextStreak - 2;
      if (currentSlots.has(slot) && previousSlots.has(slot)) transitionOverlap += 1;
    }

    previousSlots = currentSlots;
  }

  return {
    maxStreak: Math.max(0, ...maxStreaks.values()),
    overTwoHits,
    transitionOverlap,
    maxStreaksBySlot: Object.fromEntries(maxStreaks),
  };
};

export const reorderMatchesForRest = (matches) => {
  if (matches.length <= 2) return matches;

  const slotNumbers = [...new Set(matches.flatMap(matchSlots))].sort((a, b) => a - b);
  const stateScore = (state) =>
    state.maxStreak * 1_000_000 +
    state.overTwoHits * 20_000 +
    state.transitionOverlap * 300 +
    state.order.reduce((total, index, position) => total + Math.abs(index - position) * 0.001, 0);

  let beam = [{
    order: [],
    remaining: matches.map((_, index) => index),
    streaks: new Map(slotNumbers.map((slot) => [slot, 0])),
    maxStreak: 0,
    overTwoHits: 0,
    transitionOverlap: 0,
  }];
  const beamWidth = 180;

  for (let depth = 0; depth < matches.length; depth += 1) {
    const nextBeam = [];

    for (const state of beam) {
      const previousMatch = state.order.length ? matches[state.order[state.order.length - 1]] : null;
      const previousSlots = previousMatch ? new Set(matchSlots(previousMatch)) : new Set();

      for (const index of state.remaining) {
        const currentSlots = new Set(matchSlots(matches[index]));
        const streaks = new Map();
        let maxStreak = state.maxStreak;
        let overTwoHits = state.overTwoHits;
        let transitionOverlap = state.transitionOverlap;

        for (const slot of slotNumbers) {
          const previousStreak = state.streaks.get(slot) ?? 0;
          const nextStreak = currentSlots.has(slot) ? previousStreak + 1 : 0;
          streaks.set(slot, nextStreak);
          maxStreak = Math.max(maxStreak, nextStreak);
          if (nextStreak > 2) overTwoHits += nextStreak - 2;
          if (currentSlots.has(slot) && previousSlots.has(slot)) transitionOverlap += 1;
        }

        nextBeam.push({
          order: [...state.order, index],
          remaining: state.remaining.filter((item) => item !== index),
          streaks,
          maxStreak,
          overTwoHits,
          transitionOverlap,
        });
      }
    }

    beam = nextBeam.sort((a, b) => stateScore(a) - stateScore(b)).slice(0, beamWidth);
  }

  const best = beam.sort((a, b) => stateScore(a) - stateScore(b))[0];
  return best ? best.order.map((index) => matches[index]) : matches;
};