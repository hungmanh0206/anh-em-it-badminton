"use client";

import { type CSSProperties, type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { backdropDismissProps, Presence } from "@/app/ui/modal";
import { PhotoGallery } from "@/app/photo-gallery";
import { PageHero } from "@/app/ui/page-hero";
import { roundAvatarImage } from "@/app/ui/avatar-image";
import { ChampionCelebration } from "@/app/ui/champion-celebration";
import { Toast, useToast } from "@/app/ui/toast";
import { supabase } from "@/lib/supabase";
import { isCheckinWindowOpenForDate, sessionDatesOfMonth, sessionStateForDate, sessionWeekdayLabel, sessionWeekInMonth, targetSessionDateKey } from "@/lib/session-dates";
import { reorderMatchesForRest } from "@/lib/schedule-reorder";
import { MEMBER_PASSWORD_MIN, usernameFromName } from "@/lib/member-username";
import { isScoreText, mergeSavedScores, SCORE_FORMAT_ERROR, scoreEntryError } from "@/lib/score-input";

type MemberRole = "admin" | "sub-admin" | "member";
type Member = { name: string; initials: string; level: 1 | 2; color: string; present: boolean; username: string; password: string; role?: MemberRole; responded?: boolean };
type RankingRow = { username?: string; name: string; initials: string; level: number; points: number; pointsWon: number; pointsLost: number; pointDiff: number; matches: number; color: string; placeholder?: boolean };
type EloRankingRow = { memberId: string; username: string; name: string; initials: string; level: number; eloRating: number; rank: number; matches: number; color: string };
type EloStatus = { source: "database" | "calculated" | "unavailable"; processedMatches: number; message: string };
type MonthCloseStatus = { monthKey: string; monthLabel: string; nextMonthKey: string; nextMonthLabel: string; finalSessionCompleted: boolean; closed: boolean; eligible: boolean; currentRows: number; message: string };
type HistorySession = { id: string; date: string; matches: number; attendees: number };
type SupabaseProfile = { id?: string; username?: string | null; full_name?: string | null; level?: number | string | null; role?: MemberRole | string | null; description?: string | null; is_active?: boolean | null };
type MonthlyResultRow = { month?: string | null; total_points: number; points_for: number; points_against: number; point_diff: number; matches_played: number; level_next_month: number | null; created_at?: string | null; profiles: SupabaseProfile | SupabaseProfile[] | null };
type HistoryMatchSummary = { count?: number | null; team_a?: string[] | null; team_b?: string[] | null };
type HistorySessionRow = { id: string; session_date: string; matches?: HistoryMatchSummary[] | null; attendances?: { count?: number; choice?: string | null }[] | null };
type MatchRow = { match_no: number; team_a: string[]; team_b: string[]; score_a: number; score_b: number };
type SavedMatchRow = { match_no: number; score_a: number | null; score_b: number | null };
type ProfileRow = { id: string; full_name: string };
type RankingCachePayload = {
  rankingRows: RankingRow[];
  currentRankingRows: RankingRow[];
  liveRankingRows: RankingRow[];
  previousRankingRows: RankingRow[];
  championRankingRows: RankingRow[];
  championRankingLabel: string;
  storedAt: number;
};
// One of a member's most recent matches, as computed by /api/app-data (newest first).
type FormResult = { result: "W" | "L"; date: string; score: string };
type FormByUsername = Record<string, FormResult[]>;
type AppDataCachePayload = RankingCachePayload & {
  eloRows: EloRankingRow[];
  eloStatus: EloStatus | null;
  formByUsername?: FormByUsername;
  historySessions: HistorySession[];
  monthCloseStatus: MonthCloseStatus | null;
};
type Screen = "home" | "members" | "rules" | "schedules" | "ranking" | "elo" | "history" | "photos";
type SessionStatus = "draft" | "checked_in" | "drawn" | "scheduled" | "completed";
type AttendanceRow = { choice: "pending" | "attending" | "absent"; drawn_number: number | null; level_at_time?: "1" | "2" | number | string | null; profiles: SupabaseProfile | SupabaseProfile[] | null };
type HomeSessionPayload = { inactive?: boolean; sessionId?: string | null; sessionDate?: string; status?: SessionStatus; attendances?: AttendanceRow[]; needsReset?: boolean; drawsReassigned?: boolean; scheduleCleared?: boolean; error?: string };
type AppIconName = "home" | "members" | "schedule" | "ranking" | "history" | "rules" | "trophy" | "crown" | "check" | "success" | "error" | "target" | "pencil" | "save" | "logout" | "clipboard" | "gift" | "confirm" | "photos";
function AppIcon({ name, className = "" }: { name: AppIconName; className?: string }) {
  return <span className={`app-icon app-icon-${name}${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}
const subAdminRoleMarker = "[aemit-role:sub-admin]";
const effectiveRole = (role?: string | null, description?: string | null): MemberRole => {
  if (role === "admin") return "admin";
  if (role === "sub-admin" || String(description || "").includes(subAdminRoleMarker)) return "sub-admin";
  return "member";
};
const memberRoleLabel = (role?: MemberRole | string | null) => role === "admin" ? "Quản trị viên" : role === "sub-admin" ? "Sub-admin" : "Thành viên";
const isScoreManagerRole = (role?: MemberRole | string | null) => role === "admin" || role === "sub-admin";
const scheduleParticipants = [5, 6, 7, 8, 9, 10, 11, 12] as const;
type ParticipantCount = typeof scheduleParticipants[number];
type MatchPattern = readonly [number, number, number, number, string?];
type ScheduleMatch = { teamA: readonly [number, number]; teamB: readonly [number, number]; type: string };
type ScheduleScenario = { id: string; participantCount: ParticipantCount; level1Count: number; level2Count: number; title: string; subtitle: string; badge: string; note: string; matches: ScheduleMatch[]; relaxedReason?: string };
const matchCountFromHistoryRows = (matches: HistoryMatchSummary[] | null | undefined) => {
  const rows = matches || [];
  if (rows.length === 1 && typeof rows[0].count === "number" && !rows[0].team_a && !rows[0].team_b) return rows[0].count || 0;
  return rows.length;
};
const attendeeCountFromMatches = (matches: HistoryMatchSummary[] | null | undefined) => {
  const memberIds = new Set<string>();
  (matches || []).forEach((match) => {
    [...(match.team_a || []), ...(match.team_b || [])].forEach((memberId) => {
      if (memberId) memberIds.add(memberId);
    });
  });
  return memberIds.size;
};
const attendeeCountFromAttendances = (attendances: HistorySessionRow["attendances"]) => {
  const rows = attendances || [];
  return rows.some((row) => typeof row.choice === "string")
    ? rows.filter((row) => row.choice === "attending").length
    : rows[0]?.count || 0;
};
const screenTitles: Record<Screen, string> = {
  home: "Home",
  members: "Quản lý thành viên",
  rules: "Thể lệ",
  schedules: "Lịch thi đấu",
  ranking: "Bảng xếp hạng",
  elo: "ELO",
  history: "Lịch sử thi đấu",
  photos: "Kho ảnh",
};
const screenKeys = Object.keys(screenTitles) as Screen[];
const hiddenRankingMonths = new Set(["Tháng 5, 2026", "Tháng 6, 2026"]);
const isScreenKey = (value: string | null | undefined): value is Screen => Boolean(value && screenKeys.includes(value as Screen));
const screenFromLocation = () => {
  if (typeof window === "undefined") return "home";
  const hashScreen = window.location.hash.replace(/^#\/?/, "");
  if (isScreenKey(hashScreen)) return hashScreen;
  const savedScreen = window.localStorage.getItem("aemit-current-screen");
  return isScreenKey(savedScreen) ? savedScreen : "home";
};
const slotLevel = (no: number): 1 | 2 => no <= 4 ? 1 : 2;
const drawSlotsForLevel = (level: 1 | 2, level1Count: number, level2Count: number, participantCount = level1Count + level2Count) => {
  if (participantCount === 5) return [1, 2, 3, 4, 5];
  const count = Math.max(0, level === 1 ? level1Count : level2Count);
  const start = level === 1 ? 1 : 5;
  return Array.from({ length: count }, (_, index) => start + index);
};
const wheelGradient = (count: number) => {
  const colors = ["#fff8df", "#ffffff", "#ffe39a", "#fffaf0"];
  const safeCount = Math.max(1, count);
  return `conic-gradient(${Array.from({ length: safeCount }, (_, index) => {
    const start = (index * 360) / safeCount;
    const end = ((index + 1) * 360) / safeCount;
    return `${colors[index % colors.length]} ${start}deg ${end}deg`;
  }).join(", ")})`;
};
const drawSlotRangeLabel = (level: 1 | 2, level1Count: number, level2Count: number, participantCount = level1Count + level2Count) => {
  const slots = drawSlotsForLevel(level, level1Count, level2Count, participantCount);
  if (!slots.length) return "chưa có số";
  return slots.length === 1 ? `số ${slots[0]}` : `số ${slots[0]}–${slots[slots.length - 1]}`;
};
const isDrawSlotValid = (level: 1 | 2, slot: number, level1Count: number, level2Count: number, participantCount = level1Count + level2Count) =>
  drawSlotsForLevel(level, level1Count, level2Count, participantCount).includes(slot);
const drawNumberClass = (slot: number, participantCount: number) => participantCount === 5 ? "level-open" : `level-${slotLevel(slot)}`;
const matchTypeLabel = (team: readonly [number, number]) => team.every((no) => slotLevel(no) === 1) ? "L1 + L1" : team.every((no) => slotLevel(no) === 2) ? "L2 + L2" : "L1 + L2";
const schedule = (patterns: MatchPattern[]) => patterns.map(([a1, a2, b1, b2, type]) => {
  const teamA = [a1, a2] as const;
  const teamB = [b1, b2] as const;
  const teamALabel = matchTypeLabel(teamA);
  const teamBLabel = matchTypeLabel(teamB);
  return { teamA, teamB, type: type ?? (teamALabel === teamBLabel ? teamALabel : "LINH HOẠT") };
});
const relaxedOneLevel1 = "Lịch linh hoạt: chỉ có 1 thành viên Level 1 nên các trận của người này không áp dụng rule cân Level; vẫn giữ mỗi người 4 trận và không lặp đồng đội.";
const relaxedThreeThree = "Lịch linh hoạt: 3 Level 1 + 3 Level 2 ưu tiên không lặp đồng đội; 2 trận cuối không áp dụng rule cân Level để vẫn giữ mỗi người 4 trận.";
const makeScheduleScenario = (participantCount: ParticipantCount, level1Count: number, matches: ScheduleMatch[], relaxedReason?: string): ScheduleScenario => {
  const level2Count = participantCount - level1Count;
  const isOpenFive = participantCount === 5;
  return {
    id: isOpenFive ? "5-players-open" : `${participantCount}-players-${level1Count}-l1-${level2Count}-l2`,
    participantCount,
    level1Count,
    level2Count,
    title: isOpenFive ? "5 người · không phân Level" : `${participantCount} người · ${level1Count} Level 1 + ${level2Count} Level 2`,
    subtitle: `${matches.length} trận`,
    badge: isOpenFive ? "1–5" : `${level1Count}L1 + ${level2Count}L2`,
    note: isOpenFive ? "Áp dụng khi buổi chơi có đúng 5 thành viên tham gia; tất cả chọn số 1–5, không phân Level." : relaxedReason ?? `Áp dụng khi buổi chơi có ${level1Count} thành viên Level 1 và ${level2Count} thành viên Level 2.`,
    matches: reorderMatchesForRest(matches),
    relaxedReason,
  };
};
const scheduleScenarios: ScheduleScenario[] = [
  makeScheduleScenario(5, 0, schedule([[2, 3, 4, 5, "MỞ"], [1, 4, 3, 5, "MỞ"], [1, 5, 2, 4, "MỞ"], [1, 3, 2, 5, "MỞ"], [1, 2, 3, 4, "MỞ"]])),
  makeScheduleScenario(6, 0, schedule([[5, 6, 7, 8], [5, 7, 9, 10], [5, 9, 6, 8], [7, 10, 8, 9], [5, 10, 6, 7], [6, 9, 8, 10]])),
  makeScheduleScenario(6, 1, schedule([[1, 5, 6, 7], [1, 6, 8, 9], [5, 8, 7, 9], [1, 8, 5, 7], [1, 7, 6, 9], [5, 9, 6, 8]]), relaxedOneLevel1),
  makeScheduleScenario(6, 2, schedule([[1, 5, 2, 6], [1, 7, 2, 8], [5, 6, 7, 8], [1, 6, 2, 5], [1, 8, 2, 7], [5, 7, 6, 8]])),
  makeScheduleScenario(6, 3, schedule([[1, 6, 3, 7], [2, 7, 3, 5], [2, 5, 3, 6], [1, 7, 2, 6], [1, 2, 5, 6], [1, 3, 5, 7]]), relaxedThreeThree),
  makeScheduleScenario(6, 4, schedule([[1, 2, 3, 4], [1, 5, 2, 6], [3, 5, 4, 6], [1, 3, 2, 4], [1, 6, 2, 5], [3, 6, 4, 5]])),
  makeScheduleScenario(7, 1, schedule([[1, 5, 6, 7], [1, 6, 8, 9], [5, 7, 9, 10], [1, 8, 5, 10], [6, 9, 8, 10], [1, 7, 6, 8], [5, 9, 7, 10]]), relaxedOneLevel1),
  makeScheduleScenario(7, 2, schedule([[1, 5, 2, 6], [5, 7, 8, 9], [1, 6, 2, 7], [1, 8, 2, 9], [5, 6, 7, 8], [1, 9, 2, 5], [6, 8, 7, 9]])),
  makeScheduleScenario(7, 3, schedule([[1, 5, 2, 6], [1, 7, 3, 8], [2, 5, 3, 6], [1, 6, 3, 7], [1, 8, 2, 7], [2, 8, 3, 5], [5, 6, 7, 8]])),
  makeScheduleScenario(7, 4, schedule([[1, 2, 3, 4], [1, 5, 2, 6], [3, 5, 4, 7], [1, 6, 2, 7], [1, 7, 4, 5], [2, 5, 3, 6], [3, 7, 4, 6]])),
  makeScheduleScenario(8, 2, schedule([[1, 5, 2, 6], [1, 8, 2, 9], [1, 7, 2, 10], [1, 9, 2, 8], [5, 6, 7, 10], [5, 7, 6, 10], [5, 10, 8, 9], [6, 8, 7, 9]])),
  makeScheduleScenario(8, 3, schedule([[1, 6, 2, 9], [1, 7, 3, 8], [2, 8, 3, 9], [5, 6, 7, 8], [1, 8, 2, 5], [1, 9, 3, 6], [2, 7, 3, 5], [5, 7, 6, 9]])),
  makeScheduleScenario(8, 4, schedule([[1, 2, 3, 4], [1, 3, 2, 4], [1, 5, 2, 6], [1, 6, 3, 8], [2, 5, 4, 7], [3, 7, 4, 8], [5, 6, 7, 8], [5, 7, 6, 8]])),
  makeScheduleScenario(9, 3, schedule([[1, 6, 2, 10], [1, 7, 3, 8], [2, 8, 3, 10], [5, 6, 7, 8], [1, 10, 3, 9], [1, 5, 2, 6], [5, 7, 9, 10], [2, 9, 3, 7], [5, 9, 6, 8]])),
  makeScheduleScenario(9, 4, schedule([[1, 2, 3, 4], [1, 3, 2, 4], [1, 6, 2, 9], [1, 5, 3, 6], [2, 7, 4, 8], [3, 8, 4, 9], [5, 6, 7, 8], [5, 7, 6, 9], [5, 8, 7, 9]])),
  makeScheduleScenario(10, 4, schedule([[1, 3, 2, 4], [1, 4, 2, 3], [1, 5, 3, 8], [2, 8, 3, 9], [2, 6, 4, 7], [1, 7, 4, 10], [5, 8, 6, 9], [6, 7, 9, 10], [5, 10, 8, 9], [5, 6, 7, 10]])),
  // Only reachable once the club has 11 members (4 Level 1 + 7 Level 2).
  makeScheduleScenario(7, 0, schedule([[5, 6, 9, 10], [7, 8, 5, 11], [9, 11, 8, 10], [6, 7, 5, 9], [10, 11, 6, 9], [7, 10, 8, 11], [6, 8, 5, 7]])),
  makeScheduleScenario(8, 1, schedule([[1, 11, 6, 8], [1, 7, 5, 10], [1, 9, 8, 11], [1, 6, 5, 9], [7, 10, 9, 11], [5, 8, 6, 10], [5, 7, 10, 11], [8, 9, 6, 7]]), relaxedOneLevel1),
  makeScheduleScenario(9, 2, schedule([[1, 5, 2, 9], [1, 11, 2, 8], [1, 10, 2, 7], [1, 6, 2, 11], [7, 9, 6, 10], [5, 8, 6, 9], [5, 7, 8, 11], [10, 11, 5, 9], [7, 10, 6, 8]])),
  makeScheduleScenario(10, 3, schedule([[1, 10, 2, 8], [1, 9, 3, 11], [2, 7, 3, 6], [1, 5, 2, 11], [1, 8, 3, 9], [2, 6, 3, 5], [7, 10, 9, 11], [5, 7, 6, 10], [6, 8, 9, 10], [5, 8, 7, 11]])),
  makeScheduleScenario(11, 4, schedule([[1, 3, 2, 4], [1, 4, 2, 3], [1, 6, 3, 5], [1, 11, 4, 9], [2, 10, 3, 8], [2, 7, 4, 8], [5, 9, 7, 11], [6, 10, 8, 9], [5, 6, 10, 11], [6, 7, 5, 8], [7, 10, 9, 11]])),
  // Only reachable once the club has 12 members (4 Level 1 + 8 Level 2).
  makeScheduleScenario(8, 0, schedule([[7, 9, 8, 11], [5, 6, 10, 12], [8, 10, 5, 9], [7, 12, 6, 11], [9, 10, 6, 7], [8, 12, 5, 11], [7, 11, 5, 10], [8, 9, 6, 12]])),
  makeScheduleScenario(9, 1, schedule([[1, 5, 6, 8], [1, 12, 9, 10], [1, 11, 5, 7], [1, 8, 6, 7], [9, 11, 10, 12], [5, 11, 9, 12], [6, 10, 7, 8], [10, 11, 8, 9], [7, 12, 5, 6]]), relaxedOneLevel1),
  makeScheduleScenario(10, 2, schedule([[1, 5, 2, 12], [1, 11, 2, 6], [1, 8, 2, 9], [1, 7, 2, 10], [5, 9, 8, 10], [11, 12, 6, 7], [5, 11, 8, 12], [7, 10, 6, 9], [8, 9, 6, 12], [5, 10, 7, 11]])),
  makeScheduleScenario(11, 3, schedule([[1, 11, 2, 10], [1, 9, 3, 7], [2, 12, 3, 6], [1, 8, 2, 5], [1, 10, 3, 12], [2, 11, 3, 8], [6, 9, 5, 7], [6, 10, 5, 8], [7, 12, 5, 11], [9, 10, 6, 12], [8, 11, 7, 9]])),
  makeScheduleScenario(12, 4, schedule([[1, 3, 2, 4], [1, 4, 2, 3], [1, 5, 3, 12], [1, 7, 4, 9], [2, 11, 3, 8], [2, 6, 4, 10], [5, 12, 8, 11], [6, 9, 7, 10], [6, 8, 9, 12], [7, 11, 5, 10], [6, 12, 9, 11], [8, 10, 5, 7]])),
];
const findScheduleScenario = (participantCount: number, level1Count: number) => {
  if (participantCount === 5) return scheduleScenarios.find((item) => item.participantCount === 5) ?? null;
  const scenario = scheduleScenarios.find((item) => item.participantCount === participantCount && item.level1Count === level1Count);
  return scenario ?? null;
};
const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthStartFromKey = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, 1);
};
const monthLabel = (date: Date) => `Tháng ${date.getMonth() + 1}, ${date.getFullYear()}`;
const monthDateFromLabel = (label: string) => {
  const match = label.match(/Tháng (\d+), (\d+)/);
  return match ? new Date(Number(match[2]), Number(match[1]) - 1, 1) : null;
};
const nextMonthStartDate = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 1);
const shortDateLabel = (date: Date) => date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
const sessionTitle = (date: Date) => `Buổi ${sessionWeekInMonth(date)} - ${sessionWeekdayLabel(date)} ngày ${shortDateLabel(date)}`;
function homeSession(now: Date) { const date = new Date(`${targetSessionDateKey(now)}T00:00:00`); return { date, state: sessionStateForDate(now) }; }
function monthlyProgress(now: Date) { const sessions = sessionDatesOfMonth(now); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); return { total: sessions.length, completed: sessions.filter((date) => date < today).length }; }
function finalSaturdayOfMonth(date: Date) { const finalSaturday = new Date(date.getFullYear(), date.getMonth() + 1, 0); while (finalSaturday.getDay() !== 6) finalSaturday.setDate(finalSaturday.getDate() - 1); return finalSaturday; }
const recentMonthStarts = (start: Date, count: number) => Array.from({ length: count }, (_, index) => new Date(start.getFullYear(), start.getMonth() - index, 1));
const sortMonthlyResultRows = (rows: MonthlyResultRow[]) => [...rows].sort((a, b) =>
  b.total_points - a.total_points ||
  b.point_diff - a.point_diff ||
  b.points_for - a.points_for ||
  a.matches_played - b.matches_played ||
  String(a.created_at || "").localeCompare(String(b.created_at || ""))
);
const rankingSort = (a: RankingRow, b: RankingRow) =>
  b.points - a.points ||
  b.pointDiff - a.pointDiff ||
  b.pointsWon - a.pointsWon ||
  a.matches - b.matches ||
  a.name.localeCompare(b.name, "vi");
const rankingCacheTtlMs = 5 * 60 * 1000;
const instantCacheTtlMs = 24 * 60 * 60 * 1000;
const homeSessionCacheTtlMs = 6 * 60 * 60 * 1000;
const homeSessionCacheKey = (sessionKey: string) => `aemit-home-session-cache-v2:${sessionKey}`;
type TimedCachePayload = { storedAt?: number };
type CachedHomeSessionPayload = HomeSessionPayload & { storedAt: number };
const readBrowserCache = <T extends TimedCachePayload>(key: string, maxAgeMs: number): T | null => {
  if (typeof window === "undefined") return null;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as T;
      if (!parsed.storedAt || Date.now() - parsed.storedAt > maxAgeMs) continue;
      return parsed;
    } catch {
      storage.removeItem(key);
    }
  }
  return null;
};
const writeBrowserCache = <T extends TimedCachePayload>(key: string, payload: T) => {
  if (typeof window === "undefined") return;
  const nextPayload = { ...payload, storedAt: payload.storedAt ?? Date.now() };
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage.setItem(key, JSON.stringify(nextPayload));
    } catch {
      // Storage can be unavailable in private browsing; fresh network data still works.
    }
  }
};
const removeBrowserCache = (key: string) => {
  if (typeof window === "undefined") return;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage cleanup errors.
    }
  }
};
const ENABLE_TEST_FLOW = process.env.NEXT_PUBLIC_ENABLE_TEST_FLOW === "true";
const TEMP_RESET_HOME_ATTENDANCE_FOR_TEST = false;
const initialMembers: Member[] = [
  { name: "Mạnh", initials: "M", level: 1, color: "#6846e8", present: false, username: "manh", password: "123456", role: "admin", responded: false },
  { name: "Hùng", initials: "H", level: 1, color: "#e56a4d", present: false, username: "hung", password: "123456", responded: false },
  { name: "Quý", initials: "Q", level: 1, color: "#2ba98b", present: false, username: "quy", password: "123456", responded: false },
  { name: "Thành", initials: "T", level: 1, color: "#e3a63c", present: false, username: "thanh", password: "123456", responded: false },
  { name: "Đạt", initials: "Đ", level: 2, color: "#e05591", present: false, username: "dat", password: "123456", responded: false },
  { name: "Nam", initials: "N", level: 2, color: "#4175e8", present: false, username: "nam", password: "123456", responded: false },
  { name: "Đức Anh", initials: "ĐA", level: 2, color: "#2f9c9f", present: false, username: "ducanh", password: "123456", responded: false },
  { name: "Sơn", initials: "S", level: 2, color: "#9c69e9", present: false, username: "son", password: "123456", responded: false },
  { name: "Hải", initials: "H", level: 2, color: "#ef8b3d", present: false, username: "hai", password: "123456" },
  { name: "Phú", initials: "P", level: 2, color: "#3f9c59", present: false, username: "phu", password: "123456", responded: false },
];

const memberPalette = ["#6846e8", "#e56a4d", "#2ba98b", "#e3a63c", "#e05591", "#4175e8", "#2f9c9f", "#9c69e9", "#ef8b3d", "#3f9c59"];
const memberInitials = (name: string) => name.trim().split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
const memberColorFor = (username: string) => memberPalette[[...username].reduce((sum, char) => sum + char.charCodeAt(0), 0) % memberPalette.length];
// The member list is built from active profiles: the founding ten keep their colours,
// members added later get a palette colour.
const memberFromProfile = (profile: SupabaseProfile, base?: Member): Member => {
  const username = String(profile.username || base?.username || "");
  const known = base ?? initialMembers.find((member) => member.username === username);
  const name = profile.full_name || known?.name || username;
  return {
    name,
    initials: known?.initials ?? memberInitials(name),
    level: Number(profile.level ?? known?.level ?? 2) === 1 ? 1 : 2,
    color: known?.color ?? memberColorFor(username),
    present: known?.present ?? false,
    username,
    password: known?.password ?? "",
    role: effectiveRole(profile.role, profile.description),
    responded: known?.responded ?? false,
  };
};
const memberOrderIndex = (username: string) => {
  const index = initialMembers.findIndex((member) => member.username === username);
  return index === -1 ? initialMembers.length : index;
};
const sortMembers = (members: Member[]) => [...members].sort((a, b) => memberOrderIndex(a.username) - memberOrderIndex(b.username) || a.name.localeCompare(b.name, "vi"));
const avatarUsername = (username?: string | null) => String(username || "").trim().toLowerCase();
// profiles.avatar_url by username (Cloudinary); a member without one shows a blank avatar.
const memberAvatars = new Map<string, string>();
const memberAvatarsCacheKey = "aemit-member-avatars";
type MemberAvatarsCache = { avatars: [string, string][]; storedAt?: number };
const avatarImageUrl = (username?: string | null) => memberAvatars.get(avatarUsername(username)) ?? null;
const hasAvatarArt = (username?: string | null) => Boolean(avatarImageUrl(username));
const avatarStyle = (person: { color?: string | null; username?: string | null }) => {
  const url = avatarImageUrl(person.username);
  return {
    "--avatar-color": person.color || "#6846e8",
    "--avatar-image": url ? `url("${url}")` : "none",
  } as CSSProperties;
};
const avatarClassName = (baseClassName: string, person: { username?: string | null }) => `${baseClassName}${hasAvatarArt(person.username) ? " avatar-art" : ""}`;

export default function Home() {
  const [screen, setScreen] = useState<Screen>(screenFromLocation);
  const [rankingMonth, setRankingMonth] = useState(() => {
    const initialNow = new Date();
    return monthLabel(ENABLE_TEST_FLOW ? homeSession(initialNow).date : initialNow);
  });
  const [step, setStep] = useState(0);
  const [members, setMembers] = useState(initialMembers);
  const [drawn, setDrawn] = useState<Record<string, number>>({});
  const [scores, setScores] = useState<Record<number, [string, string]>>({});
  const savedMatchRows = useRef<Set<number>>(new Set());
  const editingScoreRows = useRef<Set<number>>(new Set());
  const [confirmedMatches, setConfirmedMatches] = useState<Record<number, boolean>>({});
  const [activeUser, setActiveUser] = useState<Member | null>(null);
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinPopupMode, setCheckinPopupMode] = useState<"auto" | "manual" | null>(null);
  const [dismissedCheckinPromptKey, setDismissedCheckinPromptKey] = useState<string | null>(null);
  const [loginError, setLoginError] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [spinTarget, setSpinTarget] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("draft");
  const [rankingRows, setRankingRows] = useState<RankingRow[]>([]);
  const [currentRankingRows, setCurrentRankingRows] = useState<RankingRow[]>([]);
  const [liveRankingRows, setLiveRankingRows] = useState<RankingRow[]>([]);
  const [previousRankingRows, setPreviousRankingRows] = useState<RankingRow[]>([]);
  const [championRankingRows, setChampionRankingRows] = useState<RankingRow[]>([]);
  const [, setAvatarRevision] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  const closeCelebration = useCallback(() => setCelebrating(false), []);
  const [eloRows, setEloRows] = useState<EloRankingRow[]>([]);
  const [eloStatus, setEloStatus] = useState<EloStatus | null>(null);
  const [formByUsername, setFormByUsername] = useState<FormByUsername>({});
  const [championRankingLabel, setChampionRankingLabel] = useState(() => {
    const initialDate = new Date();
    return monthLabel(new Date(initialDate.getFullYear(), initialDate.getMonth() - 1, 1));
  });
  const [historySessions, setHistorySessions] = useState<HistorySession[]>([]);
  const [confirmation, setConfirmation] = useState<{ title: string; message: string; action: () => void | Promise<void> } | null>(null);
  const [attendanceChangeNotice, setAttendanceChangeNotice] = useState<string | null>(null);
  const [showProfileCard, setShowProfileCard] = useState(false);
  const [authRestoring, setAuthRestoring] = useState(Boolean(supabase));
  const [now, setNow] = useState(() => new Date());
  const [attendanceSynced, setAttendanceSynced] = useState(!supabase);
  const [rankingRefreshTick, setRankingRefreshTick] = useState(0);
  const [historyRefreshTick, setHistoryRefreshTick] = useState(0);
  const [monthCloseStatus, setMonthCloseStatus] = useState<MonthCloseStatus | null>(null);
  const [monthCloseNotice, setMonthCloseNotice] = useState("");
  const [closingMonth, setClosingMonth] = useState(false);
  const currentDateLabel = now.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).toUpperCase();
  const activeUsername = activeUser?.username;
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthKey = localDateKey(currentMonthStart);
  const currentMonthLabel = monthLabel(currentMonthStart);
  const session = homeSession(now);
  const sessionMonthStart = new Date(session.date.getFullYear(), session.date.getMonth(), 1);
  const sessionMonthKey = localDateKey(sessionMonthStart);
  const sessionMonthLabel = monthLabel(sessionMonthStart);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const rankingMonthOptions = [...new Set([sessionMonthStart, currentMonthStart, previousMonthStart, new Date(now.getFullYear(), now.getMonth() - 2, 1)].map(monthLabel))].filter((month) => !hiddenRankingMonths.has(month));
  const previousMonthKey = localDateKey(previousMonthStart);
  const isLiveCheckinWindow = isCheckinWindowOpenForDate(now);
  const isCheckinTestMode = ENABLE_TEST_FLOW && !isLiveCheckinWindow;
  const isCheckinWindowOpen = ENABLE_TEST_FLOW || isLiveCheckinWindow;
  const shouldLoadHomeSession = ENABLE_TEST_FLOW || isLiveCheckinWindow;
  const sessionDateKey = localDateKey(session.date);
  const currentCheckinPromptKey = `${activeUsername || "guest"}:${sessionId || sessionDateKey}`;
  const signedInMember = activeUsername ? members.find((member) => member.username === activeUsername) : null;
  const signedInMemberPresent = Boolean(signedInMember?.present);
  const calendarProgress = monthlyProgress(now);
  const completedSessionsThisMonth = historySessions.filter((historySession) => {
    const date = new Date(`${historySession.date}T00:00:00`);
    return date.getFullYear() === currentMonthStart.getFullYear() && date.getMonth() === currentMonthStart.getMonth();
  }).length;
  const progress = {
    ...calendarProgress,
    completed: supabase ? Math.min(calendarProgress.total, completedSessionsThisMonth) : calendarProgress.completed,
  };
  const present = members.filter((m) => m.present);
  const notAttending = members.filter((m) => m.responded && !m.present);
  const level1PresentCount = present.filter((m) => m.level === 1).length;
  const level2PresentCount = present.length - level1PresentCount;
  const validDrawn = Object.fromEntries(present.flatMap((member) => {
    const slot = drawn[member.name];
    return typeof slot === "number" && isDrawSlotValid(member.level, slot, level1PresentCount, level2PresentCount, present.length) ? [[member.name, slot]] : [];
  })) as Record<string, number>;
  const currentScheduleScenario = findScheduleScenario(present.length, level1PresentCount);
  const canSchedule = present.length >= 5 && Boolean(currentScheduleScenario);
  const allAttendanceDone = members.every((m) => m.responded);
  const allDrawn = present.length > 0 && present.every((member) => typeof validDrawn[member.name] === "number");
  const drawOpen = ["checked_in", "drawn", "scheduled", "completed"].includes(sessionStatus);
  const scheduleOpen = ["scheduled", "completed"].includes(sessionStatus);
  const steps = ["Điểm danh", "Chọn số", "Lịch thi đấu"];
  // Whether the workflow tab `next` can be opened right now (mirrors the checks in goStep).
  const canGoStep = (next: number) => {
    if (next === 0) return true;
    const isManager = isScoreManagerRole(activeUser?.role);
    if (!isManager && !signedInMemberPresent) return false;
    if (next > step && !isManager) return next === 1 ? drawOpen : next === 2 ? scheduleOpen && Boolean(currentScheduleScenario) : false;
    if (next > step + 1) return false;
    if (next === 1 && !drawOpen && (!isCheckinWindowOpen || !canSchedule || !allAttendanceDone)) return false;
    if (next === 2 && (!scheduleOpen || !currentScheduleScenario || !allDrawn)) return false;
    return true;
  };
  const goStep = (next: number) => {
    if (next === 0) {
      setLoginError("");
      setStep(0);
      return;
    }
    if (!isScoreManagerRole(activeUser?.role) && !signedInMemberPresent) {
      setStep(0);
      return setLoginError("Bạn cần cập nhật điểm danh sang tham gia trước khi vào chọn số, lịch thi đấu hoặc xem kết quả buổi này.");
    }
    if (next > step && !isScoreManagerRole(activeUser?.role)) {
      if (next === 1 && drawOpen) return setStep(1);
      if (next === 2 && scheduleOpen && currentScheduleScenario) return setStep(2);
      return;
    }
    if (next > step + 1 || (next === 1 && !drawOpen && (!isCheckinWindowOpen || !canSchedule || !allAttendanceDone)) || (next === 2 && (!scheduleOpen || !currentScheduleScenario || !allDrawn))) return;
    setStep(next);
  };
  const closeCheckinPopup = () => {
    setShowCheckin(false);
    setCheckinPopupMode(null);
  };
  const dismissCheckinPopupToAttendance = () => {
    setDismissedCheckinPromptKey(currentCheckinPromptKey);
    closeCheckinPopup();
    setScreen("home");
    setStep(0);
  };
  const applyHomeSessionPayload = useCallback((payload: HomeSessionPayload) => {
    if (payload.sessionId) setSessionId(payload.sessionId);
    if (payload.status) setSessionStatus(payload.status);
    const attendanceRows = payload.attendances || [];
    const nextDrawn: Record<string, number> = {};
    // Every active member has an attendance row for the session, so the rows define the member list.
    setMembers((previous) => {
      const rows = attendanceRows.flatMap((attendance) => {
        const profile = Array.isArray(attendance.profiles) ? attendance.profiles[0] : attendance.profiles;
        return profile?.username ? [{ attendance, profile }] : [];
      });
      if (!rows.length) return previous.map((member) => ({ ...member, present: false, responded: false }));
      return sortMembers(rows.map(({ attendance, profile }) => {
        const base = previous.find((member) => member.username === profile.username);
        const member = memberFromProfile({ ...profile, level: attendance.level_at_time ?? profile.level }, base);
        if (attendance.choice === "attending" && typeof attendance.drawn_number === "number") nextDrawn[member.name] = attendance.drawn_number;
        return { ...member, present: attendance.choice === "attending", responded: attendance.choice !== "pending" };
      }));
    });
    setDrawn(nextDrawn);
  }, []);

  const signIn = async (username: string, password: string) => {
    const normalized = username.trim().toLowerCase();
    if (supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email: `${normalized}@anhemit.club`, password });
      if (error) return setLoginError("Tên đăng nhập hoặc mật khẩu chưa đúng.");
      const localUser = members.find((m) => m.username === normalized);
      if (localUser) {
        setActiveUser(localUser);
        setLoginError("");
        closeCheckinPopup();
      }
      const { data: profile } = await supabase.from("profiles").select("full_name, username, level, role, description").eq("username", normalized).single();
      if (profile) {
        setActiveUser(memberFromProfile(profile, localUser)); setLoginError(""); closeCheckinPopup(); return;
      }
      if (localUser) return;
    }
    const user = members.find((m) => m.username === normalized && m.password === password);
    if (!user) return setLoginError("Tên đăng nhập hoặc mật khẩu chưa đúng.");
    setActiveUser(user); setLoginError(""); closeCheckinPopup();
  };
  const checkInSelf = async (attending: boolean) => {
    if (!activeUser) return;
    if (supabase) {
      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (!authSession?.access_token) return setLoginError("Bạn cần đăng nhập lại để lưu điểm danh.");
        const response = await fetch("/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authSession.access_token}` },
          body: JSON.stringify({ sessionId, attending }),
        });
        const payload = await response.json().catch(() => ({ error: "Không thể lưu điểm danh." })) as HomeSessionPayload;
        if (!response.ok) return setLoginError(payload.error || "Không thể lưu điểm danh.");
        writeBrowserCache(homeSessionCacheKey(sessionDateKey), { ...payload, storedAt: Date.now() });
        applyHomeSessionPayload(payload);
        if (payload.needsReset) {
          setDrawn({});
          setScores({});
          setConfirmedMatches({});
          setRankingRefreshTick((tick) => tick + 1);
          setAttendanceChangeNotice("Điểm danh đã thay đổi nên buổi này cần xác nhận lại trước khi chọn số.");
        } else if (payload.scheduleCleared || payload.drawsReassigned) {
          if (payload.scheduleCleared) {
            setScores({});
            setConfirmedMatches({});
            setRankingRefreshTick((tick) => tick + 1);
          }
          setAttendanceChangeNotice(payload.scheduleCleared
            ? "Điểm danh đã thay đổi nên lịch/kết quả cũ đã được làm mới, số đã bốc được random lại tự động."
            : "Điểm danh đã thay đổi nên các số đã bốc được random lại tự động. Người chưa có số tiếp tục chọn số.");
        }
        setActiveUser({ ...activeUser, present: attending, responded: true });
        closeCheckinPopup();
        setScreen("home");
        if (attending) {
          setDismissedCheckinPromptKey(null);
          const nextStatus = payload.status || sessionStatus;
          if (["checked_in", "drawn", "scheduled", "completed"].includes(nextStatus)) setStep(1);
          else setStep(0);
        } else {
          setDismissedCheckinPromptKey(currentCheckinPromptKey);
          setStep(0);
        }
      } catch (error) {
        setLoginError(error instanceof Error ? error.message : "Không thể lưu điểm danh.");
      }
      return;
    }
    const updated = members.map((m) => m.username === activeUser.username ? { ...m, present: attending, responded: true } : m);
    if (!supabase) localStorage.setItem("aemit-attendance", JSON.stringify(updated));
    setMembers(updated);
    setActiveUser({ ...activeUser, present: attending, responded: true });
    closeCheckinPopup();
    setScreen("home");
    if (attending) {
      setDismissedCheckinPromptKey(null);
      if (drawOpen) setStep(1);
    } else {
      setDismissedCheckinPromptKey(currentCheckinPromptKey);
      setStep(0);
    }
  };
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const restoreSession = async () => {
      const { data: { session: savedSession } } = await client.auth.getSession();
      const username = savedSession?.user.email?.split("@")[0];
      if (username) {
        const localUser = initialMembers.find((member) => member.username === username);
        if (localUser) {
          setActiveUser(localUser);
          setAuthRestoring(false);
        }
        const { data: profile } = await client.from("profiles").select("full_name, username, level, role, description").eq("username", username).single();
        if (profile) setActiveUser(memberFromProfile(profile, localUser));
      }
      setAuthRestoring(false);
    };
    void restoreSession();
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("aemit-current-screen", screen);
    const nextHash = `#${screen}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    }
  }, [screen]);
  useEffect(() => {
    const syncScreenFromHash = () => {
      const nextScreen = screenFromLocation();
      setScreen((current) => current === nextScreen ? current : nextScreen);
    };
    window.addEventListener("hashchange", syncScreenFromHash);
    return () => window.removeEventListener("hashchange", syncScreenFromHash);
  }, []);
  useEffect(() => {
    if (supabase) {
      localStorage.removeItem("aemit-attendance");
      localStorage.removeItem("aemit-drawn-slots");
      return;
    }
    if (TEMP_RESET_HOME_ATTENDANCE_FOR_TEST) {
      localStorage.removeItem("aemit-attendance-session");
      localStorage.removeItem("aemit-attendance");
      localStorage.removeItem("aemit-drawn-slots");
      window.queueMicrotask(() => {
        setMembers(initialMembers.map((member) => ({ ...member, present: false, responded: false })));
        setDrawn({});
        setStep(0);
      });
    } else {
      const saved = localStorage.getItem("aemit-attendance");
      if (saved) window.queueMicrotask(() => setMembers(JSON.parse(saved) as Member[]));
    }
    const syncAttendance = (event: StorageEvent) => { if (event.key === "aemit-attendance" && event.newValue) setMembers(JSON.parse(event.newValue)); };
    window.addEventListener("storage", syncAttendance);
    return () => window.removeEventListener("storage", syncAttendance);
  }, []);
  useEffect(() => {
    if (!supabase || !activeUsername) return;
    let cancelled = false;
    const showAvatars = (avatars: [string, string][]) => {
      memberAvatars.clear();
      avatars.forEach(([username, url]) => memberAvatars.set(username, url));
      setAvatarRevision((revision) => revision + 1);
    };
    // The last known list first, so avatars do not flash blank on every load.
    const cached = readBrowserCache<MemberAvatarsCache>(memberAvatarsCacheKey, instantCacheTtlMs);
    if (cached) window.queueMicrotask(() => { if (!cancelled) showAvatars(cached.avatars); });
    void supabase.from("profiles").select("username, avatar_url").not("avatar_url", "is", null).then(({ data }) => {
      if (cancelled || !data) return;
      const avatars = data.map((profile): [string, string] => [avatarUsername(profile.username), profile.avatar_url]);
      showAvatars(avatars);
      writeBrowserCache<MemberAvatarsCache>(memberAvatarsCacheKey, { avatars });
    });
    return () => { cancelled = true; };
  }, [activeUsername]);
  useEffect(() => {
    if (!supabase || !activeUsername) return;
    const client = supabase;
    let cancelled = false;
    const cacheKey = homeSessionCacheKey(sessionDateKey);
    const applyPendingProfiles = (profiles: SupabaseProfile[]) => {
      setMembers((previous) => {
        const active = profiles.filter((profile) => profile.username);
        if (!active.length) return previous.map((member) => ({ ...member, present: false, responded: false }));
        return sortMembers(active.map((profile) => ({ ...memberFromProfile(profile, previous.find((member) => member.username === profile.username)), present: false, responded: false })));
      });
    };
    const resetHomeWorkflow = async () => {
      const { data: profiles } = await client.from("profiles").select("id, username, full_name, level, role, description").eq("is_active", true).order("full_name");
      if (cancelled) return;
      applyPendingProfiles((profiles || []) as SupabaseProfile[]);
      setSessionId(null);
      setSessionStatus("draft");
      setDrawn({});
      setScores({});
      setConfirmedMatches({});
      setStep(0);
      setAttendanceSynced(true);
      removeBrowserCache(cacheKey);
      if (checkinPopupMode === "auto") closeCheckinPopup();
    };
    if (!shouldLoadHomeSession) {
      void resetHomeWorkflow();
      return () => { cancelled = true; };
    }
    const cachedHomeSession = readBrowserCache<CachedHomeSessionPayload>(cacheKey, homeSessionCacheTtlMs);
    if (cachedHomeSession?.sessionId && !cachedHomeSession.inactive) {
      applyHomeSessionPayload(cachedHomeSession);
      setAttendanceSynced(true);
    } else {
      setAttendanceSynced(false);
    }
    const loadLiveAttendance = async () => {
      try {
        const { data: { session: authSession } } = await client.auth.getSession();
        const response = await fetch("/api/home-session", {
          headers: { ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}) },
        });
        const payload = await response.json().catch(() => ({ error: "Không thể tải phiên điểm danh." })) as HomeSessionPayload;
        if (cancelled) return;
        if (!response.ok) {
          setLoginError(payload.error || "Không thể tải phiên điểm danh.");
          return;
        }
        if (payload.inactive || !payload.sessionId) {
          removeBrowserCache(cacheKey);
          await resetHomeWorkflow();
          return;
        }
        writeBrowserCache(cacheKey, { ...payload, storedAt: Date.now() });
        applyHomeSessionPayload(payload);
      } finally {
        if (!cancelled) setAttendanceSynced(true);
      }
    };
    void loadLiveAttendance();
    const channel = client.channel("club-attendance-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendances" }, loadLiveAttendance)
      .on("postgres_changes", { event: "*", schema: "public", table: "play_sessions" }, loadLiveAttendance)
      .subscribe();
    return () => { cancelled = true; void client.removeChannel(channel); };
  }, [activeUsername, applyHomeSessionPayload, checkinPopupMode, sessionDateKey, shouldLoadHomeSession]);
  useEffect(() => {
    if (!activeUsername) return;
    const syncedUser = members.find((member) => member.username === activeUsername);
    if (!syncedUser) return;
    setActiveUser((current) => {
      if (!current || current.username !== syncedUser.username) return current;
      if (current.name === syncedUser.name && current.level === syncedUser.level && current.role === syncedUser.role && current.present === syncedUser.present && current.responded === syncedUser.responded) return current;
      return { ...current, name: syncedUser.name, level: syncedUser.level, role: syncedUser.role, present: syncedUser.present, responded: syncedUser.responded };
    });
    if (!isCheckinWindowOpen) {
      if (checkinPopupMode === "auto") closeCheckinPopup();
      return;
    }
    if (supabase && !attendanceSynced) return;
    if (!syncedUser.responded) {
      if (dismissedCheckinPromptKey === currentCheckinPromptKey) return;
      setCheckinPopupMode("auto");
      setShowCheckin(true);
      return;
    }
    if (checkinPopupMode === "auto") closeCheckinPopup();
  }, [activeUsername, attendanceSynced, checkinPopupMode, currentCheckinPromptKey, dismissedCheckinPromptKey, isCheckinWindowOpen, members]);
  useEffect(() => {
    if (supabase || !sessionId || now.getDay() !== 3) return;
    const storedSessionId = localStorage.getItem("aemit-attendance-session");
    if (storedSessionId === sessionId) return;
    const resetMembers = members.map((member) => ({ ...member, present: false, responded: false }));
    localStorage.setItem("aemit-attendance-session", sessionId);
    localStorage.setItem("aemit-attendance", JSON.stringify(resetMembers));
    localStorage.removeItem("aemit-drawn-slots");
    window.queueMicrotask(() => {
      setMembers(resetMembers);
      setDrawn({});
      setStep(0);
    });
  }, [members, sessionId, now]);
  useEffect(() => {
    if (!supabase || !activeUsername) return;
    const client = supabase;
    const selectedMonthDate = monthDateFromLabel(rankingMonth) ?? new Date();
    const month = localDateKey(selectedMonthDate);
    const selectedNextMonthDate = nextMonthStartDate(selectedMonthDate);
    const selectedNextMonthKey = localDateKey(selectedNextMonthDate);
    const selectedFinalSaturdayKey = localDateKey(finalSaturdayOfMonth(selectedMonthDate));
    const rankingCacheKey = `aemit-ranking-cache-v4:${month}:${currentMonthKey}:${sessionMonthKey}:${previousMonthKey}`;
    const appDataCacheKey = `aemit-app-data-cache-v4:${month}:${currentMonthKey}:${sessionMonthKey}:${previousMonthKey}`;
    const loadRanking = async () => {
      const useAggregatedAppData = true;
      const applyAppData = (payload: AppDataCachePayload) => {
        setRankingRows(payload.rankingRows);
        setCurrentRankingRows(payload.currentRankingRows);
        setLiveRankingRows(payload.liveRankingRows);
        setPreviousRankingRows(payload.previousRankingRows);
        setChampionRankingRows(payload.championRankingRows);
        setChampionRankingLabel(payload.championRankingLabel);
        setEloRows(payload.eloRows || []);
        setEloStatus(payload.eloStatus || null);
        setFormByUsername(payload.formByUsername || {});
        setHistorySessions(payload.historySessions);
        setMonthCloseStatus(payload.monthCloseStatus);
      };
      if (useAggregatedAppData) {
        const cached = readBrowserCache<AppDataCachePayload>(appDataCacheKey, instantCacheTtlMs);
        if (cached) applyAppData(cached);
        try {
          const { data: { session: authSession } } = await client.auth.getSession();
          const params = new URLSearchParams({ month, currentMonth: currentMonthKey, sessionMonth: sessionMonthKey, previousMonth: previousMonthKey });
          const response = await fetch(`/api/app-data?${params.toString()}`, {
            headers: { ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}) },
            cache: "no-store",
          });
          const payload = await response.json().catch(() => ({ error: "Không thể tải dữ liệu CLB." })) as AppDataCachePayload & { error?: string };
          if (!response.ok) {
            setLoginError(payload.error || "Không thể tải dữ liệu CLB.");
            return;
          }
          const nextPayload = { ...payload, storedAt: Date.now() } satisfies AppDataCachePayload;
          setLoginError("");
          applyAppData(nextPayload);
          writeBrowserCache(appDataCacheKey, nextPayload);
        } catch (error) {
          setLoginError(error instanceof Error ? error.message : "Không thể tải dữ liệu CLB.");
        }
        return;
      }
      const rankingSelect = "month, total_points, points_for, points_against, point_diff, matches_played, level_next_month, created_at, profiles!monthly_results_member_id_fkey(id, username, full_name, level)";
      const championMonthDates = recentMonthStarts(monthStartFromKey(currentMonthKey), 12);
      const championMonthKeys = championMonthDates.map(localDateKey);
      const championFinalSessionKeys = championMonthDates.map((date) => localDateKey(finalSaturdayOfMonth(date)));
      const colorForIndex = (index: number) => ["#e7ad26", "#6ba9de", "#df8d2a", "#6846e8", "#e56a4d", "#2ba98b"][index % 6];
      const initialsFromName = (name: string) => name.split(" ").map((part: string) => part[0]).slice(-2).join("");
      const zeroRowsFromProfiles = (profiles: SupabaseProfile[]) => [...profiles]
        .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""), "vi"))
        .map((profile, index) => {
          const name = profile.full_name || "Thành viên";
          return { username: profile.username || name, name, initials: initialsFromName(name), level: Number(profile.level || 2), points: 0, pointsWon: 0, pointsLost: 0, pointDiff: 0, matches: 0, color: colorForIndex(index), placeholder: true };
        });
      const mapRows = (rows: MonthlyResultRow[]) => rows.map((row, index) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        const name = profile?.full_name || "Thành viên";
        return { username: profile?.username || name, name, initials: initialsFromName(name), level: Number(profile?.level || row.level_next_month || 2), points: row.total_points, pointsWon: row.points_for, pointsLost: row.points_against, pointDiff: row.point_diff, matches: row.matches_played, color: colorForIndex(index), placeholder: row.matches_played === 0 };
      });
      const buildRankingRows = (rows: MonthlyResultRow[], profiles: SupabaseProfile[]) => {
        if (!profiles.length) return mapRows(rows);
        const hasMatchData = rows.some((row) => row.matches_played > 0);
        if (!hasMatchData) return zeroRowsFromProfiles(profiles);
        const rowsByUsername = new Map(rows.flatMap((row) => {
          const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
          return profile?.username ? [[profile.username, row] as const] : [];
        }));
        const mergedRows = profiles.map((profile, index) => {
          const row = profile.username ? rowsByUsername.get(profile.username) : undefined;
          const name = profile.full_name || "Thành viên";
          if (!row) return { username: profile.username || name, name, initials: initialsFromName(name), level: Number(profile.level || 2), points: 0, pointsWon: 0, pointsLost: 0, pointDiff: 0, matches: 0, color: colorForIndex(index), placeholder: true };
          return { username: profile.username || name, name, initials: initialsFromName(name), level: Number(profile.level || row.level_next_month || 2), points: row.total_points, pointsWon: row.points_for, pointsLost: row.points_against, pointDiff: row.point_diff, matches: row.matches_played, color: colorForIndex(index), placeholder: row.matches_played === 0 };
        });
        return mergedRows.sort(rankingSort);
      };
      try {
        const cached = window.sessionStorage.getItem(rankingCacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as RankingCachePayload;
          if (Date.now() - parsed.storedAt < rankingCacheTtlMs) {
            setRankingRows(parsed.rankingRows);
            setCurrentRankingRows(parsed.currentRankingRows);
            setLiveRankingRows(parsed.liveRankingRows);
            setPreviousRankingRows(parsed.previousRankingRows);
            setChampionRankingRows(parsed.championRankingRows);
            setChampionRankingLabel(parsed.championRankingLabel);
          }
        }
      } catch {
        window.sessionStorage.removeItem(rankingCacheKey);
      }
      const requestedRankingMonths = [...new Set([month, currentMonthKey, sessionMonthKey, previousMonthKey, ...championMonthKeys])];
      const [{ data: allRankingData }, { data: championFinalSessions }, { data: activeProfiles }, { data: finalSession }, { count: nextMonthRows }] = await Promise.all([
        client.from("monthly_results").select(rankingSelect).in("month", requestedRankingMonths),
        client.from("play_sessions").select("session_date, status").in("session_date", championFinalSessionKeys),
        client.from("profiles").select("id, username, full_name, level").eq("is_active", true).order("full_name"),
        client.from("play_sessions").select("status").eq("session_date", selectedFinalSaturdayKey).maybeSingle(),
        client.from("monthly_results").select("id", { count: "exact", head: true }).eq("month", selectedNextMonthKey),
      ]);
      const rankingRowsByMonth = new Map<string, MonthlyResultRow[]>();
      ((allRankingData || []) as MonthlyResultRow[]).forEach((row) => {
        if (!row.month) return;
        const rows = rankingRowsByMonth.get(row.month) ?? [];
        rows.push(row);
        rankingRowsByMonth.set(row.month, rows);
      });
      const selectedRows = rankingRowsByMonth.get(month) ?? [];
      const activeProfileRows = (activeProfiles || []) as SupabaseProfile[];
      const currentRowsForCalendarMonth = rankingRowsByMonth.get(currentMonthKey) ?? [];
      const liveRowsForSessionMonth = rankingRowsByMonth.get(sessionMonthKey) ?? [];
      const nextRankingRows = buildRankingRows(selectedRows, activeProfileRows);
      const nextCurrentRankingRows = buildRankingRows(currentRowsForCalendarMonth, activeProfileRows);
      const nextLiveRankingRows = buildRankingRows(liveRowsForSessionMonth, activeProfileRows);
      const nextPreviousRankingRows = mapRows(sortMonthlyResultRows(rankingRowsByMonth.get(previousMonthKey) ?? []));
      setRankingRows(nextRankingRows);
      setCurrentRankingRows(nextCurrentRankingRows);
      setLiveRankingRows(nextLiveRankingRows);
      setPreviousRankingRows(nextPreviousRankingRows);
      const championRowsByMonth = rankingRowsByMonth;
      let nextChampionRankingRows: RankingRow[] = [];
      let nextChampionRankingLabel = monthLabel(monthStartFromKey(previousMonthKey));
      const completedFinalSessionDates = new Set(((championFinalSessions || []) as { session_date: string; status: string | null }[])
        .filter((sessionRow) => sessionRow.status === "completed")
        .map((sessionRow) => sessionRow.session_date));
      const latestChampionMonth = championMonthDates.find((date) => {
        const monthKey = localDateKey(date);
        const monthRows = championRowsByMonth.get(monthKey) ?? [];
        const hasRealRanking = monthRows.some((row) => row.matches_played > 0);
        const isPastMonth = monthKey < currentMonthKey;
        const finalSessionCompleted = completedFinalSessionDates.has(localDateKey(finalSaturdayOfMonth(date)));
        return hasRealRanking && (isPastMonth || finalSessionCompleted);
      });
      if (latestChampionMonth) {
        const championMonthKey = localDateKey(latestChampionMonth);
        nextChampionRankingRows = mapRows(sortMonthlyResultRows(championRowsByMonth.get(championMonthKey) ?? []));
        nextChampionRankingLabel = monthLabel(latestChampionMonth);
      }
      setChampionRankingRows(nextChampionRankingRows);
      setChampionRankingLabel(nextChampionRankingLabel);
      window.sessionStorage.setItem(rankingCacheKey, JSON.stringify({
        rankingRows: nextRankingRows,
        currentRankingRows: nextCurrentRankingRows,
        liveRankingRows: nextLiveRankingRows,
        previousRankingRows: nextPreviousRankingRows,
        championRankingRows: nextChampionRankingRows,
        championRankingLabel: nextChampionRankingLabel,
        storedAt: Date.now(),
      } satisfies RankingCachePayload));
      const currentRows = selectedRows.length;
      const finalSessionCompleted = finalSession?.status === "completed";
      const closed = Boolean(nextMonthRows && nextMonthRows > 0);
      setMonthCloseStatus({
        monthKey: month,
        monthLabel: monthLabel(selectedMonthDate),
        nextMonthKey: selectedNextMonthKey,
        nextMonthLabel: monthLabel(selectedNextMonthDate),
        finalSessionCompleted,
        closed,
        eligible: finalSessionCompleted && currentRows > 0 && !closed,
        currentRows,
        message: closed ? `Đã tạo BXH ${monthLabel(selectedNextMonthDate)}.` : !currentRows ? "Tháng này chưa có dữ liệu BXH để chốt." : !finalSessionCompleted ? "Buổi cuối tháng chưa hoàn tất nhập điểm." : "Sẵn sàng chốt BXH và tạo tháng mới.",
      });
    };
    void loadRanking();
  }, [activeUsername, rankingMonth, currentMonthKey, previousMonthKey, sessionMonthKey, rankingRefreshTick, historyRefreshTick]);
  useEffect(() => {
    if (!supabase || !activeUsername) return;
    const client = supabase;
    const channel = client
      .channel("club-ranking-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_results" }, () => {
        setRankingRefreshTick((tick) => tick + 1);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "elo_ratings" }, () => {
        setRankingRefreshTick((tick) => tick + 1);
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [activeUsername]);
  useEffect(() => {
    if (!attendanceChangeNotice) return;
    const timer = window.setTimeout(() => setAttendanceChangeNotice(null), 9_000);
    return () => window.clearTimeout(timer);
  }, [attendanceChangeNotice]);
  useEffect(() => {
    if (!supabase || !showProfileCard) return;
    const timer = window.setInterval(() => {
      setRankingRefreshTick((tick) => tick + 1);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [showProfileCard]);
  const closeRankingMonth = async () => {
    if (!supabase || !monthCloseStatus || closingMonth) return;
    if (!monthCloseStatus.eligible) {
      setMonthCloseNotice(monthCloseStatus.message);
      return;
    }
    setClosingMonth(true);
    setLoginError("");
    setMonthCloseNotice("");
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const response = await fetch("/api/month-close", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}) },
        body: JSON.stringify({ month: monthCloseStatus.monthKey }),
      });
      const payload = await response.json().catch(() => ({ error: "Không thể chốt BXH tháng." })) as { error?: string; alreadyClosed?: boolean; nextMonth?: string; memberCount?: number; promotedCount?: number };
      if (!response.ok) {
        setMonthCloseNotice(payload.error || "Không thể chốt BXH tháng.");
        return;
      }
      setRankingRefreshTick((tick) => tick + 1);
      setMonthCloseNotice(payload.alreadyClosed ? `${monthCloseStatus.monthLabel} đã được chốt trước đó; BXH ${monthCloseStatus.nextMonthLabel} đã sẵn sàng.` : `Đã chốt ${monthCloseStatus.monthLabel} và tạo BXH ${monthCloseStatus.nextMonthLabel} cho ${payload.memberCount || "toàn bộ"} thành viên.`);
      setRankingMonth(monthCloseStatus.nextMonthLabel);
    } catch (error) {
      setMonthCloseNotice(error instanceof Error ? error.message : "Không thể chốt BXH tháng.");
    } finally {
      setClosingMonth(false);
    }
  };
  useEffect(() => {
    if (!supabase || !activeUsername) return;
    const historyLoadedByAppData = Boolean(activeUsername);
    if (historyLoadedByAppData) return;
    const client = supabase;
    const historyCacheKey = "aemit-history-cache-v3";
    const loadHistory = async () => {
      try {
        const cached = window.sessionStorage.getItem(historyCacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { sessions: HistorySession[]; storedAt: number };
          if (Date.now() - parsed.storedAt < rankingCacheTtlMs) setHistorySessions(parsed.sessions);
        }
      } catch {
        window.sessionStorage.removeItem(historyCacheKey);
      }
      const { data } = await client.from("play_sessions").select("id, session_date, matches(match_no, team_a, team_b), attendances(choice)").eq("status", "completed").order("session_date", { ascending: false });
      if (!data) return;
      const nextSessions = (data as HistorySessionRow[]).map((session) => {
        const matchAttendees = attendeeCountFromMatches(session.matches);
        return {
          id: session.id,
          date: session.session_date,
          matches: matchCountFromHistoryRows(session.matches),
          attendees: matchAttendees || attendeeCountFromAttendances(session.attendances),
        };
      });
      setHistorySessions(nextSessions);
      window.sessionStorage.setItem(historyCacheKey, JSON.stringify({ sessions: nextSessions, storedAt: Date.now() }));
    };
    void loadHistory();
  }, [activeUsername, historyRefreshTick]);
  useEffect(() => {
    if (!supabase || !activeUsername) return;
    const client = supabase;
    const refreshHistory = () => setHistoryRefreshTick((tick) => tick + 1);
    const channel = client
      .channel("club-history-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "play_sessions" }, refreshHistory)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, refreshHistory)
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [activeUsername]);
  useEffect(() => {
    setScores({});
    setConfirmedMatches({});
    savedMatchRows.current = new Set();
    if (!supabase || !sessionId) return;
    const client = supabase;
    let cancelled = false;
    const loadSavedMatches = async () => {
      const { data } = await client.from("matches").select("match_no, score_a, score_b").eq("session_id", sessionId).order("match_no");
      if (cancelled) return;
      const rows = (data || []) as SavedMatchRow[];
      const nextScores: Record<number, [string, string]> = {};
      const nextConfirmed: Record<number, boolean> = {};
      rows.forEach((match) => {
        if (typeof match.score_a === "number" && typeof match.score_b === "number") {
          nextScores[match.match_no - 1] = [String(match.score_a), String(match.score_b)];
          nextConfirmed[match.match_no - 1] = true;
        }
      });
      // Boxes still being typed in stay, including a saved match being edited; a row that was saved
      // before and is gone now was deleted.
      const previouslySaved = savedMatchRows.current;
      savedMatchRows.current = new Set(Object.keys(nextScores).map(Number));
      setScores((current) => mergeSavedScores(current, nextScores, previouslySaved, editingScoreRows.current));
      setConfirmedMatches(nextConfirmed);
    };
    void loadSavedMatches();
    const channel = client.channel("club-match-results").on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `session_id=eq.${sessionId}` }, loadSavedMatches).subscribe();
    return () => { cancelled = true; void client.removeChannel(channel); };
  }, [sessionId]);
  const drawSelf = async () => {
    if (!activeUser || spinning) return;
    const self = members.find((member) => member.username === activeUser.username) ?? activeUser;
    if (!self.present) return setLoginError("Bạn cần điểm danh tham gia trước khi chọn số.");
    if (validDrawn[self.name]) return;
    setLoginError("");
    setSpinTarget(null);
    setSpinning(true);
    const applySelectedSlot = (selected: number) => {
      setDrawn((previous) => {
        const next = { ...previous, [self.name]: selected };
        if (!supabase) localStorage.setItem("aemit-drawn-slots", JSON.stringify(next));
        return next;
      });
    };
    const revealAfterSpin = (selected: number, autoAssigned = false) => {
      if (autoAssigned) {
        applySelectedSlot(selected);
        setSpinning(false);
        setSpinTarget(null);
        return;
      }
      setSpinTarget(selected);
      window.setTimeout(() => {
        applySelectedSlot(selected);
        setSpinning(false);
        setSpinTarget(null);
      }, 3900);
    };
    try {
      if (supabase && sessionId) {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        const response = await fetch("/api/draw-slot", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}) },
          body: JSON.stringify({ sessionId }),
        });
        const payload = await response.json().catch(() => ({ error: "Không thể chọn số lúc này." })) as { drawnNumber?: number; error?: string; autoAssigned?: boolean };
        if (!response.ok || typeof payload.drawnNumber !== "number") throw new Error(payload.error || "Không thể chọn số lúc này.");
        revealAfterSpin(payload.drawnNumber, payload.autoAssigned);
        return;
      }
      const latest = JSON.parse(localStorage.getItem("aemit-drawn-slots") || "{}") as Record<string, number>;
      const pool = drawSlotsForLevel(self.level, level1PresentCount, level2PresentCount, present.length);
      const usedSlots = present.flatMap((member) => {
        const slot = latest[member.name];
        return typeof slot === "number" && isDrawSlotValid(member.level, slot, level1PresentCount, level2PresentCount, present.length) ? [slot] : [];
      });
      const available = pool.filter((slot) => !usedSlots.includes(slot));
      if (!available.length) throw new Error("Không còn số trống trong dải Level của bạn.");
      const selected = available[Math.floor(Math.random() * available.length)];
      revealAfterSpin(selected, available.length === 1);
    } catch (error) {
      window.setTimeout(() => {
        setSpinning(false);
        setSpinTarget(null);
        setLoginError(error instanceof Error ? error.message : "Không thể chọn số lúc này.");
      }, 800);
    }
  };
  const confirmScheduleFromDraw = async () => {
    if (!allDrawn || !currentScheduleScenario) return setLoginError("Cần tất cả người tham gia chọn số trước khi tạo lịch.");
    if (supabase && !sessionId) return setLoginError("Phiên điểm danh chưa sẵn sàng. Vui lòng tải lại trang hoặc thử lại sau vài giây.");
    if (supabase && sessionId) {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const response = await fetch("/api/session-status", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}) },
        body: JSON.stringify({ sessionId, status: "scheduled" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Không thể xác nhận lịch thi đấu." }));
        return setLoginError(payload.error || "Không thể xác nhận lịch thi đấu.");
      }
    }
    setSessionStatus("scheduled");
    writeBrowserCache(homeSessionCacheKey(sessionDateKey), {
      sessionId,
      sessionDate: sessionDateKey,
      status: "scheduled",
      attendances: members.map((member) => ({
        choice: member.present ? "attending" : member.responded ? "absent" : "pending",
        drawn_number: typeof drawn[member.name] === "number" ? drawn[member.name] : null,
        profiles: {
          username: member.username,
          full_name: member.name,
          level: member.level,
          role: member.role,
        },
      })),
      storedAt: Date.now(),
    });
    setStep(2);
  };
  const confirmAttendanceAndOpenDraw = async () => {
    if (supabase) {
      if (!sessionId) return setLoginError("Phiên điểm danh chưa sẵn sàng. Vui lòng tải lại trang hoặc thử lại sau vài giây.");
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const response = await fetch("/api/confirm-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}) },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Không thể xác nhận điểm danh." }));
        return setLoginError(payload.error || "Không thể xác nhận điểm danh.");
      }
    }
    setLoginError("");
    setSessionStatus("checked_in");
    writeBrowserCache(homeSessionCacheKey(sessionDateKey), {
      sessionId,
      sessionDate: sessionDateKey,
      status: "checked_in",
      attendances: members.map((member) => ({
        choice: member.present ? "attending" : member.responded ? "absent" : "pending",
        drawn_number: typeof drawn[member.name] === "number" ? drawn[member.name] : null,
        profiles: {
          username: member.username,
          full_name: member.name,
          level: member.level,
          role: member.role,
        },
      })),
      storedAt: Date.now(),
    });
    setStep(1);
  };

  useEffect(() => {
    if (!activeUser || screen !== "home") return;
    const isScoreManager = isScoreManagerRole(activeUser.role);
    if (!isScoreManager && !signedInMemberPresent) {
      setStep(0);
      return;
    }
    if ((sessionStatus === "scheduled" || sessionStatus === "completed") && currentScheduleScenario && allDrawn) {
      setStep((current) => Math.max(current, 2));
      return;
    }
    if (drawOpen && canSchedule && allAttendanceDone) {
      setStep((current) => current > 1 ? 1 : Math.max(current, 1));
      return;
    }
    setStep((current) => current > 0 ? 0 : current);
  }, [activeUser, allAttendanceDone, allDrawn, canSchedule, currentScheduleScenario, drawOpen, screen, sessionStatus, signedInMemberPresent]);

  useEffect(() => {
    const trigger = document.querySelector(".welcome-member");
    const toggleProfile = () => setShowProfileCard((open) => !open);
    let pointerDownTarget: EventTarget | null = null;
    const rememberPointerDown = (event: PointerEvent) => { pointerDownTarget = event.target; };
    const closeOutside = (event: MouseEvent) => {
      const target = pointerDownTarget ?? event.target;
      pointerDownTarget = null;
      if (!(target instanceof Element)) return;
      if (!target.closest(".welcome-member, .member-profile-popover")) setShowProfileCard(false);
      if (!target.closest(".sidebar, .mobile-menu")) setSidebarOpen(false);
      if (target.closest(".modal-backdrop") && !target.closest(".checkin-modal, .confirm-modal, .history-detail, .member-editor, .member-detail-modal, .elo-guide-modal, .photo-sheet, .photo-preview, .photo-confirm-backdrop")) {
        (document.querySelector(".presence:not(.presence-leaving) .modal-backdrop .modal-close") as HTMLButtonElement | null)?.click();
      }
    };
    trigger?.addEventListener("click", toggleProfile);
    document.addEventListener("pointerdown", rememberPointerDown);
    document.addEventListener("click", closeOutside);
    return () => {
      trigger?.removeEventListener("click", toggleProfile);
      document.removeEventListener("pointerdown", rememberPointerDown);
      document.removeEventListener("click", closeOutside);
    };
  }, [activeUser]);
  useEffect(() => {
    if (activeUser && activeUser.role !== "admin" && screen === "members") setScreen("home");
  }, [activeUser, screen]);
  if (!activeUser && authRestoring) return <main className="login-page"><div className="login-card"><p>Đang khôi phục phiên đăng nhập...</p></div></main>;
  if (!activeUser) return <Login onLogin={signIn} error={loginError} />;
  const currentUser = members.find((member) => member.username === activeUser.username) ?? activeUser;
  const isAdmin = currentUser.role === "admin";
  const canManageSession = isScoreManagerRole(currentUser.role);
  const canManageScores = canManageSession;
  const welcomeRows = championRankingRows.length ? championRankingRows : previousRankingRows.length ? previousRankingRows : rankingRows;
  const welcomeRank = welcomeRows.findIndex((row) => row.name === currentUser.name) + 1;
  const welcomeRankClass = welcomeRank > 0 && welcomeRank <= 3 ? `rank-${welcomeRank}` : "rank-none";
  const profileRows = ENABLE_TEST_FLOW ? (liveRankingRows.length ? liveRankingRows : currentRankingRows) : (currentRankingRows.length ? currentRankingRows : rankingRows);
  const profileAchievementMonth = ENABLE_TEST_FLOW ? sessionMonthLabel : currentMonthLabel;
  const profileRank = profileRows.findIndex((row) => row.name === currentUser.name) + 1;
  const profileAchievement = profileRank > 0 ? profileRows[profileRank - 1] : null;
  const profileHasRankingData = Boolean(profileAchievement && !profileAchievement.placeholder && profileAchievement.matches > 0);
  const profileRankClass = profileHasRankingData && profileRank > 0 && profileRank <= 3 ? `rank-${profileRank}` : "rank-none";
  const profileElo = eloRows.find((row) => row.username === currentUser.username || row.name === currentUser.name) ?? null;
  const champion = championRankingRows[0];

  return <main className={"app-shell " + (sidebarOpen ? "sidebar-open" : "")}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true" /><div><b>ANH EM IT</b><small>BADMINTON CLUB</small></div></div>
      <nav onClick={() => setSidebarOpen(false)}>
        <button className={screen === "home" ? "active" : ""} onClick={() => setScreen("home")}><AppIcon name="home" className="nav-app-icon" /> Home</button>
        {isAdmin && <button className={screen === "members" ? "active" : ""} onClick={() => setScreen("members")}><AppIcon name="members" className="nav-app-icon" /> Thành viên</button>}
        <button className={screen === "schedules" ? "active" : ""} onClick={() => setScreen("schedules")}><AppIcon name="schedule" className="nav-app-icon" /> Lịch thi đấu</button>
        <button className={screen === "ranking" ? "active" : ""} onClick={() => { setScreen("ranking"); setRankingMonth(ENABLE_TEST_FLOW ? sessionMonthLabel : currentMonthLabel); }}><AppIcon name="ranking" className="nav-app-icon" /> Bảng xếp hạng</button>
        <button className={screen === "elo" ? "active" : ""} onClick={() => setScreen("elo")}><AppIcon name="target" className="nav-app-icon" /> ELO</button>
        <button className={screen === "history" ? "active" : ""} onClick={() => setScreen("history")}><AppIcon name="history" className="nav-app-icon" /> Lịch sử thi đấu</button>
        <button className={screen === "photos" ? "active" : ""} onClick={() => setScreen("photos")}><AppIcon name="photos" className="nav-app-icon" /> Kho ảnh</button>
        <button className={screen === "rules" ? "active" : ""} onClick={() => setScreen("rules")}><AppIcon name="rules" className="nav-app-icon" /> Thể lệ</button>
      </nav>
      <div className="club-card"><AppIcon name="trophy" className="club-card-icon" /><b>{currentMonthLabel}</b><small>{progress.completed} / {progress.total} buổi đã hoàn thành</small><div className="progress"><i style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }} /></div>{champion ? <button type="button" className="club-top1" aria-label={`Chúc mừng nhà vô địch ${champion.name}`} onClick={() => { setSidebarOpen(false); setCelebrating(true); }}><small>NHÀ VÔ ĐỊCH {championRankingLabel.toUpperCase()}</small><div className="club-top1-winner"><div className={avatarClassName("avatar small", champion)} style={avatarStyle(champion)}>{champion.initials}</div><div><b><AppIcon name="crown" className="inline-app-icon" /> {champion.name}</b><span>{`${champion.points} điểm · ${champion.pointDiff > 0 ? "+" : ""}${champion.pointDiff} hiệu số`}</span></div></div></button> : <div className="club-top1 empty"><small>NHÀ VÔ ĐỊCH {championRankingLabel.toUpperCase()}</small><b>Chưa ghi danh</b><span>{`Chưa có dữ liệu BXH ${championRankingLabel}.`}</span></div>}</div>
      <div className="profile"><div className={avatarClassName("avatar small", currentUser)} style={avatarStyle(currentUser)}>{currentUser.initials}</div><div><b>{currentUser.name}</b><small>{memberRoleLabel(currentUser.role)}</small></div><button className="logout" aria-label="Đăng xuất" title="Đăng xuất" onClick={() => { setSidebarOpen(false); setLogoutConfirmOpen(true); }}>Đăng xuất</button></div>
    </aside>
    <Presence show={Boolean(logoutConfirmOpen)}>{logoutConfirmOpen && <ConfirmActionModal icon="logout" title="Đăng xuất?" message="Bạn có chắc muốn đăng xuất khỏi tài khoản này không?" confirmLabel="Đăng xuất" cancelLabel="Hủy" onCancel={() => setLogoutConfirmOpen(false)} onConfirm={() => { setLogoutConfirmOpen(false); void supabase?.auth.signOut(); setActiveUser(null); }} />}</Presence>
    <section className="content">
      <header><div className="title-group"><button className="mobile-menu" aria-label="Mở menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}><span /><span /><span /></button><div><p className="eyebrow">{currentDateLabel}</p><h1>{screenTitles[screen]}</h1></div></div><p className={`welcome-member ${welcomeRankClass}`} aria-label={`Xin chào ${currentUser.name}, Level ${currentUser.level}`}><span className={avatarClassName("welcome-avatar", currentUser)} style={avatarStyle(currentUser)} aria-hidden="true">{welcomeRank > 0 && welcomeRank <= 3 ? welcomeRank : currentUser.initials}</span><span className="welcome-text"><span className="welcome-line"><span className="welcome-copy">Xin chào!</span><b>{currentUser.name}</b></span><span className="welcome-level">Level {currentUser.level}</span></span></p></header>
      <div className="screen-view" key={screen}>{screen === "members" ? <Members members={members} rankingRows={profileRows} rankingMonth={profileAchievementMonth} eloRows={eloRows} formByUsername={formByUsername} onAvatarUpdated={(username, avatarUrl) => { if (avatarUrl) memberAvatars.set(username, avatarUrl); else memberAvatars.delete(username); removeBrowserCache(memberAvatarsCacheKey); setAvatarRevision((revision) => revision + 1); }} onRoleUpdated={(username, role) => setMembers((previous) => previous.map((member) => member.username === username ? { ...member, role } : member))} /> : screen === "rules" ? <Rules members={members} /> : screen === "schedules" ? <ScheduleLibrary scenarios={scheduleScenarios} members={members} /> : screen === "ranking" ? <Ranking month={rankingMonth} rows={rankingRows} form={formByUsername} elo={Object.fromEntries(eloRows.map((row) => [row.username, row.eloRating]))} onMonthChange={(month) => { setMonthCloseNotice(""); setRankingMonth(month); }} monthOptions={rankingMonthOptions} isAdmin={isAdmin} closeStatus={monthCloseStatus} closeNotice={monthCloseNotice} closingMonth={closingMonth} onCloseMonth={closeRankingMonth} /> : screen === "elo" ? <EloRanking rows={eloRows} status={eloStatus} /> : screen === "history" ? <History sessions={historySessions} currentMonth={currentMonthLabel} /> : screen === "photos" ? <PhotoGallery /> : <>
        <section className="hero">
          <div className="hero-copy"><span className="live-dot">● {session.state}</span><h2>{sessionTitle(session.date)}</h2><p>07:00 – 09:00</p></div>
          <img className="hero-logo" src="/club-logo.png?v=club-glass-logo" alt="" aria-hidden="true" />
          <div className="hero-stats"><div><b>{present.length}</b><small>THAM GIA</small></div><div><b>{notAttending.length}</b><small>KHÔNG THAM GIA</small></div><div><b>{String(step + 1).padStart(2, "0")}<em>/{String(steps.length).padStart(2, "0")}</em></b><small>BƯỚC HIỆN TẠI</small></div></div>
        </section>
        <section className="workflow">{steps.map((label, i) => <button key={label} className={i === step ? "current" : i < step ? "done" : canGoStep(i) ? "" : "locked"} aria-disabled={i !== step && !canGoStep(i)} onClick={() => goStep(i)}><span>{i < step ? "✓" : i + 1}</span>{label}</button>)}</section>
        {loginError && <div className="warning">{loginError}</div>}
        {attendanceChangeNotice && <div className="warning">{attendanceChangeNotice}</div>}
        {step === 0 && <CheckIn members={members} setMembers={setMembers} onContinue={() => setConfirmation({ title: "Xác nhận điểm danh", message: "Mở chọn số sau khi xác nhận toàn bộ thành viên đã phản hồi?", action: confirmAttendanceAndOpenDraw })} canSchedule={canSchedule} canManageSession={canManageSession} currentUser={currentUser} isCheckinWindowOpen={isCheckinWindowOpen} isCheckinTestMode={isCheckinTestMode} openSelfCheckin={() => { setCheckinPopupMode("manual"); setShowCheckin(true); }} />}
        {step === 1 && <Draw members={present} drawn={validDrawn} allDrawn={allDrawn} drawSelf={drawSelf} spinning={spinning} spinTarget={spinTarget} currentUser={currentUser} canManageSession={canManageSession} onContinue={() => setConfirmation({ title: "Xác nhận tạo lịch", message: "Tạo lịch thi đấu từ kết quả chọn số hiện tại?", action: confirmScheduleFromDraw })} />}
        {step === 2 && <Schedule onEditingChange={(rows) => { editingScoreRows.current = new Set(rows); }} scenario={currentScheduleScenario} drawn={validDrawn} scores={scores} setScores={setScores} confirmedMatches={confirmedMatches} setConfirmedMatches={setConfirmedMatches} sessionId={sessionId} canManageScores={canManageScores} rankingRows={liveRankingRows} rankingMonth={sessionMonthLabel} onSaved={(completed) => { setSessionStatus(completed ? "completed" : "scheduled"); if (completed) setHistoryRefreshTick((tick) => tick + 1); setRankingMonth(ENABLE_TEST_FLOW ? sessionMonthLabel : currentMonthLabel); setRankingRefreshTick((tick) => tick + 1); }} />}
      </>}</div>
    </section>
    <Presence show={Boolean(showCheckin)}>{showCheckin && <CheckinModal member={activeUser} onAnswer={(attending) => { closeCheckinPopup(); if (!attending) setDismissedCheckinPromptKey(currentCheckinPromptKey); setConfirmation({ title: "Xác nhận điểm danh", message: attending ? "Bạn xác nhận tham gia buổi chơi này?" : "Bạn xác nhận không tham gia buổi chơi này?", action: () => checkInSelf(attending) }); }} onSkip={dismissCheckinPopupToAttendance} />}</Presence>
    <Presence show={Boolean(confirmation)}>{confirmation && <ConfirmActionModal title={confirmation.title} message={confirmation.message} onCancel={() => setConfirmation(null)} onConfirm={async () => { await confirmation.action(); setConfirmation(null); }} />}</Presence>
    <Presence show={celebrating && Boolean(champion)}>{champion && <ChampionCelebration name={champion.name} crown={<AppIcon name="crown" />} avatar={<div className={avatarClassName("avatar", champion)} style={avatarStyle(champion)}>{champion.initials}</div>} onClose={closeCelebration} />}</Presence>
    <Presence show={Boolean(showProfileCard)}>{showProfileCard && <ProfilePopover member={currentUser} rank={profileRank} achievement={profileAchievement} achievementMonth={profileAchievementMonth} rankClass={profileRankClass} hasRankingData={profileHasRankingData} elo={profileElo} form={formByUsername[currentUser.username]} onClose={() => setShowProfileCard(false)} />}</Presence>
  </main>;
}

// Last four results, oldest → newest (latest on the right); empty slots when fewer matches exist.
function FormBadges({ form, className = "" }: { form?: FormResult[]; className?: string }) {
  const recent = [...(form ?? [])].slice(0, 4).reverse();
  const label = recent.length ? `Phong độ ${recent.length} trận gần nhất: ${recent.map((entry) => (entry.result === "W" ? "thắng" : "thua")).join(", ")}` : "Chưa có trận nào";
  const formatDay = (date: string) => date.split("-").reverse().slice(0, 2).join("/");
  return <div className={`form-badges ${className}`.trim()} role="img" aria-label={label}>
    {recent.map((entry, index) => <span key={index} className={`form-badge ${entry.result === "W" ? "form-win" : "form-loss"}`} title={`${entry.result === "W" ? "Thắng" : "Thua"} ${entry.score} · ${formatDay(entry.date)}`}>{entry.result}</span>)}
    {Array.from({ length: 4 - recent.length }, (_, index) => <span key={`empty-${index}`} className="form-badge form-empty" />)}
  </div>;
}

function ProfilePopover({ detail = false, member, rank, achievement, achievementMonth, rankClass, hasRankingData, elo, form, onClose }: { detail?: boolean; member: Member; rank: number; achievement: RankingRow | null; achievementMonth: string; rankClass: string; hasRankingData: boolean; elo: EloRankingRow | null; form?: FormResult[]; onClose: () => void }) {
  const isTopRank = hasRankingData && rank > 0 && rank <= 3;
  const pointDiff = achievement?.pointDiff;
  const pointDiffLabel = typeof pointDiff === "number" ? `${pointDiff > 0 ? "+" : ""}${pointDiff}` : "0";
  const positionLabel = hasRankingData && rank > 0 ? `Top ${rank}` : "—";
  const positionDisplay = isTopRank ? (rank === 1 ? <><AppIcon name="trophy" className="inline-app-icon" /> Top 1</> : `Top ${rank}`) : positionLabel;
  const points = achievement?.points ?? 0;
  const pointsWon = achievement?.pointsWon ?? 0;
  const pointsLost = achievement?.pointsLost ?? 0;
  const matches = achievement?.matches ?? 0;
  const roleLabel = memberRoleLabel(member.role);
  const eloDisplay = typeof elo?.eloRating === "number" ? elo.eloRating.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "1.000,0";
  const eloRankDisplay = typeof elo?.rank === "number" ? `Top ${elo.rank} ELO` : "ELO hiện tại";
  return <aside className={`member-profile-popover profile-${rankClass}${detail ? " member-detail-modal" : ""}`} role="dialog" aria-modal="true" aria-label={`Thông tin hồ sơ ${member.name}`}>
    <button className="modal-close profile-close" onClick={onClose} aria-label="Đóng">×</button>
    <div className="profile-hero-card">
      <span className={avatarClassName("profile-medal", member)} style={avatarStyle(member)} aria-hidden="true">{isTopRank ? rank : member.initials}</span>
      <div className="profile-identity">
        <p>{hasRankingData && rank > 0 ? `${positionLabel} · ${achievementMonth}` : "Hồ sơ tháng hiện tại"}</p>
        <h2>{member.name}</h2>
        {detail && <span className="profile-username">@{member.username}</span>}
        <span className="profile-role-line">{roleLabel} · Level {member.level}</span>
        <span className="profile-elo-badge"><strong>ELO {eloDisplay}</strong><em>{eloRankDisplay}</em></span>
      </div>
    </div>
    <div className="profile-score-card">
      <div>
        <span>Thành tích {achievementMonth}</span>
        <b>{points} điểm</b>
      </div>
      <small>{hasRankingData ? `${matches} trận · hiệu số ${pointDiffLabel}` : "Chưa có trận trong tháng này."}</small>
    </div>
    <div className="profile-form">
      <span>Phong độ 4 trận gần nhất</span>
      <FormBadges form={form} />
    </div>
    <div className="profile-stat-grid">
      <div className="profile-stat profile-rank-stat"><span>Vị trí</span><b>{positionDisplay}</b></div>
      <div className="profile-stat"><span>Level</span><b>{member.level}</b></div>
      <div className="profile-stat"><span>Điểm thắng</span><b>{pointsWon}</b></div>
      <div className="profile-stat"><span>Điểm thua</span><b>{pointsLost}</b></div>
      <div className={`profile-stat ${typeof pointDiff === "number" ? pointDiff >= 0 ? "positive" : "negative" : ""}`}><span>Hiệu số</span><b>{pointDiffLabel}</b></div>
      <div className="profile-stat"><span>Số trận</span><b>{matches}</b></div>
    </div>
  </aside>;
}

function CheckIn({ members, onContinue, canSchedule, canManageSession, currentUser, isCheckinWindowOpen, openSelfCheckin }: { members: Member[]; setMembers: (m: Member[]) => void; onContinue: () => void; canSchedule: boolean; canManageSession: boolean; currentUser: Member; isCheckinWindowOpen: boolean; isCheckinTestMode: boolean; openSelfCheckin: () => void }) {
  const n = members.filter((m) => m.present).length;
  const l1 = members.filter((m) => m.present && m.level === 1).length;
  const l2 = n - l1;
  const allResponded = members.every((m) => m.responded);
  return <section className="panel checkin">
    <div className="panel-head checkin-head"><div><h2>Điểm danh thành viên</h2></div><div className="count-pill attendance-count-pill"><b>{n}</b><span>có mặt</span></div></div>
    <div className="member-grid">{members.map((m) => <div className="member-card readonly" key={m.name}><div className={avatarClassName("avatar", m)} style={avatarStyle(m)}>{m.initials}</div><div><b>{m.name}{m.name === currentUser.name && <em>Bạn</em>}</b><small>Level {m.level} · {m.responded ? <span className={"attendance-status " + (m.present ? "present" : "absent")}>{m.present ? "Tham gia" : "Không tham gia"}</span> : <span className="attendance-status pending">Chưa phản hồi</span>}</small></div><span className={"attendance-mark " + (!m.responded ? "waiting" : m.present ? "yes" : "no")}>{m.responded ? (m.present ? "✓" : "×") : ""}</span></div>)}</div>
    {isCheckinWindowOpen && !canSchedule && <div className="warning">{n < 5 ? "Cần tối thiểu 5 người có mặt để tạo lịch thi đấu tự động." : `Chưa có mẫu lịch phù hợp cho ${n} người (${l1} Level 1 + ${l2} Level 2).`}</div>}
    <div className="panel-foot checkin-actions-foot"><div className="attendance-actions"><button className="soft-btn" disabled={!isCheckinWindowOpen} onClick={openSelfCheckin}>{isCheckinWindowOpen ? (currentUser.responded ? "Cập nhật điểm danh của tôi" : "Điểm danh của tôi") : "Mở vào thứ Tư"}</button>{canManageSession && <button className="primary" disabled={!isCheckinWindowOpen || !canSchedule || !allResponded} onClick={onContinue}>Xác nhận điểm danh & mở chọn số <span>→</span></button>}</div></div>
  </section>;
}
function Draw({ members, drawn, allDrawn, drawSelf, spinning, spinTarget, currentUser, canManageSession, onContinue }: { members: Member[]; drawn: Record<string, number>; allDrawn: boolean; drawSelf: () => void; spinning: boolean; spinTarget: number | null; currentUser: Member; canManageSession: boolean; onContinue: () => void }) {
  const participantCount = members.length;
  const level1Count = members.filter((member) => member.level === 1).length;
  const level2Count = members.length - level1Count;
  const pool = drawSlotsForLevel(currentUser.level, level1Count, level2Count, participantCount);
  const rangeLabel = drawSlotRangeLabel(currentUser.level, level1Count, level2Count, participantCount);
  const actualMine = drawn[currentUser.name];
  const mine = spinning ? undefined : actualMine;
  const drawnForWheel = Object.entries(drawn).filter(([name]) => !(spinning && name === currentUser.name));
  const usedSlots = new Set(drawnForWheel.map(([, slot]) => slot).filter((slot) => pool.includes(slot)));
  const availableSlots = pool.filter((slot) => !usedSlots.has(slot));
  const wheelSlots = availableSlots.length ? availableSlots : pool;
  const targetIndex = typeof spinTarget === "number" ? wheelSlots.indexOf(spinTarget) : -1;
  const targetAngle = targetIndex >= 0 && wheelSlots.length > 1 ? (targetIndex + 0.5) * (360 / wheelSlots.length) : 0;
  const isWheelSpinning = spinning && typeof spinTarget === "number";
  const isHoldingSlot = spinning && typeof spinTarget !== "number";
  const spinDeg = 1440 - targetAngle;
  const isOpenFive = participantCount === 5;
  const modeLabel = isOpenFive ? "Số 1–5" : `Level ${currentUser.level}`;
  const autoLastSlot = !mine && currentUser.present && availableSlots.length === 1 ? availableSlots[0] : null;
  const entries = members.map((member) => ({ member, no: spinning && member.name === currentUser.name ? undefined : drawn[member.name] }));
  const wheelStyle = { "--spin-duration": "3.9s", "--spin-deg": `${spinDeg}deg`, "--wheel-gradient": wheelGradient(wheelSlots.length || 1) } as CSSProperties;
  return <section className="panel draw-panel">
    <div className="panel-head draw-panel-head"><div><h2>Chọn số ngẫu nhiên</h2></div><span className="mode draw-mode-pill">{modeLabel}</span></div>
    <div className="draw-body">
      <div className={"wheel level-wheel level-wheel-" + (isOpenFive ? "open" : currentUser.level)} style={wheelStyle}>
        <span className="wheel-pointer" aria-hidden="true" />
        <div className={"wheel-disc" + (isWheelSpinning ? " spinning" : "")}>
          <div className="wheel-numbers">{wheelSlots.map((slot, index) => {
            const angle = wheelSlots.length === 1 ? 0 : (index + 0.5) * (360 / wheelSlots.length);
            return <span className={`wheel-number ${drawNumberClass(slot, participantCount)}`} key={slot} style={{ "--slot-angle": `${angle}deg`, "--slot-angle-inverse": `${-angle}deg` } as CSSProperties}>{slot}</span>;
          })}</div>
        </div>
        <div className="wheel-inner">{isWheelSpinning || isHoldingSlot ? <b>…<small>{isHoldingSlot ? "Đang giữ số" : "Đang quay"}</small></b> : mine ? <b>{mine}<small>Số của bạn</small></b> : autoLastSlot ? <b>{autoLastSlot}<small>Số cuối</small></b> : <b>?</b>}</div>
      </div>
      <div className="draw-copy"><span className="tag draw-range-tag">Chọn số · {rangeLabel}</span><h2>{isWheelSpinning ? "Vòng quay đang chọn số…" : isHoldingSlot ? "Đang giữ số hợp lệ…" : mine ? "Bạn đã chọn xong" : currentUser.present ? (autoLastSlot ? "Bạn là người cuối trong dải số này" : "Đến lượt bạn chọn số") : "Bạn chưa điểm danh tham gia"}</h2><button className="primary" disabled={spinning || !currentUser.present || Boolean(mine)} onClick={drawSelf}>{spinning ? "Đang xử lý…" : mine ? "Đã có số" : autoLastSlot ? "Nhận số cuối cùng" : "Chọn số của tôi"} <span>↻</span></button></div>
    </div>
    <div className="draw-list draw-roster">{entries.map(({ member, no }) => <div className={no ? "drawn" : "pending"} key={member.username}><span>{member.name}</span><b>{no ?? "—"}</b><small>Level {member.level}</small></div>)}</div>
    {canManageSession && <div className="panel-foot draw-actions-foot"><button className="primary" disabled={!allDrawn} onClick={onContinue}>Tạo lịch thi đấu <span>→</span></button></div>}
  </section>;
}
function Schedule({ onEditingChange, scenario, drawn, scores, setScores, confirmedMatches, setConfirmedMatches, sessionId, canManageScores, rankingRows, rankingMonth, onSaved }: { onEditingChange: (rows: number[]) => void; scenario: ScheduleScenario | null; drawn: Record<string, number>; scores: Record<number, [string, string]>; setScores: Dispatch<SetStateAction<Record<number, [string, string]>>>; confirmedMatches: Record<number, boolean>; setConfirmedMatches: Dispatch<SetStateAction<Record<number, boolean>>>; sessionId: string | null; canManageScores: boolean; rankingRows: RankingRow[]; rankingMonth: string; onSaved: (completed: boolean) => void }) {
  const namesBySlot = Object.fromEntries(Object.entries(drawn).map(([name, no]) => [no, name])) as Record<number, string>;
  if (!scenario) return <section className="panel"><div className="panel-head"><div><h2>Lịch thi đấu tự động</h2><p>Lịch chỉ được tạo khi có tối thiểu 5 thành viên và đúng tổ hợp trong thư viện lịch.</p></div></div><div className="empty-ranking">Chưa có lịch phù hợp cho danh sách điểm danh hiện tại.</div></section>;
  return <>
    <section className="panel combined-schedule-panel">
      <div className="panel-head"><div><h2>Lịch thi đấu & nhập điểm</h2></div><span className="count-pill schedule-count-pill">{scenario.matches.length} trận</span></div>
      <div className="schedule-grid">{scenario.matches.map((match, i) => <Match match={match} i={i} namesBySlot={namesBySlot} key={i} />)}</div>
    </section>
    <Results key={`${sessionId ?? "local"}-${scenario.id}`} onEditingChange={onEditingChange} matches={scenario.matches} drawn={drawn} scores={scores} setScores={setScores} confirmedMatches={confirmedMatches} setConfirmedMatches={setConfirmedMatches} sessionId={sessionId} canManageScores={canManageScores} onSaved={onSaved} />
    <LiveRankingSnapshot rows={rankingRows} month={rankingMonth} />
  </>;
}
function Rules({ members }: { members: Member[] }) {
  // Grouped by the live level (top 4 ELO = Level 1), so the list never goes stale.
  const levelGroups = ([1, 2] as const).map((level) => ({
    level,
    title: level === 1 ? "Top 4 ELO" : "Còn lại",
    note: level === 1 ? "Nhóm có ELO cao nhất tại thời điểm hiện hành." : "Nhóm còn lại theo BXH ELO; tự cập nhật khi ELO thay đổi.",
    names: members.filter((member) => member.level === level).map((member) => member.name),
  }));

  return <section className="rules-page">
    <PageHero
      eyebrow="BỘ LUẬT CLB"
      title="Giải cầu lông Anh Em IT"
      description="Lịch đấu được tạo để mọi thành viên có số trận cân bằng, gặp nhiều đối thủ khác nhau và vẫn giữ tinh thần vui vẻ, cạnh tranh lành mạnh."
      statsLabel="Tóm tắt thể lệ"
      stats={[{ label: "Thể thức đánh đôi", value: "2 vs 2" }, { label: "Trận mỗi người / tuần", value: 4 }, { label: "Người tối đa / buổi", value: 12 }]}
    />

    <section className="rules-section" aria-labelledby="rules-process-title">
      <h2 className="rules-section-title" id="rules-process-title">Quy trình tham gia</h2>
      <ol className="rules-steps">
        <li><span className="rules-step-no">01</span><div><h3>Điểm danh</h3><p>Thành viên xác nhận tham gia hoặc không tham gia trước khi lập lịch.</p></div></li>
        <li><span className="rules-step-no">02</span><div><h3>Chọn số</h3><p>Buổi 5 người chọn số 1–5 không phân Level; từ 6 người trở lên, Level 1 nhận số 1–4 và Level 2 nhận số từ 5 trở đi theo số người thực tế.</p></div></li>
        <li><span className="rules-step-no">03</span><div><h3>Thi đấu & nhập điểm</h3><p>Admin xác nhận từng trận, BXH tháng cập nhật ngay sau mỗi kết quả được lưu.</p></div></li>
      </ol>
    </section>

    <section className="rules-section" aria-labelledby="rules-format-title">
      <h2 className="rules-section-title" id="rules-format-title">Thể thức & thành viên</h2>
      <div className="rules-split">
        <div className="rules-pane">
          <h3 className="rules-sub">Thể thức & mục tiêu</h3>
          <ul className="rules-list">
            <li>Thi đấu theo thể thức đánh đôi, mỗi trận gồm 2 người đấu với 2 người.</li>
            <li>Lịch đấu ưu tiên công bằng về số trận, đồng đội và đối thủ.</li>
            <li>Hạn chế tối đa việc trùng lặp cặp đấu trong cùng một buổi.</li>
            <li>Phân nhóm Level dựa trên BXH ELO hiện hành để trận đấu vừa sức và hấp dẫn hơn.</li>
          </ul>
        </div>
        <div className="rules-pane">
          <h3 className="rules-sub">Thành viên & phân level</h3>
          <div className="rules-level-groups">
            {levelGroups.map((group) => <div className={`rules-level-group rules-level-${group.level}`} key={group.level}>
              <div className="rules-level-head">
                <span className={`level-chip ${group.level === 1 ? "level-one" : "level-two"}`}>Level {group.level}</span>
                <b>{group.title}</b>
                <small>{group.note}</small>
              </div>
              <div className="rules-member-list" aria-label={`Thành viên Level ${group.level}`}>
                {group.names.length ? group.names.map((name) => <span key={name}>{name}</span>) : <em>Chưa có thành viên</em>}
              </div>
            </div>)}
          </div>
        </div>
      </div>
    </section>

    <section className="rules-section" aria-labelledby="rules-schedule-title">
      <h2 className="rules-section-title" id="rules-schedule-title">Cấu trúc lịch đấu hằng tuần</h2>
      <div className="rules-pane rules-schedule">
        <p className="rules-lead">Lịch chỉ được tạo khi có từ 5 thành viên tham gia. Với buổi 5 người, hệ thống dùng lịch riêng không phân Level; từ 6 người trở lên sẽ chọn thư viện lịch phù hợp theo tổng số người và số lượng Level 1 / Level 2 của buổi đó.</p>
        <div className="rules-match-types">
          <div><b><span className="level-one">Level 1</span> + <span className="level-one">Level 1</span></b><span className="rules-vs">VS</span><b><span className="level-one">Level 1</span> + <span className="level-one">Level 1</span></b></div>
          <div><b><span className="level-one">Level 1</span> + <span className="level-two">Level 2</span></b><span className="rules-vs">VS</span><b><span className="level-one">Level 1</span> + <span className="level-two">Level 2</span></b></div>
          <div><b><span className="level-two">Level 2</span> + <span className="level-two">Level 2</span></b><span className="rules-vs">VS</span><b><span className="level-two">Level 2</span> + <span className="level-two">Level 2</span></b></div>
        </div>
        <p className="rules-note">Nếu một trường hợp không thể áp dụng đủ mọi quy tắc, lịch sẽ ưu tiên các điều kiện khả thi theo thứ tự: đủ 4 trận mỗi người, hạn chế lặp đồng đội, rồi mới đến cân bằng tuyệt đối theo level.</p>
      </div>
    </section>

    <section className="rules-section" aria-labelledby="rules-scoring-title">
      <h2 className="rules-section-title" id="rules-scoring-title">Luật & tính điểm</h2>
      <div className="rules-split">
        <div className="rules-pane">
          <h3 className="rules-sub">Nguyên tắc chi tiết</h3>
          <ol className="rules-list rules-list-numbered">
            <li>Mỗi thành viên tham gia sẽ thi đấu đúng 4 trận trong buổi.</li>
            <li>Không để hai người làm đồng đội quá 1 lần/tuần nếu lịch cho phép.</li>
            <li>Phân bổ đối thủ dựa trên Level hiện hành; Level được xác định từ ELO, không phải điểm thưởng tháng.</li>
            <li>Ưu tiên đa dạng đội hình, tránh cảm giác “gặp mãi một cặp”.</li>
            <li>Khuyến khích giao lưu giữa các cấp độ để mọi trận đều mới mẻ.</li>
          </ol>
        </div>
        <div className="rules-pane">
          <h3 className="rules-sub">Quyền lợi & tính điểm</h3>
          <ul className="rules-list">
            <li>Thành viên đã điểm danh tham gia được đảm bảo lịch đấu 4 trận khi số người đủ điều kiện.</li>
            <li>Thắng được <strong>+1 điểm</strong>, thua <strong>0 điểm</strong>.</li>
            <li>Điểm thắng, điểm thua, hiệu số và số trận đều được lưu vào BXH tháng.</li>
            <li>Nếu vắng mặt trong buổi đã diễn ra, thành viên không được bù 4 trận của buổi đó.</li>
          </ul>
        </div>
      </div>
    </section>

    <section className="rules-section" aria-labelledby="rules-prize-title">
      <h2 className="rules-section-title" id="rules-prize-title">Cơ cấu giải thưởng</h2>
      <div className="rules-prizes">
        <div className="gold"><span className="prize-medal-icon prize-medal-1" aria-hidden="true" /><b>Vô địch</b><p>1 áo cầu lông, tối đa 200k. Nếu chọn áo đắt hơn, người nhận tự bù phần chênh lệch.</p></div>
        <div className="silver"><span className="prize-medal-icon prize-medal-2" aria-hidden="true" /><b>Á quân</b><p>2 cuốn cán Yonex xịn hoặc 1 đôi tất cầu lông cao cấp, khoảng 80–100k.</p></div>
        <div className="bronze"><span className="prize-medal-icon prize-medal-3" aria-hidden="true" /><b>Giải ba</b><p>1 đôi tất thủ công hoặc 1 cuốn cán Yonex xịn, khoảng 40–50k.</p></div>
        <div className="fourth"><span className="prize-medal-icon prize-medal-4" aria-hidden="true" /><b>Giải tư</b><p>2 cuốn cán rẻ, khoảng 20k.</p></div>
      </div>
      <p className="rules-total">Tổng giá trị giải thưởng dự kiến: <strong>350k</strong>.</p>
    </section>
  </section>;
}

function ScheduleLibrary({ scenarios, members }: { scenarios: ScheduleScenario[]; members: Member[] }) {
  const [participantFilter, setParticipantFilter] = useState<ParticipantCount>(5);
  // A mix is possible only with enough members of each Level (Level 1 = top 4 ELO, the rest Level 2).
  const clubLevel1 = members.filter((member) => member.level === 1).length;
  const clubLevel2 = members.length - clubLevel1;
  const isAvailable = (scenario: ScheduleScenario) => scenario.participantCount === 5
    ? members.length >= 5
    : scenario.level1Count <= clubLevel1 && scenario.level2Count <= clubLevel2;
  const visibleScenarios = scenarios
    .filter((scenario) => scenario.participantCount === participantFilter && isAvailable(scenario))
    .sort((a, b) => a.level1Count - b.level1Count);
  const countEnabled = (count: ParticipantCount) => scenarios.some((scenario) => scenario.participantCount === count && isAvailable(scenario));
  return <section className="schedule-library">
    <PageHero
      eyebrow="THƯ VIỆN LỊCH"
      title="Mẫu lịch theo số người & Level"
      description="Lịch chỉ có khi buổi chơi có từ 5 thành viên trở lên. Trang này chỉ để xem các trường hợp tạo lịch, không chọn hay ghi đè lịch của buổi hiện tại."
      statsLabel="Tóm tắt thư viện lịch"
      stats={[{ label: "Người tham gia", value: participantFilter }, { label: "Trường hợp", value: visibleScenarios.length }]}
    />
    <div className="schedule-filter" role="group" aria-label="Lọc lịch theo số lượng thành viên">
      {scheduleParticipants.map((count) => <button key={count} type="button" className={participantFilter === count ? "active" : ""} disabled={!countEnabled(count)} title={countEnabled(count) ? undefined : `Mở khi CLB có từ ${count} thành viên`} onClick={() => setParticipantFilter(count)}>{count} người</button>)}
    </div>
    <div className="schedule-case-list">
      {visibleScenarios.map((scenario) => <article className="panel schedule-case" key={scenario.id}>
        <div className="schedule-case-head">
          <div>
            <h2>{scenario.title}</h2>
            <p>{scenario.subtitle}</p>
          </div>
        </div>
        <div className="schedule-grid schedule-library-grid">
          {scenario.matches.map((match, i) => <Match match={match} i={i} key={`${scenario.id}-${i}`} />)}
        </div>
      </article>)}
    </div>
  </section>;
}
function SlotToken({ no, name, open }: { no: number; name?: string; open?: boolean }) { return <span className={`slot-token ${open ? "level-open" : `level-${slotLevel(no)}`}`}><b>{no}</b>{name && <small>{name}</small>}</span>; }
function TeamPair({ team, namesBySlot, open }: { team: readonly [number, number]; namesBySlot?: Record<number, string>; open?: boolean }) { return <span className="team-pair"><SlotToken no={team[0]} name={namesBySlot?.[team[0]]} open={open} /><i>+</i><SlotToken no={team[1]} name={namesBySlot?.[team[1]]} open={open} /></span>; }
function Match({ match, i, namesBySlot }: { match: ScheduleMatch; i: number; namesBySlot?: Record<number, string> }) { const open = match.type === "MỞ"; return <article className="match schedule-match-card"><div className="match-top"><b>TRẬN {String(i + 1).padStart(2, "0")}</b></div><div className="teams"><TeamPair team={match.teamA} namesBySlot={namesBySlot} open={open} /><strong>VS</strong><TeamPair team={match.teamB} namesBySlot={namesBySlot} open={open} /></div></article>; }
function Results({ onEditingChange, matches, drawn, scores, setScores, confirmedMatches, setConfirmedMatches, sessionId, canManageScores, onSaved }: { onEditingChange: (rows: number[]) => void; matches: ScheduleMatch[]; drawn: Record<string, number>; scores: Record<number, [string, string]>; setScores: Dispatch<SetStateAction<Record<number, [string, string]>>>; confirmedMatches: Record<number, boolean>; setConfirmedMatches: Dispatch<SetStateAction<Record<number, boolean>>>; sessionId: string | null; canManageScores: boolean; onSaved: (completed: boolean) => void }) {
  const [editing, setEditing] = useState<Record<number, boolean>>({});
  // Scores saved before "Sửa": the row keeps showing that result until the edit is saved.
  const [savedBeforeEdit, setSavedBeforeEdit] = useState<Record<number, [string, string]>>({});
  const [saving, setSaving] = useState<number | null>(null);
  // Score boxes shown in red: set by a wrong entry or a refused confirm, cleared when focus leaves the row's boxes.
  const [redBoxes, setRedBoxes] = useState<Record<number, { a: boolean; b: boolean }>>({});
  const { toast, showToast, dismissToast } = useToast();
  const [clearing, setClearing] = useState<number | null>(null);
  useEffect(() => {
    onEditingChange(Object.keys(editing).filter((row) => editing[Number(row)]).map(Number));
  }, [editing, onEditingChange]);
  const namesBySlot = Object.fromEntries(Object.entries(drawn).map(([name, no]) => [no, name])) as Record<number, string>;
  const confirmedCount = Object.values(confirmedMatches).filter(Boolean).length;
  const saveMatch = async (match: ScheduleMatch, index: number) => {
    // Serialize score writes so monthly totals cannot lose updates.
    if (saving !== null) return;
    const [scoreAText, scoreBText] = scores[index] ?? ["", ""];
    const entryError = scoreEntryError(scoreAText, scoreBText);
    if (entryError) {
      showToast(confirmedMatches[index] && scoreAText === "" && scoreBText === "" ? "Muốn bỏ kết quả trận này, bấm Xóa điểm." : entryError);
      const bothValid = isScoreText(scoreAText) && isScoreText(scoreBText);
      setRedBoxes({ ...redBoxes, [index]: { a: bothValid || !isScoreText(scoreAText), b: bothValid || !isScoreText(scoreBText) } });
      document.getElementById(`match-score-${index}-${isScoreText(scoreAText) && !isScoreText(scoreBText) ? "b" : "a"}`)?.focus();
      return;
    }
    if (!supabase || !sessionId) return showToast("Chưa có phiên Supabase để lưu kết quả.");
    const scoreA = Number(scoreAText);
    const scoreB = Number(scoreBText);
    setSaving(index);
    setRedBoxes({ ...redBoxes, [index]: { a: false, b: false } });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/match-result", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ sessionId, matchNo: index + 1, matchType: match.type, teamA: match.teamA, teamB: match.teamB, scoreA, scoreB, totalMatches: matches.length }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; completed?: boolean };
      if (!response.ok) return showToast(payload.error || "Không thể lưu kết quả trận.");
      setConfirmedMatches((current) => ({ ...current, [index]: true }));
      setEditing((current) => ({ ...current, [index]: false }));
      showToast(`Đã lưu trận ${index + 1} (${scoreA}–${scoreB}), BXH đã cập nhật.`, "success");
      onSaved(Boolean(payload.completed));
    } catch {
      showToast("Không kết nối được máy chủ, điểm chưa được lưu.");
    } finally {
      setSaving(null);
    }
  };
  // Takes a saved result back out (e.g. entered on the wrong match); the ranking and ELO follow.
  const clearMatch = async (index: number) => {
    if (saving !== null) return;
    if (!supabase || !sessionId) return showToast("Chưa có phiên Supabase để lưu kết quả.");
    setSaving(index);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/match-result", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ sessionId, matchNo: index + 1, totalMatches: matches.length }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) return showToast(payload.error || "Không thể xóa điểm trận này.");
      setScores((current) => {
        const remaining = { ...current };
        delete remaining[index];
        return remaining;
      });
      setConfirmedMatches((current) => ({ ...current, [index]: false }));
      setEditing((current) => ({ ...current, [index]: false }));
      setRedBoxes((current) => ({ ...current, [index]: { a: false, b: false } }));
      showToast(`Đã xóa điểm trận ${index + 1}, BXH đã cập nhật.`, "success");
      onSaved(false);
    } catch {
      showToast("Không kết nối được máy chủ, điểm chưa được xóa.");
    } finally {
      setSaving(null);
    }
  };
  return <section className="panel result-entry-panel"><div className="panel-head"><div><h2>Điểm số từng trận</h2></div><span className="count-pill match-count-pill"><b>{confirmedCount}</b><small>/{matches.length} trận</small></span></div><div className="result-list">{matches.map((match, i) => {
    const confirmed = Boolean(confirmedMatches[i]);
    const locked = !canManageScores || (confirmed && !editing[i]);
    const [scoreAText = "", scoreBText = ""] = scores[i] ?? ["", ""];
    const [savedAText, savedBText] = (editing[i] && savedBeforeEdit[i]) || [scoreAText, scoreBText];
    const scoreAValue = Number(savedAText);
    const scoreBValue = Number(savedBText);
    const hasResultColor = confirmed && isScoreText(savedAText) && isScoreText(savedBText) && scoreAValue !== scoreBValue;
    const resultClassName = hasResultColor ? (scoreAValue > scoreBValue ? " result-a-wins" : " result-b-wins") : "";
    const scoreAInvalid = !locked && Boolean(redBoxes[i]?.a);
    const scoreBInvalid = !locked && Boolean(redBoxes[i]?.b);
    // Keeps exactly what was typed; wrong content only raises a warning and blocks the confirm.
    const changeScore = (next: [string, string], box: "a" | "b") => {
      const typed = next[box === "a" ? 0 : 1];
      const wrong = typed !== "" && !isScoreText(typed);
      setScores((current) => ({ ...current, [i]: next }));
      setRedBoxes({ ...redBoxes, [i]: { a: scoreAInvalid, b: scoreBInvalid, [box]: wrong } });
      if (wrong) showToast(SCORE_FORMAT_ERROR);
    };
    const scoreInputProps = { inputMode: "numeric", autoComplete: "off", required: true, disabled: locked } as const;
    return <div className={"result-row schedule-result-row match-result-row " + (confirmed ? "confirmed" : "") + resultClassName} key={i}>
      <div className="match-result-meta"><b>{i + 1}</b></div>
      <div className="match-result-team match-result-team-a"><TeamPair team={match.teamA} namesBySlot={namesBySlot} open={match.type === "MỞ"} /></div>
      <div className="match-score-controls" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setRedBoxes((current) => ({ ...current, [i]: { a: false, b: false } })); }}><input {...scoreInputProps} id={`match-score-${i}-a`} className={scoreAInvalid ? "score-invalid" : undefined} aria-invalid={scoreAInvalid} aria-label={`Điểm đội A trận ${i + 1}`} value={scoreAText} onChange={e => changeScore([e.target.value, scoreBText], "a")}/><em>:</em><input {...scoreInputProps} id={`match-score-${i}-b`} className={scoreBInvalid ? "score-invalid" : undefined} aria-invalid={scoreBInvalid} aria-label={`Điểm đội B trận ${i + 1}`} value={scoreBText} onChange={e => changeScore([scoreAText, e.target.value], "b")}/></div>
      <div className="match-result-team match-result-team-b"><TeamPair team={match.teamB} namesBySlot={namesBySlot} open={match.type === "MỞ"} /></div>
      <div className={"result-actions" + (confirmed && editing[i] ? " result-actions-edit" : "")}>{canManageScores && (confirmed && !editing[i] ? <button className="soft-btn result-icon-button edit" aria-label={`Sửa điểm trận ${i + 1}`} title="Sửa" disabled={saving !== null} onClick={() => { setSavedBeforeEdit({ ...savedBeforeEdit, [i]: [scoreAText, scoreBText] }); setEditing({ ...editing, [i]: true }); }}><span className="result-action-text">Sửa</span></button> : <button className="primary result-icon-button save" aria-label={confirmed ? `Lưu lại điểm trận ${i + 1}` : `Xác nhận điểm trận ${i + 1}`} title={confirmed ? "Lưu lại" : "Xác nhận"} disabled={saving !== null} onClick={() => void saveMatch(match, i)}>{confirmed ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> : <span className="result-action-text">{saving === i ? "Lưu..." : "Xác nhận"}</span>}</button>)}{canManageScores && confirmed && editing[i] && <button className="soft-btn result-icon-button result-clear-button" aria-label={`Xóa điểm trận ${i + 1}`} title="Xóa điểm" disabled={saving !== null} onClick={() => setClearing(i)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg></button>}</div>
    </div>;
  })}</div><Toast toast={toast} onClose={dismissToast} />
    <Presence show={clearing !== null}>{clearing !== null && <ConfirmActionModal title={`Xóa điểm trận ${clearing + 1}?`} message={`Kết quả ${savedBeforeEdit[clearing]?.join("–") ?? ""} sẽ bị xóa, trận trở về chưa có điểm. BXH, ELO và Phong độ được tính lại ngay.`} confirmLabel="Xóa điểm" cancelLabel="Hủy" onCancel={() => setClearing(null)} onConfirm={async () => { const index = clearing; setClearing(null); await clearMatch(index); }} />}</Presence>
  </section>;
}
function LiveRankingSnapshot({ rows, month }: { rows: RankingRow[]; month: string }) {
  const hasRankingData = rows.some((row) => !row.placeholder && row.matches > 0);
  const completedMatches = Math.floor(rows.reduce((total, row) => total + row.matches, 0) / 4);
  return <section className="panel live-ranking-panel" aria-label={`Bảng xếp hạng theo tuần ${month}`}>
    <div className="panel-head"><div><h2>Bảng xếp hạng theo tuần</h2></div><span className="count-pill weekly-count-pill"><b>{completedMatches}</b><small>trận đã tính</small></span></div>
    <div className="rank-table live-rank-table"><div className="rank-head rank-columns"><span>Vị trí</span><span>Thành viên</span><span>Điểm</span><span>Điểm thắng</span><span>Điểm thua</span><span>Hiệu số</span><span>Số trận</span></div>{rows.length ? rows.map((row, i) => {
      const isTopRank = hasRankingData && i < 3;
      return <div className={"rank-row rank-columns " + (isTopRank ? "top-rank top-" + (i + 1) : "")} key={row.name}><b className={isTopRank ? "medal m" + i : "rank-number"}>{i + 1}</b><div className="person"><div className={avatarClassName("avatar small", row)} style={avatarStyle(row)}>{row.initials}</div><b>{row.name}</b><span className="level">L{row.level}</span></div><b className="point-value">{row.points}</b><span>{row.pointsWon}</span><span>{row.pointsLost}</span><span className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</span><span>{row.matches}</span><div className="rank-mobile-stats" aria-hidden="true"><span><em>Thắng</em><b>{row.pointsWon}</b></span><span><em>Thua</em><b>{row.pointsLost}</b></span><span><em>Hiệu</em><b className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</b></span><span><em>Trận</em><b>{row.matches}</b></span></div></div>;
    }) : <div className="empty-ranking">Chưa có dữ liệu BXH cho tháng hiện tại.</div>}</div>
  </section>;
}
function fillRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}
function strokeRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.stroke();
}
const rankingMonthForFile = (label: string) => {
  const date = monthDateFromLabel(label);
  if (!date) return { display: label, file: label.replace(/[\\/:*?"<>|]/g, "-") };
  const monthText = String(date.getMonth() + 1).padStart(2, "0");
  return { display: `Tháng ${monthText}/${date.getFullYear()}`, file: `${monthText}-${date.getFullYear()}` };
};
// ELO with one decimal, as on the ELO page; shown for information only (never used for the order).
const formatElo = (value?: number) => (typeof value === "number" ? value.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—");

const loadCanvasImage = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = src;
});

// Draws the monthly ranking exactly like the desktop BXH table in the app (same columns, colours,
// medals, avatars, Level pills and form icons), at a fixed 1200px width whatever device saves it.
async function downloadRankingImage(month: string, rows: RankingRow[], form: FormByUsername, elo: Record<string, number>) {
  if (typeof document === "undefined") return;
  const bodyFont = `"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", sans-serif`;
  const numberFont = `"JetBrains Mono", ui-monospace, monospace`;
  const headingFont = `"Bricolage Grotesque", "Be Vietnam Pro", sans-serif`;
  await Promise.all([
    document.fonts?.load(`800 15px "Be Vietnam Pro"`),
    document.fonts?.load(`700 26px "JetBrains Mono"`),
    document.fonts?.load(`750 30px "Bricolage Grotesque"`),
  ]).catch(() => undefined);
  await document.fonts?.ready.catch(() => undefined);

  const visibleRows: RankingRow[] = rows.length ? rows : [{ name: "Chưa có dữ liệu", initials: "—", level: 2, points: 0, pointsWon: 0, pointsLost: 0, pointDiff: 0, matches: 0, color: "#b8760e", placeholder: true }];
  const hasRankingData = visibleRows.some((row) => !row.placeholder && row.matches > 0);
  const [medals, winIcon, lossIcon, avatars] = await Promise.all([
    Promise.all([1, 2, 3].map((rank) => loadCanvasImage(`/app-icons/rank-${rank}.png?v=ranking-medals-nobg-20260904`))),
    loadCanvasImage("/app-icons/form-win.png?v=form-icons-20261011"),
    loadCanvasImage("/app-icons/form-loss.png?v=form-icons-20261011"),
    Promise.all(visibleRows.map((row) => (hasAvatarArt(row.username) ? loadCanvasImage(avatarImageUrl(row.username)!) : Promise.resolve(null)))),
  ]);

  // Layout (CSS px, mirrors ranking-table-header.css at desktop width).
  const width = 1200;
  const cardX = 24;
  const cardW = width - cardX * 2;
  const cardY = 112;
  const headH = 36;
  const rowHeights = visibleRows.map((_, index) => (hasRankingData && index < 3 ? 69 : 60));
  const cardH = headH + rowHeights.reduce((sum, h) => sum + h, 0);
  const height = cardY + cardH + 58;
  const fixed = [56, 70, 86, 82, 76, 70, 84, 116];
  const gap = 10;
  const innerX = cardX + 1 + 20;
  const innerW = cardW - 2 - 40;
  const nameW = innerW - fixed.reduce((sum, w) => sum + w, 0) - gap * 8;
  const widths = [fixed[0], nameW, ...fixed.slice(1)];
  const columns = widths.map((w, index) => ({ x: innerX + widths.slice(0, index).reduce((sum, value) => sum + value + gap, 0), w }));
  const center = (index: number) => columns[index].x + columns[index].w / 2;

  const ratio = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  ctx.textBaseline = "middle";

  // Page background (same as the app body).
  const page = ctx.createLinearGradient(0, 0, 0, height);
  page.addColorStop(0, "#fffdf8");
  page.addColorStop(0.44, "#faf8f3");
  page.addColorStop(1, "#f7f3ea");
  ctx.fillStyle = page;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * 0.18, height * 0.06, 0, width * 0.18, height * 0.06, Math.max(width, height) * 0.28);
  glow.addColorStop(0, "rgba(255, 183, 0, 0.14)");
  glow.addColorStop(1, "rgba(255, 183, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Title.
  const { display, file } = rankingMonthForFile(month);
  ctx.textAlign = "left";
  ctx.fillStyle = "#b67500";
  ctx.font = `800 12px ${bodyFont}`;
  ctx.letterSpacing = "1.5px";
  ctx.fillText("ANH EM IT BADMINTON", cardX + 4, 40);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#17140f";
  ctx.font = `750 32px ${headingFont}`;
  ctx.fillText(`Bảng xếp hạng ${display.replace(/^Tháng/, "tháng")}`, cardX + 2, 76);

  // Card.
  ctx.save();
  ctx.shadowColor = "rgba(35, 28, 18, 0.06)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#ffffff";
  fillRoundRect(ctx, cardX, cardY, cardW, cardH, 18);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 18);
  ctx.clip();

  // Header row.
  ctx.fillStyle = "#faf7f0";
  ctx.fillRect(cardX, cardY, cardW, headH);
  ctx.fillStyle = "rgba(30, 25, 18, 0.08)";
  ctx.fillRect(cardX, cardY + headH - 1, cardW, 1);
  ctx.fillStyle = "rgba(74, 62, 44, 0.62)";
  ctx.font = `800 10.5px ${bodyFont}`;
  ctx.letterSpacing = "0.735px";
  ["Vị trí", "Thành viên", "Điểm", "Điểm thắng", "Điểm thua", "Hiệu số", "Số trận", "ELO", "Phong độ"].forEach((label, index) => {
    ctx.textAlign = index === 1 ? "left" : "center";
    ctx.fillText(label.toUpperCase(), index === 1 ? columns[1].x : center(index), cardY + headH / 2 + 0.5);
  });
  ctx.letterSpacing = "0px";

  // Member rows.
  const podium = [
    { tint: "255, 183, 0", edge: "#ffb700", points: "#b87900" },
    { tint: "126, 138, 160", edge: "#a3adbd", points: "#5d6878" },
    { tint: "196, 116, 58", edge: "#cd8a52", points: "#a85a24" },
  ];
  let y = cardY + headH;
  visibleRows.forEach((row, index) => {
    const h = rowHeights[index];
    const mid = y + h / 2;
    const top = hasRankingData && index < 3 ? podium[index] : null;
    if (top) {
      const tint = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
      tint.addColorStop(0, `rgba(${top.tint}, 0.13)`);
      tint.addColorStop(0.7, `rgba(${top.tint}, 0.02)`);
      tint.addColorStop(1, `rgba(${top.tint}, 0.02)`);
      ctx.fillStyle = tint;
      ctx.fillRect(cardX, y, cardW, h);
      ctx.fillStyle = top.edge;
      ctx.fillRect(cardX + 1, y, 3, h);
    }
    if (index < visibleRows.length - 1) {
      ctx.fillStyle = "rgba(30, 25, 18, 0.07)";
      ctx.fillRect(cardX, y + h - 1, cardW, 1);
    }

    // Rank: medal for the podium, numbered circle otherwise.
    const medal = top ? medals[index] : null;
    if (medal) {
      ctx.drawImage(medal, center(0) - 22, mid - 22, 44, 44);
    } else {
      ctx.fillStyle = "#fffaf0";
      ctx.beginPath();
      ctx.arc(center(0), mid, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(43, 34, 22, 0.1)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#14110d";
      ctx.font = `800 14px ${bodyFont}`;
      ctx.textAlign = "center";
      ctx.fillText(String(index + 1), center(0), mid + 0.5);
    }

    // Avatar, name and Level pill.
    const avatarX = columns[1].x;
    const avatar = avatars[index];
    ctx.save();
    ctx.shadowColor = "rgba(35, 28, 18, 0.12)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    if (avatar) {
      ctx.drawImage(avatar, avatarX, mid - 15, 30, 30);
    } else {
      ctx.fillStyle = "#ece7dd";
      ctx.beginPath();
      ctx.arc(avatarX + 15, mid, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.clip();
      ctx.fillStyle = "#a79f92";
      ctx.beginPath();
      ctx.arc(avatarX + 15, mid - 4, 5.4, 0, Math.PI * 2);
      ctx.arc(avatarX + 15, mid + 15, 10.5, Math.PI, 0);
      ctx.fill();
    }
    ctx.restore();
    ctx.textAlign = "left";
    ctx.fillStyle = "#17120d";
    ctx.font = `800 15px ${bodyFont}`;
    ctx.letterSpacing = "-0.14px";
    const nameX = avatarX + 40;
    ctx.fillText(row.name, nameX, mid + 0.5);
    const nameWidth = ctx.measureText(row.name).width;
    ctx.letterSpacing = "0px";
    const pillLabel = `L${row.level}`;
    ctx.font = `800 8px ${bodyFont}`;
    const pillW = ctx.measureText(pillLabel).width + 12;
    const pillX = nameX + nameWidth + 10;
    ctx.fillStyle = "rgba(255, 250, 236, 0.94)";
    fillRoundRect(ctx, pillX, mid - 9, pillW, 18, 9);
    ctx.strokeStyle = "rgba(255, 183, 0, 0.42)";
    strokeRoundRect(ctx, pillX + 0.5, mid - 8.5, pillW - 1, 17, 8.5);
    ctx.fillStyle = "#b67500";
    ctx.textAlign = "center";
    ctx.fillText(pillLabel, pillX + pillW / 2, mid + 0.5);

    // Numbers.
    ctx.fillStyle = top ? top.points : "#17140f";
    ctx.font = top ? `700 26px ${numberFont}` : `700 19px ${numberFont}`;
    ctx.fillText(String(row.points), center(2), mid + 1);
    ctx.font = `700 14px ${bodyFont}`;
    ctx.fillStyle = "#3d3528";
    ctx.fillText(String(row.pointsWon), center(3), mid + 0.5);
    ctx.fillText(String(row.pointsLost), center(4), mid + 0.5);
    ctx.fillStyle = row.pointDiff >= 0 ? "#1f8a5b" : "#c2413b";
    ctx.fillText(`${row.pointDiff > 0 ? "+" : ""}${row.pointDiff}`, center(5), mid + 0.5);
    ctx.fillStyle = "#3d3528";
    ctx.fillText(String(row.matches), center(6), mid + 0.5);
    ctx.fillStyle = "#6b5a3a";
    ctx.font = `700 14px ${numberFont}`;
    ctx.fillText(formatElo(row.username ? elo[row.username] : undefined), center(7), mid + 0.5);

    // Form: last four results, oldest → newest, empty dashed slots when fewer.
    const recent = [...((row.username && form[row.username]) || [])].slice(0, 4).reverse();
    const badge = 22;
    const badgeGap = 4;
    const startX = center(8) - (badge * 4 + badgeGap * 3) / 2;
    for (let slot = 0; slot < 4; slot += 1) {
      const bx = startX + slot * (badge + badgeGap);
      const entry = recent[slot];
      const icon = entry ? (entry.result === "W" ? winIcon : lossIcon) : null;
      if (icon) {
        ctx.drawImage(icon, bx, mid - badge / 2, badge, badge);
      } else if (entry) {
        ctx.fillStyle = entry.result === "W" ? "#1f9d55" : "#d64545";
        ctx.beginPath();
        ctx.arc(bx + badge / 2, mid, badge / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = `800 10.5px ${bodyFont}`;
        ctx.fillText(entry.result, bx + badge / 2, mid + 0.5);
      } else {
        ctx.save();
        ctx.setLineDash([2.5, 2.5]);
        ctx.strokeStyle = "rgba(61, 53, 40, 0.22)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bx + badge / 2, mid, badge / 2 - 0.75, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.textAlign = "left";
    y += h;
  });
  ctx.restore();

  // Card border on top of the rows.
  ctx.strokeStyle = "rgba(30, 25, 18, 0.09)";
  ctx.lineWidth = 1;
  strokeRoundRect(ctx, cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1, 18);

  ctx.fillStyle = "rgba(61, 53, 40, 0.55)";
  ctx.font = `600 12px ${bodyFont}`;
  ctx.textAlign = "left";
  ctx.fillText(`Xuất lúc ${new Date().toLocaleString("vi-VN")}`, cardX + 4, height - 26);
  ctx.textAlign = "right";
  ctx.fillText("anh-em-it-badminton.vercel.app", width - cardX - 4, height - 26);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Bảng xếp hạng tháng ${file}.png`;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 1500);
  }, "image/png", 0.96);
}
function Ranking({ month, rows, form, elo, onMonthChange, monthOptions, isAdmin, closeStatus, closeNotice, closingMonth, onCloseMonth }: { month: string; rows: RankingRow[]; form: FormByUsername; elo: Record<string, number>; onMonthChange: (month: string) => void; monthOptions: string[]; isAdmin: boolean; closeStatus: MonthCloseStatus | null; closeNotice: string; closingMonth: boolean; onCloseMonth: () => void }) {
  const hasRankingData = rows.some((row) => !row.placeholder && row.matches > 0);
  return <section className="ranking">
    <div className="ranking-toolbar"><div className="ranking-filter-row"><select value={month} onChange={(e) => onMonthChange(e.target.value)} aria-label="Tháng">{monthOptions.map((option) => <option key={option}>{option}</option>)}</select><button type="button" className="soft-btn ranking-export-btn" onClick={() => void downloadRankingImage(month, rows, form, elo)}><span className="ranking-export-full">Lưu ảnh BXH</span><span className="ranking-export-short">Lưu ảnh</span></button></div><p className="ranking-note">{closeStatus?.closed ? "BXH tháng này đã chốt, dữ liệu chỉ còn xem." : "Admin chốt BXH sau khi buổi cuối tháng hoàn tất để tạo tháng mới."}</p></div>
    {isAdmin && closeStatus && <div className={"month-close-card " + (closeStatus.closed ? "closed" : closeStatus.eligible ? "ready" : "waiting")}>
      <div>
        <span>{closeStatus.closed ? "ĐÃ CHỐT THÁNG" : closeStatus.eligible ? "SẴN SÀNG CHỐT" : "CHỜ ĐỦ ĐIỀU KIỆN"}</span>
        <h3>{closeStatus.monthLabel} → {closeStatus.nextMonthLabel}</h3>
        <p>{closeStatus.message}</p>
        {closeNotice && <p className="month-close-feedback" aria-live="polite">{closeNotice}</p>}
      </div>
      {!closeStatus.closed && <button className="primary" disabled={!closeStatus.eligible || closingMonth} onClick={onCloseMonth}>{closingMonth ? "Đang chốt..." : `Chốt BXH ${closeStatus.monthLabel}`}</button>}
    </div>}
    <div className="rank-table rank-table-form"><div className="rank-head rank-columns"><span>Vị trí</span><span>Thành viên</span><span>Điểm</span><span>Điểm thắng</span><span>Điểm thua</span><span>Hiệu số</span><span>Số trận</span><span>ELO</span><span>Phong độ</span></div>{rows.length ? rows.map((row, i) => {
      const isTopRank = hasRankingData && i < 3;
      return <div className={"rank-row rank-columns " + (isTopRank ? "top-rank top-" + (i + 1) : "")} key={row.name}><b className={isTopRank ? "medal m" + i : "rank-number"}>{i + 1}</b><div className="person"><div className={avatarClassName("avatar small", row)} style={avatarStyle(row)}>{row.initials}</div><b>{row.name}</b><span className="level">L{row.level}</span><span className="rank-elo-chip">ELO {formatElo(row.username ? elo[row.username] : undefined)}</span></div><b className="point-value">{row.points}</b><span>{row.pointsWon}</span><span>{row.pointsLost}</span><span className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</span><span>{row.matches}</span><div className="rank-elo">{formatElo(row.username ? elo[row.username] : undefined)}</div><FormBadges form={row.username ? form[row.username] : undefined} className="rank-form" /><div className="rank-mobile-stats" aria-hidden="true"><span><em>Thắng</em><b>{row.pointsWon}</b></span><span><em>Thua</em><b>{row.pointsLost}</b></span><span><em>Hiệu</em><b className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</b></span><span><em>Trận</em><b>{row.matches}</b></span><span className="rank-mobile-elo"><em>ELO</em><b>{formatElo(row.username ? elo[row.username] : undefined)}</b></span></div></div>;
    }) : <div className="empty-ranking">Chưa có thành viên hoạt động để hiển thị BXH {month}.</div>}</div>
  </section>;
}
function EloGuideModal({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="elo-guide-title">
    <section className="elo-guide-modal">
      <header className="elo-guide-header">
        <p className="eyebrow">ELO RATING</p>
        <h2 id="elo-guide-title">Cách tính điểm ELO</h2>
        <button className="modal-close" onClick={onClose} aria-label="Đóng">×</button>
      </header>
      <div className="elo-guide-body">
      <p className="elo-guide-lead">ELO đo trình độ của từng thành viên và được cập nhật sau mỗi trận đã lưu. ELO tách riêng với BXH điểm thưởng tháng.</p>

      <div className="elo-guide-section">
        <h3>1. Điểm khởi đầu</h3>
        <p>Mọi thành viên bắt đầu với <b>1000</b> điểm ELO.</p>
      </div>

      <div className="elo-guide-section">
        <h3>2. Tính cho mỗi trận đánh đôi</h3>
        <ol className="elo-guide-steps">
          <li><b>ELO đội</b> = trung bình ELO của 2 người trong đội.</li>
          <li><b>Khả năng thắng kỳ vọng</b> của đội: <code>E = 1 / (1 + 10^((ELO đối thủ − ELO đội) / 400))</code></li>
          <li><b>Tổng điểm của trận</b>: đội thắng được cộng <code>2 × 32 × (1 − E đội thắng)</code>, đội thua bị trừ đúng bằng số đó.</li>
          <li><b>Chia trong đội</b> theo độ chênh ELO giữa 2 đồng đội: <code>Mức chia = chênh ELO ÷ 2000</code> (tối đa 100%).
            <ul className="elo-guide-list">
              <li>Đồng đội gần bằng điểm → chia gần như đều.</li>
              <li>Đồng đội càng lệch → đội thắng: người ELO <b>thấp</b> hơn được cộng nhiều hơn; đội thua: người ELO <b>cao</b> hơn bị trừ nhiều hơn.</li>
            </ul>
          </li>
        </ol>
      </div>

      <div className="elo-guide-section">
        <h3>3. Ví dụ</h3>
        <div className="elo-guide-example">
          <p className="elo-guide-example-title">Hai đội ngang nhau (1000 + 1000 vs 1000 + 1000)</p>
          <p>Mỗi người đội thắng <b className="positive">+16</b>, mỗi người đội thua <b className="negative">−16</b>.</p>
        </div>
        <div className="elo-guide-example">
          <p className="elo-guide-example-title">Đội mạnh hơn (1100 + 1100) thắng đội 1000 + 1000</p>
          <p>Mỗi người đội thắng <b className="positive">+11,5</b>, mỗi người đội thua <b className="negative">−11,5</b> — thắng đội yếu hơn được cộng ít.</p>
        </div>
        <div className="elo-guide-example">
          <p className="elo-guide-example-title">Đồng đội lệch trình: A (750) + B (1200) vs C (1100) + D (980)</p>
          <div className="elo-guide-table" role="table">
            <div role="row" className="elo-guide-table-head"><span role="columnheader">Người chơi</span><span role="columnheader">A + B thắng</span><span role="columnheader">A + B thua</span></div>
            <div role="row"><span role="cell">A (750)</span><span role="cell" className="positive">+21,1</span><span role="cell" className="negative">−11,2</span></div>
            <div role="row"><span role="cell">B (1200)</span><span role="cell" className="positive">+16,8</span><span role="cell" className="negative">−14,9</span></div>
            <div role="row"><span role="cell">C (1100)</span><span role="cell" className="negative">−19,1</span><span role="cell" className="positive">+12,9</span></div>
            <div role="row"><span role="cell">D (980)</span><span role="cell" className="negative">−18,8</span><span role="cell" className="positive">+13,2</span></div>
          </div>
          <p className="elo-guide-note">Tổng điểm cộng của đội thắng luôn bằng tổng điểm trừ của đội thua: khi A + B thắng là 37,9 điểm, khi A + B thua là 26,1 điểm.</p>
        </div>
      </div>

      <div className="elo-guide-section">
        <h3>4. Lưu ý</h3>
        <ul className="elo-guide-list">
          <li>Chỉ tính <b>thắng / thua</b>, không tính cách biệt điểm số của trận. Trận không có kết quả hòa.</li>
          <li>Điểm được làm tròn đến <b>0,1</b> sao cho tổng thay đổi của 4 người trong trận <b>luôn bằng 0</b>.</li>
          <li>Mỗi khi lưu hoặc sửa kết quả, ELO được <b>tính lại</b> theo thứ tự các trận (ngày thi đấu, số trận), nên sửa một trận cũ sẽ cập nhật lại các trận sau.</li>
        </ul>
      </div>

      <div className="elo-guide-section">
        <h3>5. Xếp Level</h3>
        <p><b>4 thành viên đang hoạt động có ELO cao nhất</b> là Level 1, các thành viên còn lại là Level 2. Level được cập nhật sau mỗi trận để buổi sau xếp lịch đúng trình độ.</p>
      </div>

      </div>
      <div className="modal-actions"><button className="primary" onClick={onClose}>Đã hiểu</button></div>
    </section>
  </div>;
}

function EloRanking({ rows, status }: { rows: EloRankingRow[]; status: EloStatus | null }) {
  const [guideOpen, setGuideOpen] = useState(false);
  return <section className="elo-page">
    <PageHero
      eyebrow="ELO RATING"
      title="Bảng ELO thành viên"
      description="Top 4 ELO hiện tại là Level 1, còn lại là Level 2. Sau mỗi trận đã lưu, ELO và level sẽ cập nhật để tuần sau xếp lịch đúng trình độ mới."
    />

    <section className="panel elo-ranking-panel">
      <div className="panel-head elo-panel-head">
        <div><h2>Thứ hạng ELO</h2><p>Level lấy theo thứ hạng ELO hiện tại, tách riêng với BXH điểm thưởng tháng.</p></div>
        <div className="elo-head-actions">
          <button type="button" className="soft-btn elo-guide-btn" onClick={() => setGuideOpen(true)}>Cách tính ELO</button>
        </div>
      </div>
      {status && <div className={`elo-status elo-${status.source}`}>{status.message}</div>}
      <div className="elo-list">
        {rows.length > 0 && <div className="elo-head" aria-hidden="true"><span>Hạng</span><span>Thành viên</span><span>ELO</span><span>Số trận</span><span>Level</span></div>}
        {rows.length ? rows.map((row, index) => {
          const isTopRank = index < 3;
          return <article className={`elo-row ${isTopRank ? `top-rank top-${index + 1}` : ""}`} key={row.memberId}>
            <div className={isTopRank ? `elo-rank medal m${index}` : "elo-rank"} aria-label={`Hạng ${row.rank}`}>{isTopRank ? "" : row.rank}</div>
            <div className="person elo-person"><div className={avatarClassName("avatar small", row)} style={avatarStyle(row)}>{row.initials}</div><div><b>{row.name}</b><small>@{row.username}</small></div></div>
            <div className="elo-rating-value"><span>ELO</span><b>{row.eloRating.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</b></div>
            <div className="elo-row-meta"><span className="elo-matches">{row.matches}<small>{"\u00a0"}trận</small></span><b>{row.level === 1 ? "Level 1" : "Level 2"}</b></div>
          </article>;
        }) : <div className="empty-ranking">Chưa có thành viên hoạt động để hiển thị ELO.</div>}
      </div>
    </section>
    <Presence show={guideOpen}>{guideOpen && <EloGuideModal onClose={() => setGuideOpen(false)} />}</Presence>
  </section>;
}
function History({ sessions, currentMonth }: { sessions: HistorySession[]; currentMonth: string }) {
  const [month, setMonth] = useState(currentMonth);
  const [week, setWeek] = useState("Tất cả các tuần");
  const [detail, setDetail] = useState<{ title: string; rows: { no: number; a: string; b: string; sa: number; sb: number }[] } | null>(null);
  const monthOptions = [...new Set([currentMonth, ...sessions.map((session) => monthLabel(new Date(`${session.date}T00:00:00`)))])];
  const selectedMonth = monthOptions.includes(month) ? month : currentMonth;
  const entries = sessions
    .filter((session) => monthLabel(new Date(`${session.date}T00:00:00`)) === selectedMonth)
    .map((session) => {
      const date = new Date(`${session.date}T00:00:00`);
      return {
        ...session,
        week: `Tuần ${sessionWeekInMonth(date)} · ${sessionWeekdayLabel(date)} ${date.toLocaleDateString("vi-VN")}`,
        title: sessionTitle(date),
        detail: `${session.matches} trận · ${session.attendees} tham gia`,
      };
    });
  const visible = week === "Tất cả các tuần" ? entries : entries.filter((session) => session.week === week);
  const showDetail = async (session: typeof entries[number]) => {
    if (!supabase) return;
    const [{ data: matches }, { data: profiles }] = await Promise.all([
      supabase.from("matches").select("match_no,team_a,team_b,score_a,score_b").eq("session_id", session.id).order("match_no"),
      supabase.from("profiles").select("id,full_name"),
    ]);
    const names: Record<string, string> = Object.fromEntries(((profiles || []) as ProfileRow[]).map((profile) => [profile.id, profile.full_name]));
    setDetail({
      title: session.title,
      rows: ((matches || []) as MatchRow[]).map((match) => ({
        no: match.match_no,
        a: match.team_a.map((id: string) => names[id] || "?").join(" - "),
        b: match.team_b.map((id: string) => names[id] || "?").join(" - "),
        sa: match.score_a,
        sb: match.score_b,
      })),
    });
  };
  return <>
    <section className="panel history-panel">
      <div className="panel-head"><div><h2>Lịch sử thi đấu</h2><p>Dữ liệu từng buổi chơi, số đã chọn và kết quả được lưu theo tuần.</p></div></div>
      <div className="history-filters">
        <label>Tháng<select value={selectedMonth} onChange={(e) => { setMonth(e.target.value); setWeek("Tất cả các tuần"); }}>{monthOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label>Tuần<select value={week} onChange={(e) => setWeek(e.target.value)}><option>Tất cả các tuần</option>{entries.map((session) => <option key={session.id}>{session.week}</option>)}</select></label>
      </div>
      <div className="history-list">{visible.length ? visible.map((session) => <article key={session.id}><div><span>{session.week}</span><h3>{session.title}</h3><p>{session.detail}</p></div><button className="soft-btn history-detail-btn" onClick={() => void showDetail(session)}>Xem chi tiết</button></article>) : <div className="empty-ranking">Chưa có dữ liệu cho bộ lọc này.</div>}</div>
    </section>
    <Presence show={Boolean(detail)}>{detail && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="history-detail"><header className="history-detail-header"><p className="eyebrow">KẾT QUẢ THI ĐẤU</p><h2>{detail.title}</h2><button className="modal-close" onClick={() => setDetail(null)} aria-label="Đóng">×</button></header><div className="history-detail-body"><div className="history-match-list">{detail.rows.map((match) => <article className="history-match-row" key={match.no}><span className="history-match-index">Trận {match.no}</span><span className="history-team history-team-a">{match.a}</span><strong className="history-score"><span>{match.sa}</span><i>:</i><span>{match.sb}</span></strong><span className="history-team history-team-b">{match.b}</span></article>)}</div></div></section></div>}</Presence>
  </>;
}
// Password input with a show / hide toggle.
function PasswordField({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (value: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <span className="password-field">
    <input type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="new-password" autoFocus={autoFocus} />
    <button type="button" className="password-toggle" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"} title={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
      {visible
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2.5 12S6 19 12 19a9.8 9.8 0 0 0 4.4-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>}
    </button>
  </span>;
}

// Admin: create a member. The name doubles as the login (accents and spaces removed).
function AddMemberModal({ onClose, onCreate }: { onClose: () => void; onCreate: (values: { name: string; role: "member" | "sub-admin"; password: string }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"member" | "sub-admin">("member");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const username = usernameFromName(name);
  const submit = async () => {
    if (name.trim().length < 2 || username.length < 2) return setError("Nhập tên thành viên (ít nhất 2 ký tự).");
    if (password.length < MEMBER_PASSWORD_MIN) return setError(`Mật khẩu cần ít nhất ${MEMBER_PASSWORD_MIN} ký tự.`);
    setBusy(true);
    setError("");
    try {
      await onCreate({ name: name.trim(), role, password });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Không thể thêm thành viên.");
      setBusy(false);
    }
  };
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Thêm thành viên">
    <form className="member-editor member-add-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Đóng">×</button>
      <p className="eyebrow">THÊM THÀNH VIÊN</p>
      <h2>Thành viên mới</h2>
      <label>Tên<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoFocus disabled={busy} placeholder="Ví dụ: Tuấn" />
        <small className="member-editor-hint">Tên đăng nhập: <b>{username || "—"}</b></small></label>
      <label className="member-role-field">Quyền<select className="member-role-select member-role-editor-select" value={role} disabled={busy} onChange={(event) => setRole(event.target.value as "member" | "sub-admin")}><option value="member">Thành viên</option><option value="sub-admin">Sub-admin</option></select>
        <small>{role === "sub-admin" ? "Sub-admin được nhập, sửa và xác nhận điểm; không được sửa/xóa thành viên." : "Thành viên thường chỉ điểm danh, chọn số và xem kết quả."}</small></label>
      <label className="member-password-field">Mật khẩu<PasswordField value={password} onChange={setPassword} placeholder={`Ít nhất ${MEMBER_PASSWORD_MIN} ký tự`} /></label>
      {error && <p className="member-editor-error" role="alert">{error}</p>}
      <div className="editor-actions"><button type="button" className="soft-btn" onClick={onClose} disabled={busy}>Hủy bỏ</button><button type="submit" className="primary" disabled={busy}>{busy ? "Đang thêm…" : "Thêm thành viên"}</button></div>
    </form>
  </div>;
}

function Members({ members, rankingRows, rankingMonth, eloRows, formByUsername, onAvatarUpdated, onRoleUpdated }: { members: Member[]; rankingRows: RankingRow[]; rankingMonth: string; eloRows: EloRankingRow[]; formByUsername: Record<string, FormResult[]>; onAvatarUpdated: (username: string, avatarUrl: string | null) => void; onRoleUpdated: (username: string, role: MemberRole) => void }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Member | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [newAvatar, setNewAvatar] = useState<{ blob: Blob; preview: string } | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);
  const [fullName, setFullName] = useState("");
  const [editRole, setEditRole] = useState<"member" | "sub-admin">("member");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleNotice, setRoleNotice] = useState("");
  const [roleSaving, setRoleSaving] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [adding, setAdding] = useState(false);
  const normalizeSearch = (value: string) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
  const normalizedSearch = normalizeSearch(searchTerm);
  const visibleMembers = normalizedSearch
    ? members.filter((member) => normalizeSearch(`${member.name} ${member.username} ${member.initials} ${memberRoleLabel(member.role)} level ${member.level} l${member.level}`).includes(normalizedSearch))
    : members;
  useEffect(() => {
    let pointerDownTarget: EventTarget | null = null;
    const rememberPointerDown = (event: PointerEvent) => { pointerDownTarget = event.target; };
    const closeOutside = (event: MouseEvent) => {
      const target = pointerDownTarget ?? event.target;
      pointerDownTarget = null;
      if (!(target instanceof Element)) return;
      if (!target.closest(".member-actions")) setOpenMenu(null);
      if (target.closest(".modal-backdrop") && !target.closest(".member-editor, .confirm-modal")) { setEditing(null); setAdding(false); }
    };
    document.addEventListener("pointerdown", rememberPointerDown);
    document.addEventListener("click", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", rememberPointerDown);
      document.removeEventListener("click", closeOutside);
    };
  }, []);
  const saveMemberRole = async (member: Member, nextRole: "member" | "sub-admin") => {
    setRoleSaving(member.username);
    setRoleNotice("");
    try {
      if (!supabase) throw new Error("Chưa có Supabase để lưu phân quyền.");
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/member-role", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ username: member.username, role: nextRole }),
      });
      const payload = await response.json().catch(() => ({ error: "Không thể lưu phân quyền." })) as { error?: string; role?: MemberRole };
      if (!response.ok) throw new Error(payload.error || "Không thể lưu phân quyền.");
      onRoleUpdated(member.username, payload.role || nextRole);
      setRoleNotice(`Đã cập nhật ${member.name} thành ${memberRoleLabel(payload.role || nextRole)}.`);
    } finally {
      setRoleSaving(null);
    }
  };
  const save = async () => {
    if (!editing || !fullName.trim()) return;
    const currentRole = effectiveRole(editing.role);
    const roleLocked = currentRole === "admin" || editing.username === "manh";
    const nextRole = editRole;
    const roleChanged = !roleLocked && currentRole !== nextRole;
    const nameChanged = fullName.trim() !== editing.name;
    const newPassword = editPassword;
    if (newPassword && newPassword.length < MEMBER_PASSWORD_MIN) return window.alert(`Mật khẩu mới cần ít nhất ${MEMBER_PASSWORD_MIN} ký tự.`);
    setConfirm({ title: "Xác nhận cập nhật", message: `Lưu thông tin mới cho ${editing.name}?`, action: async () => {
      try {
        if (supabase) {
          if (nameChanged) { const { error } = await supabase.rpc("admin_update_member", { p_username: editing.username, p_full_name: fullName.trim() }); if (error) throw error; }
          if (roleChanged) await saveMemberRole(editing, nextRole);
          if (newAvatar) {
            const avatarUrl = await uploadAvatar(editing.username, newAvatar.blob);
            onAvatarUpdated(editing.username, avatarUrl);
          } else if (avatarRemoved) {
            await adminPost("/api/member-avatar", { username: editing.username, avatarUrl: null }, "Không thể xóa ảnh đại diện.");
            onAvatarUpdated(editing.username, null);
          }
          if (newPassword) {
            await adminPost("/api/member-password", { username: editing.username, password: newPassword }, "Không thể đổi mật khẩu.");
            setRoleNotice(`Đã đổi mật khẩu cho ${editing.name}.`);
          }
        }
        if (nameChanged) window.location.reload();
        else closeEditor();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Không thể lưu thông tin thành viên.");
      }
    }});
  };
  const openEditor = (member: Member) => {
    setEditing(member);
    setFullName(member.name);
    setEditRole(effectiveRole(member.role) === "sub-admin" ? "sub-admin" : "member");
    setEditPassword("");
    setNewAvatar(null);
    setAvatarRemoved(false);
    setAvatarError("");
  };
  const closeEditor = () => setEditing(null);
  const pickAvatar = async (file?: File) => {
    if (!file) return;
    setAvatarError("");
    try {
      const blob = await roundAvatarImage(file);
      setNewAvatar({ blob, preview: URL.createObjectURL(blob) });
      setAvatarRemoved(false);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Không đọc được ảnh này.");
    }
  };
  // Direct browser -> Cloudinary upload, then the profile keeps the delivery URL.
  const uploadAvatar = async (username: string, blob: Blob) => {
    const signed = await adminPost("/api/member-avatar/sign", { username }, "Không thể tải ảnh lên.") as unknown as Record<string, string>;
    const form = new FormData();
    form.append("file", blob, "avatar.png");
    form.append("api_key", signed.apiKey);
    for (const field of ["signature", "folder", "public_id", "overwrite", "invalidate", "allowed_formats", "timestamp"]) form.append(field, String(signed[field]));
    const response = await fetch(signed.uploadUrl, { method: "POST", body: form }).catch(() => null);
    if (!response) throw new Error("Mất kết nối khi tải ảnh lên Cloudinary.");
    const result = await response.json().catch(() => null) as { secure_url?: string; error?: { message?: string } } | null;
    if (!response.ok || !result?.secure_url) throw new Error(result?.error?.message ? `Cloudinary: ${result.error.message}` : "Cloudinary từ chối ảnh.");
    await adminPost("/api/member-avatar", { username, avatarUrl: result.secure_url }, "Không thể lưu ảnh đại diện.");
    return result.secure_url;
  };
  const adminPost = async (path: string, body: Record<string, unknown>, fallbackError: string) => {
    if (!supabase) throw new Error("Chưa kết nối Supabase.");
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({ error: fallbackError })) as { error?: string };
    if (!response.ok) throw new Error(payload.error || fallbackError);
    return payload;
  };
  const remove = (member: Member) => setConfirm({ title: "Xác nhận xóa thành viên", message: `Xóa ${member.name} khỏi danh sách hoạt động? Lịch sử thi đấu vẫn được giữ lại.`, action: async () => {
    try {
      if (supabase) {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch("/api/member-remove", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({ username: member.username }),
        });
        const payload = await response.json().catch(() => ({ error: "Không thể xóa thành viên." })) as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Không thể xóa thành viên.");
      }
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Không thể xóa thành viên.");
    }
  }});
  return <>
    <section className="member-summary">
      <div><b>{members.length}</b><span>Tổng thành viên</span></div>
      <div><b>{visibleMembers.length}</b><span>{normalizedSearch ? "Kết quả tìm kiếm" : "Đang hoạt động"}</span></div>
    </section>
    <section className="panel">
      <div className="panel-head member-panel-head">
        <div><h2>Danh sách thành viên</h2><p>Quản lý thông tin các thành viên CLB.</p></div>
        <div className="member-head-actions">
          <input className="search" placeholder="⌕  Tìm tên, username, quyền..." value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setOpenMenu(null); }} />
          <button type="button" className="primary member-add-btn" onClick={() => setAdding(true)}>+ <span className="member-add-full">Thêm thành viên</span><span className="member-add-short">Thêm</span></button>
        </div>
      </div>
      {roleNotice && <div className="member-role-notice">{roleNotice}</div>}
      <div className="member-table">{visibleMembers.length ? visibleMembers.map((member, index) => {
        const role = effectiveRole(member.role);
        const canDelete = role === "member";
        return <div key={member.username}>
          <button type="button" className="person member-person-btn" aria-label={`Xem thông tin ${member.name}`} onClick={() => setViewing(member)}><div className={avatarClassName("avatar", member)} style={avatarStyle(member)}>{member.initials}</div><div><b>{member.name}</b><small>@{member.username}</small></div></button>
          <span className="status">● Hoạt động</span>
          <div className="member-actions"><button className="more" aria-label={`Thao tác ${member.name}`} onClick={() => setOpenMenu(openMenu === member.username ? null : member.username)}>•••</button>{/* The panel clips overflow, so menus on the bottom rows open upwards. */}{openMenu === member.username && <div className={`member-menu${index >= visibleMembers.length - 2 ? " member-menu-up" : ""}`}><button onClick={() => { openEditor(member); setOpenMenu(null); }}>Sửa thành viên</button>{canDelete && <button className="danger-text" onClick={() => { remove(member); setOpenMenu(null); }}>Xóa thành viên</button>}</div>}</div>
        </div>;
      }) : <div className="empty-ranking">Không tìm thấy thành viên phù hợp với “{searchTerm}”.</div>}</div>
    </section>
    <Presence show={Boolean(editing)}>{editing && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="member-editor"><button className="modal-close" onClick={closeEditor}>×</button><p className="eyebrow">CHỈNH SỬA THÀNH VIÊN</p><h2>{editing.name}</h2><div className="member-avatar-field">{(() => {
        const shownUrl = newAvatar?.preview ?? (avatarRemoved ? null : avatarImageUrl(editing.username));
        return <div className={`avatar${shownUrl ? " avatar-art" : ""}`} style={{ "--avatar-image": shownUrl ? `url("${shownUrl}")` : "none" } as CSSProperties}>{editing.initials}</div>;
      })()}<div className="member-avatar-copy"><b>Ảnh đại diện</b><div className="member-avatar-actions"><button type="button" className="soft-btn" onClick={() => avatarInput.current?.click()}>Đổi ảnh</button>{(newAvatar || (memberAvatars.has(editing.username) && !avatarRemoved)) && <button type="button" className="soft-btn member-avatar-remove" onClick={() => { setNewAvatar(null); setAvatarRemoved(memberAvatars.has(editing.username)); }}>Xóa ảnh</button>}</div>{avatarError ? <small className="member-editor-error">{avatarError}</small> : <small className="member-editor-hint">Ảnh được cắt tròn và chỉ áp dụng khi bấm Lưu.</small>}</div><input ref={avatarInput} type="file" accept="image/*" hidden onChange={(event) => { void pickAvatar(event.target.files?.[0]); event.target.value = ""; }} /></div><label>Họ và tên<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoFocus /></label><label className="member-role-field">Quyền{effectiveRole(editing.role) === "admin" || editing.username === "manh" ? <span className="member-role-badge admin member-role-editor-badge">Admin</span> : <select className="member-role-select member-role-editor-select" value={editRole} disabled={roleSaving === editing.username} onChange={(event) => setEditRole(event.target.value as "member" | "sub-admin")}><option value="member">Thành viên</option><option value="sub-admin">Sub-admin</option></select>}<small>{effectiveRole(editing.role) === "admin" || editing.username === "manh" ? "Mạnh luôn là Admin, không thể đổi quyền." : editRole === "sub-admin" ? "Sub-admin được nhập, sửa và xác nhận điểm; không được sửa/xóa thành viên." : "Thành viên thường chỉ điểm danh, chọn số và xem kết quả."}</small></label><label className="member-password-field">Mật khẩu mới<PasswordField value={editPassword} onChange={setEditPassword} placeholder="Để trống nếu giữ nguyên" /><small className="member-editor-hint">Mật khẩu hiện tại được mã hoá nên không hiển thị được; nhập mật khẩu mới nếu muốn đổi.</small></label><div className="editor-actions"><button className="soft-btn" onClick={closeEditor}>Hủy bỏ</button><button className="primary" onClick={() => void save()}>{roleSaving === editing.username ? "Đang lưu…" : "Lưu"}</button></div></section></div>}</Presence>
    <Presence show={Boolean(viewing)}>{viewing && (() => {
      const rank = rankingRows.findIndex((row) => row.username === viewing.username || row.name === viewing.name) + 1;
      const achievement = rank > 0 ? rankingRows[rank - 1] : null;
      const hasRankingData = Boolean(achievement && !achievement.placeholder && achievement.matches > 0);
      const rankClass = hasRankingData && rank <= 3 ? `rank-${rank}` : "rank-none";
      const elo = eloRows.find((row) => row.username === viewing.username || row.name === viewing.name) ?? null;
      return <div className="modal-backdrop"><ProfilePopover detail member={viewing} rank={rank} achievement={achievement} achievementMonth={rankingMonth} rankClass={rankClass} hasRankingData={hasRankingData} elo={elo} form={formByUsername[viewing.username]} onClose={() => setViewing(null)} /></div>;
    })()}</Presence>
    <Presence show={adding}>{adding && <AddMemberModal onClose={() => setAdding(false)} onCreate={async (values) => {
      await adminPost("/api/member-create", values, "Không thể thêm thành viên.");
      window.location.reload();
    }} />}</Presence>
    <Presence show={Boolean(confirm)}>{confirm && <ConfirmActionModal title={confirm.title} message={confirm.message} onCancel={() => setConfirm(null)} onConfirm={async () => { try { await confirm.action(); } finally { setConfirm(null); } }} />}</Presence>
  </>;
}

