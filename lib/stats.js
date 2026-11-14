// Xếp hạng › Thống kê and the member pages: every number is worked out here, from the club's scored matches.
// /api/stats sends the matches (with each team's ELO expectation at the time) and the sessions; the screens call
// these functions again whenever a filter changes, so a new filter shows at once without another request.
//
// Definitions (agreed with the club):
//   a pair            two players on the same team, in either order
//   head to head      matches where the two players are on opposite teams
//   close match       won by 2 points or fewer
//   deuce             the winner scored more than 21
//   blowout           won by 10 points or more
//   upset win         won while ELO gave the team under a 50% chance
//   chemistry         (wins − wins ELO expected) / matches, for a pair
//   ELO right         the team ELO rated higher won; matches with equal ratings are left out
//   few data          under MIN_MATCHES matches: shown faded, left out when sorting by a rate

export const MIN_MATCHES = 3;
export const CLOSE_MARGIN = 2;
export const BLOWOUT_MARGIN = 10;
export const DEUCE_FROM = 21;

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const winRate = (x) => (x && x.m ? x.w / x.m : 0);
export const pointDiff = (x) => x.pf - x.pa;
const byMatchOrder = (x, y) => (x.date === y.date ? x.no - y.no : x.date < y.date ? -1 : 1);

// ---------- Time ranges ----------
const pad = (n) => String(n).padStart(2, "0");
const monthKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const lastDayKey = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad(new Date(y, m, 0).getDate())}`; };

// "month" (this month), "3m" (this month and the two before), "all", or "m-YYYY-MM" for one month.
export function rangeBounds(range, today = new Date()) {
  if (range === "all") return { from: "0000-01-01", to: "9999-12-31" };
  if (range === "month") { const ym = monthKey(today); return { from: `${ym}-01`, to: lastDayKey(ym) }; }
  if (range === "3m") { const start = new Date(today.getFullYear(), today.getMonth() - 2, 1); return { from: `${monthKey(start)}-01`, to: lastDayKey(monthKey(today)) }; }
  if (/^m-\d{4}-\d{2}$/.test(range)) { const ym = range.slice(2); return { from: `${ym}-01`, to: lastDayKey(ym) }; }
  return { from: "0000-01-01", to: "9999-12-31" };
}

// The months that have a scored match, newest first, for the time filter ("Tháng 11, 2026" …).
export function monthsWithMatches(matches) {
  return [...new Set(matches.map((m) => m.date.slice(0, 7)))].sort().reverse();
}

export function inRange(data, range, today = new Date()) {
  const { from, to } = rangeBounds(range, today);
  const within = (d) => d >= from && d <= to;
  return { matches: data.matches.filter((m) => within(m.date)), sessions: data.sessions.filter((s) => within(s.date)) };
}

// ---------- The numbers ----------
export function analyze(matches) {
  const person = {}, pair = {}, h2h = {};
  const P = (id) => (person[id] ??= { id, m: 0, w: 0, pf: 0, pa: 0, closeW: 0, closeL: 0, deuceW: 0, deuceL: 0, blowW: 0, upsetW: 0, seq: [] });
  const H = (a, b) => ((h2h[a] ??= {})[b] ??= { m: 0, w: 0, pf: 0, pa: 0, list: [] });
  let marginSum = 0, close = 0, predicted = 0, predictedRight = 0;
  const buckets = [0, 0, 0, 0, 0]; // 1–2, 3–5, 6–9, 10–14, 15+ points apart
  const ordered = [...matches].sort(byMatchOrder);
  for (const m of ordered) {
    const aWon = m.sa > m.sb, margin = Math.abs(m.sa - m.sb), isClose = margin <= CLOSE_MARGIN, isDeuce = Math.max(m.sa, m.sb) > DEUCE_FROM;
    const hasExp = typeof m.expA === "number";
    marginSum += margin;
    if (isClose) close++;
    buckets[margin <= 2 ? 0 : margin <= 5 ? 1 : margin <= 9 ? 2 : margin <= 14 ? 3 : 4]++;
    if (hasExp && Math.abs(m.expA - 0.5) > 1e-9) { predicted++; if ((m.expA > 0.5) === aWon) predictedRight++; }
    for (const [team, opp, pts, against, won, exp] of [[m.a, m.b, m.sa, m.sb, aWon, hasExp ? m.expA : null], [m.b, m.a, m.sb, m.sa, !aWon, hasExp ? 1 - m.expA : null]]) {
      for (const id of team) {
        const p = P(id);
        p.m++; p.pf += pts; p.pa += against; if (won) p.w++;
        if (isClose) { if (won) p.closeW++; else p.closeL++; }
        if (isDeuce) { if (won) p.deuceW++; else p.deuceL++; }
        if (won && margin >= BLOWOUT_MARGIN) p.blowW++;
        if (won && exp !== null && exp < 0.5) p.upsetW++;
        p.seq.push(won);
        for (const o of opp) { const h = H(id, o); h.m++; h.pf += pts; h.pa += against; if (won) h.w++; h.list.push(m); }
      }
      const k = pairKey(team[0], team[1]);
      const q = (pair[k] ??= { key: k, ids: [...team].sort(), m: 0, w: 0, pf: 0, pa: 0, exp: 0, expM: 0, expW: 0, list: [] });
      q.m++; q.pf += pts; q.pa += against; if (won) q.w++; q.list.push(m);
      if (exp !== null) { q.exp += exp; q.expM++; if (won) q.expW++; }
    }
  }
  for (const p of Object.values(person)) {
    let best = 0, run = 0;
    for (const won of p.seq) { run = won ? run + 1 : 0; best = Math.max(best, run); }
    const last = p.seq[p.seq.length - 1];
    let cur = 0;
    for (let i = p.seq.length - 1; i >= 0 && p.seq[i] === last; i--) cur++;
    p.bestStreak = best;
    p.current = { won: last, n: cur };
  }
  // Chemistry only over matches with a known expectation.
  for (const q of Object.values(pair)) { q.chem = q.expM ? (q.expW - q.exp) / q.expM : 0; q.list.reverse(); }
  return {
    person, pair, h2h, n: matches.length, buckets, predicted,
    marginAvg: matches.length ? marginSum / matches.length : 0,
    closeRate: matches.length ? close / matches.length : 0,
    eloRight: predicted ? predictedRight / predicted : null,
  };
}

// Ties: more matches first, then point difference, then name.
export const tieBreak = (x, y, nameX, nameY, collator) => y.m - x.m || pointDiff(y) - pointDiff(x) || collator.compare(nameX, nameY);

// Opponents met MIN_MATCHES times or more: who beats this player more often than not, and who loses to them.
export function rivals(stats, id, nameOf, collator, limit = 3) {
  const met = Object.entries(stats.h2h[id] || {}).filter(([, x]) => x.m >= MIN_MATCHES);
  const by = (sign) => (x, y) => sign * (winRate(x[1]) - winRate(y[1])) || tieBreak(x[1], y[1], nameOf(x[0]), nameOf(y[0]), collator);
  return {
    nemesis: met.filter(([, x]) => winRate(x) < 0.5).sort(by(1)).slice(0, limit),
    prey: met.filter(([, x]) => winRate(x) > 0.5).sort(by(-1)).slice(0, limit),
  };
}

// Partners who won more than half their matches together, MIN_MATCHES or more.
export function bestPartners(stats, id, nameOf, collator, limit = 3) {
  return Object.values(stats.pair)
    .filter((q) => q.ids.includes(id) && q.m >= MIN_MATCHES && winRate(q) > 0.5)
    .map((q) => [q.ids.find((x) => x !== id), q])
    .sort((x, y) => winRate(y[1]) - winRate(x[1]) || tieBreak(x[1], y[1], nameOf(x[0]), nameOf(y[0]), collator))
    .slice(0, limit);
}

// Sessions held since the member joined, and which they came to.
export function attendance(sessions, id, joinedOn) {
  const held = sessions.filter((s) => !joinedOn || s.date >= joinedOn);
  const days = held.map((s) => ({ date: s.date, came: s.present.includes(id) }));
  return { held: held.length, came: days.filter((d) => d.came).length, days };
}

// Highlights for the overview; each may be null when nobody qualifies.
export function highlights(stats, nameOf, pairName, collator) {
  const people = Object.values(stats.person), pairs = Object.values(stats.pair);
  const topPair = [...pairs].sort((x, y) => y.w - x.w || winRate(y) - winRate(x) || tieBreak(x, y, pairName(x), pairName(y), collator))[0] ?? null;
  const streak = [...people].filter((p) => p.bestStreak > 0).sort((x, y) => y.bestStreak - x.bestStreak || tieBreak(x, y, nameOf(x.id), nameOf(y.id), collator))[0] ?? null;
  const closeRate = (p) => p.closeW / (p.closeW + p.closeL);
  const clutch = people.filter((p) => p.closeW + p.closeL >= MIN_MATCHES).sort((x, y) => closeRate(y) - closeRate(x) || y.closeW - x.closeW || collator.compare(nameOf(x.id), nameOf(y.id)))[0] ?? null;
  const darkHorse = people.filter((p) => p.upsetW > 0).sort((x, y) => y.upsetW - x.upsetW || tieBreak(x, y, nameOf(x.id), nameOf(y.id), collator))[0] ?? null;
  return { topPair, streak, clutch, darkHorse };
}

// ELO after each session in the range, for the chart. eloBySession comes from /api/stats, oldest first.
export function eloSeries(eloBySession, sessions) {
  const dates = new Set(sessions.map((s) => s.date));
  return eloBySession.filter((e) => dates.has(e.date));
}

// The change over the last four sessions with a rating (about four weeks).
export function eloChange(eloBySession, id, current) {
  const before = eloBySession[Math.max(0, eloBySession.length - 5)]?.r?.[id];
  return typeof before === "number" && typeof current === "number" ? current - before : 0;
}

// ---------- Building the data on the server ----------
// sessions: [{ id, session_date }]; matches: [{ id, session_id, match_no, team_a, team_b, score_a, score_b }];
// attendances: [{ session_id, member_id, choice }]; history: [{ member_id, match_id, elo_before, elo_after }].
// Only scored, decided matches count. A team's expectation is worked out from its players' ELO before the match,
// with the app's formula (team rating = average of the pair, scale 400).
export function buildStatsData({ sessions, matches, attendances, history, eloScale = 400, initialRating = 1000 }) {
  const dateOf = new Map(sessions.map((s) => [s.id, s.session_date]));
  const before = new Map(), after = new Map();
  for (const h of history) {
    before.set(`${h.match_id}|${h.member_id}`, Number(h.elo_before));
    after.set(`${h.match_id}|${h.member_id}`, Number(h.elo_after));
  }
  const scored = matches
    .filter((m) => dateOf.has(m.session_id) && Number.isFinite(m.score_a) && Number.isFinite(m.score_b) && m.score_a !== m.score_b && m.team_a?.length === 2 && m.team_b?.length === 2)
    .map((m) => {
      const ids = [...m.team_a, ...m.team_b];
      const ratings = ids.map((id) => before.get(`${m.id}|${id}`));
      const expA = ratings.every((r) => Number.isFinite(r))
        ? 1 / (1 + 10 ** (((ratings[2] + ratings[3]) / 2 - (ratings[0] + ratings[1]) / 2) / eloScale))
        : null;
      return { id: m.id, date: dateOf.get(m.session_id), no: m.match_no, a: [...m.team_a], b: [...m.team_b], sa: m.score_a, sb: m.score_b, expA };
    })
    .sort(byMatchOrder);
  // A session counts once it has a scored match; who came is who was marked as attending, or played.
  const presentBySession = new Map();
  for (const row of attendances) {
    if (row.choice !== "attending") continue;
    const list = presentBySession.get(row.session_id) ?? new Set();
    list.add(row.member_id);
    presentBySession.set(row.session_id, list);
  }
  const playedDates = new Set(scored.map((m) => m.date));
  const statSessions = sessions
    .filter((s) => playedDates.has(s.session_date))
    .map((s) => {
      const present = presentBySession.get(s.id) ?? new Set();
      scored.filter((m) => m.date === s.session_date).forEach((m) => [...m.a, ...m.b].forEach((id) => present.add(id)));
      return { date: s.session_date, present: [...present] };
    })
    .sort((x, y) => (x.date < y.date ? -1 : 1));
  // Each player's rating after every session, carried forward through sessions they missed.
  const rating = {};
  const eloBySession = [];
  for (const s of statSessions) {
    for (const m of scored.filter((x) => x.date === s.date)) {
      for (const id of [...m.a, ...m.b]) {
        const value = after.get(`${m.id}|${id}`);
        if (Number.isFinite(value)) rating[id] = value;
        else rating[id] ??= initialRating;
      }
    }
    eloBySession.push({ date: s.date, r: { ...rating } });
  }
  return { matches: scored, sessions: statSessions, eloBySession };
}