function Login({ onLogin, error }: { onLogin: (username: string, password: string) => void | Promise<void>; error: string }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  return <main className="login-page"><section className="login-card"><div className="login-brand"><span aria-hidden="true" /><div><b>ANH EM IT</b><small>BADMINTON CLUB</small></div></div><div><p className="eyebrow">Xin chào!</p><h1>Đăng nhập CLB</h1><p>Đăng nhập để điểm danh và theo dõi lịch thi đấu của bạn.</p></div><form onSubmit={(e) => { e.preventDefault(); void onLogin(username, password); }}><label>Tên đăng nhập<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Nhập tên đăng nhập" /></label><label>Mật khẩu<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nhập mật khẩu" /></label>{error && <p className="login-error">{error}</p>}<button className="primary" type="submit">Đăng nhập <span>→</span></button></form></section></main>;
}

function CheckinModal({ member, onAnswer, onSkip }: { member: Member; onAnswer: (attending: boolean) => void; onSkip: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Điểm danh buổi chơi" {...backdropDismissProps(onSkip)}><section className="checkin-modal"><button className="modal-close" onClick={onSkip} aria-label="Đóng">×</button><p className="eyebrow">BUỔI CHƠI THỨ BẢY</p><h2>Chào {member.name}, bạn có tham gia không?</h2><p>Hãy phản hồi để Admin chốt danh sách và mở chọn số vào thứ Tư. Bạn vẫn có thể thay đổi sau trong trang chính.</p><div className="modal-actions"><button className="primary" onClick={() => onAnswer(true)}>Tôi tham gia</button><button className="secondary" onClick={() => onAnswer(false)}>Tôi không tham gia</button></div><button className="skip" onClick={onSkip}>Để sau</button></section></div>;
}
function ConfirmActionModal({ title, message, onCancel, onConfirm, icon = "confirm", confirmLabel = "Có, xác nhận", cancelLabel = "Không" }: { title: string; message: string; onCancel: () => void; onConfirm: () => void | Promise<void>; icon?: AppIconName; confirmLabel?: string; cancelLabel?: string }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" {...backdropDismissProps(onCancel)}><section className={`confirm-modal confirm-modal-${icon}`}><span className={`modal-icon app-icon app-icon-${icon}`} aria-hidden="true" /><h2>{title}</h2><p>{message}</p><div className="modal-actions confirm-actions"><button className="secondary" onClick={onCancel}>{cancelLabel}</button><button className="primary" onClick={() => void onConfirm()}>{confirmLabel}</button></div></section></div>;
}
