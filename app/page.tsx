"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Member = { name: string; initials: string; level: 1 | 2; color: string; present: boolean; username: string; password: string; role?: "admin" | "member"; responded?: boolean };
type RankingRow = { name: string; initials: string; level: number; points: number; pointsWon: number; pointsLost: number; pointDiff: number; matches: number; color: string; placeholder?: boolean };
type MonthCloseStatus = { monthKey: string; monthLabel: string; nextMonthKey: string; nextMonthLabel: string; finalSessionCompleted: boolean; closed: boolean; eligible: boolean; currentRows: number; message: string };
type HistorySession = { id: string; date: string; matches: number; attendees: number };
type SupabaseProfile = { id?: string; username?: string | null; full_name?: string | null; level?: number | string | null; role?: "admin" | "member" | string | null; is_active?: boolean | null };
type MonthlyResultRow = { month?: string | null; total_points: number; points_for: number; points_against: number; point_diff: number; matches_played: number; level_next_month: number | null; created_at?: string | null; profiles: SupabaseProfile | SupabaseProfile[] | null };
type HistorySessionRow = { id: string; session_date: string; matches?: { count: number }[] | null; attendances?: { count?: number; choice?: string | null }[] | null };
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
type AppDataCachePayload = RankingCachePayload & {
  historySessions: HistorySession[];
  monthCloseStatus: MonthCloseStatus | null;
};
type Screen = "home" | "members" | "rules" | "schedules" | "ranking" | "history";
type SessionStatus = "draft" | "checked_in" | "drawn" | "scheduled" | "completed";
type AttendanceRow = { choice: "pending" | "attending" | "absent"; drawn_number: number | null; profiles: SupabaseProfile | SupabaseProfile[] | null };
type HomeSessionPayload = { inactive?: boolean; sessionId?: string | null; sessionDate?: string; status?: SessionStatus; attendances?: AttendanceRow[]; needsReset?: boolean; error?: string };
const scheduleParticipants = [5, 6, 7, 8, 9, 10] as const;
type ParticipantCount = typeof scheduleParticipants[number];
type MatchPattern = readonly [number, number, number, number, string?];
type ScheduleMatch = { teamA: readonly [number, number]; teamB: readonly [number, number]; type: string };
type ScheduleScenario = { id: string; participantCount: ParticipantCount; level1Count: number; level2Count: number; title: string; subtitle: string; badge: string; note: string; matches: ScheduleMatch[]; relaxedReason?: string };
const screenTitles: Record<Screen, string> = {
  home: "Home",
  members: "Quản lý thành viên",
  rules: "Thể lệ",
  schedules: "Lịch thi đấu",
  ranking: "Bảng xếp hạng",
  history: "Lịch sử thi đấu",
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
    matches,
    relaxedReason,
  };
};
const scheduleScenarios: ScheduleScenario[] = [
  makeScheduleScenario(5, 0, schedule([[2, 3, 4, 5, "MỞ"], [1, 4, 3, 5, "MỞ"], [1, 5, 2, 4, "MỞ"], [1, 3, 2, 5, "MỞ"], [1, 2, 3, 4, "MỞ"]])),
  makeScheduleScenario(6, 0, schedule([[5, 10, 6, 7], [5, 6, 8, 9], [7, 8, 9, 10], [5, 7, 6, 10], [5, 8, 6, 9], [7, 9, 8, 10]])),
  makeScheduleScenario(6, 1, schedule([[1, 5, 6, 7], [1, 6, 8, 9], [5, 8, 7, 9], [1, 7, 5, 6], [1, 8, 5, 9], [6, 9, 7, 8]]), relaxedOneLevel1),
  makeScheduleScenario(6, 2, schedule([[1, 5, 2, 6], [1, 7, 2, 8], [5, 6, 7, 8], [1, 6, 2, 5], [1, 8, 2, 7], [5, 7, 6, 8]])),
  makeScheduleScenario(6, 3, schedule([[1, 5, 2, 6], [1, 6, 3, 7], [2, 7, 3, 5], [1, 7, 2, 5], [1, 3, 5, 6], [2, 3, 6, 7]]), relaxedThreeThree),
  makeScheduleScenario(6, 4, schedule([[1, 2, 3, 4], [1, 5, 2, 6], [3, 5, 4, 6], [1, 3, 2, 4], [1, 6, 2, 5], [3, 6, 4, 5]])),
  makeScheduleScenario(7, 1, schedule([[1, 5, 6, 7], [1, 8, 9, 10], [5, 6, 7, 8], [1, 9, 5, 10], [6, 8, 7, 9], [1, 6, 7, 10], [5, 9, 8, 10]]), relaxedOneLevel1),
  makeScheduleScenario(7, 2, schedule([[1, 5, 2, 6], [5, 7, 8, 9], [1, 6, 2, 7], [1, 8, 2, 9], [5, 6, 7, 8], [1, 9, 2, 5], [6, 8, 7, 9]])),
  makeScheduleScenario(7, 3, schedule([[1, 5, 2, 6], [1, 7, 3, 8], [2, 5, 3, 6], [1, 8, 2, 7], [1, 6, 3, 5], [2, 8, 3, 7], [5, 6, 7, 8]])),
  makeScheduleScenario(7, 4, schedule([[1, 2, 3, 4], [1, 5, 2, 6], [3, 5, 4, 7], [1, 6, 2, 7], [3, 6, 4, 5], [1, 7, 2, 5], [3, 7, 4, 6]])),
  makeScheduleScenario(8, 2, schedule([[1, 5, 2, 6], [1, 8, 2, 9], [1, 7, 2, 10], [1, 9, 2, 8], [5, 6, 7, 10], [5, 7, 6, 10], [5, 10, 8, 9], [6, 8, 7, 9]])),
  makeScheduleScenario(8, 3, schedule([[1, 5, 2, 6], [1, 7, 3, 8], [2, 5, 3, 9], [6, 7, 8, 9], [1, 6, 3, 5], [1, 8, 2, 7], [2, 9, 3, 6], [5, 8, 7, 9]])),
  makeScheduleScenario(8, 4, schedule([[1, 2, 3, 4], [1, 3, 2, 4], [1, 5, 2, 6], [3, 7, 4, 8], [1, 7, 3, 5], [2, 8, 4, 6], [5, 6, 7, 8], [5, 8, 6, 7]])),
  makeScheduleScenario(9, 3, schedule([[1, 10, 2, 5], [1, 6, 3, 7], [2, 8, 3, 9], [5, 10, 6, 7], [1, 8, 2, 9], [1, 5, 3, 10], [6, 8, 7, 9], [2, 10, 3, 5], [6, 9, 7, 8]])),
  makeScheduleScenario(9, 4, schedule([[1, 2, 3, 4], [1, 3, 2, 4], [1, 5, 2, 6], [3, 7, 4, 8], [1, 9, 3, 5], [2, 8, 4, 6], [5, 7, 6, 9], [5, 8, 7, 9], [6, 7, 8, 9]])),
  makeScheduleScenario(10, 4, schedule([[1, 10, 2, 5], [3, 6, 4, 7], [1, 8, 2, 9], [3, 10, 4, 5], [6, 7, 8, 9], [1, 2, 3, 4], [5, 10, 6, 8], [1, 7, 3, 9], [2, 10, 4, 6], [5, 8, 7, 9]])),
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
const saturdaySessionTitle = (date: Date) => `Buổi ${Math.floor((date.getDate() - 1) / 7) + 1} - Thứ 7 ngày ${shortDateLabel(date)}`;
function homeSession(now: Date) { const day = now.getDay(); const offset = (6 - day + 7) % 7; const date = new Date(now); date.setDate(now.getDate() + offset); const state = day === 6 ? "ĐANG DIỄN RA" : day < 3 ? "CHỜ THỨ TƯ" : "CHƯA DIỄN RA"; return { date, state }; }
function monthlyProgress(now: Date) { const year = now.getFullYear(), month = now.getMonth(); const saturdays: Date[] = []; for (let d = new Date(year, month, 1); d.getMonth() === month; d.setDate(d.getDate() + 1)) if (d.getDay() === 6) saturdays.push(new Date(d)); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); return { total: saturdays.length, completed: saturdays.filter((d) => d < today).length }; }
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

type AvatarPerson = { name: string; initials?: string; username?: string; color?: string };
type AvatarPreset = { key: string; skin: string; hair: string; shirt: string; glasses?: boolean; chubby?: boolean; beard?: boolean };
const avatarPresets: AvatarPreset[] = [
  { key: "manh", skin: "#f0b987", hair: "#17120e", shirt: "#6846e8", glasses: true },
  { key: "hung", skin: "#eeb082", hair: "#24150f", shirt: "#1e9a74", glasses: true },
  { key: "quy", skin: "#d99a6b", hair: "#12100d", shirt: "#5f46e8" },
  { key: "thanh", skin: "#efb178", hair: "#2a1710", shirt: "#df8d2a" },
  { key: "dat", skin: "#f1bf8f", hair: "#15110d", shirt: "#6ba9de" },
  { key: "ducanh", skin: "#f0b58a", hair: "#1a130f", shirt: "#3b82c4", chubby: true },
  { key: "son", skin: "#e6a678", hair: "#20120d", shirt: "#8a5be8" },
  { key: "hai", skin: "#e9a372", hair: "#18110d", shirt: "#ef6a4e", beard: true },
  { key: "phu", skin: "#f2bd8f", hair: "#17120e", shirt: "#e7ad26" },
  { key: "nam", skin: "#eab083", hair: "#11100f", shirt: "#24a892" },
];
const normalizeAvatarKey = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/\s+/g, "");
const avatarPresetFor = (person: AvatarPerson) => {
  const key = normalizeAvatarKey(`${person.username || ""} ${person.name}`);
  return avatarPresets.find((preset) => key.includes(preset.key)) ?? avatarPresets[Math.abs(key.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % avatarPresets.length];
};

function MemberAvatar({ person, className = "", rank }: { person: AvatarPerson; className?: string; rank?: number }) {
  const preset = avatarPresetFor(person);
  const style = {
    "--avatar-skin": preset.skin,
    "--avatar-hair": preset.hair,
    "--avatar-shirt": person.color || preset.shirt,
  } as CSSProperties;
  return <span className={`avatar member-avatar avatar-${preset.key} ${preset.glasses ? "has-glasses" : ""} ${preset.chubby ? "is-chubby" : ""} ${preset.beard ? "has-beard" : ""} ${className}`} style={style} aria-hidden="true">
    <span className="avatar-portrait">
      <span className="avatar-neck" />
      <span className="avatar-shirt" />
      <span className="avatar-ear avatar-ear-left" />
      <span className="avatar-ear avatar-ear-right" />
      <span className="avatar-face">
        <span className="avatar-eye avatar-eye-left" />
        <span className="avatar-eye avatar-eye-right" />
        <span className="avatar-nose" />
        <span className="avatar-mouth" />
        <span className="avatar-beard" />
        <span className="avatar-glasses avatar-glasses-left" />
        <span className="avatar-glasses avatar-glasses-right" />
        <span className="avatar-glasses-bridge" />
      </span>
      <span className="avatar-hair" />
    </span>
    {rank && rank > 0 && rank <= 3 ? <span className={`avatar-rank avatar-rank-${rank}`}>{rank === 1 ? "🏆" : rank}</span> : null}
  </span>;
}

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
  const [confirmedMatches, setConfirmedMatches] = useState<Record<number, boolean>>({});
  const [activeUser, setActiveUser] = useState<Member | null>(null);
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinPopupMode, setCheckinPopupMode] = useState<"auto" | "manual" | null>(null);
  const [dismissedCheckinPromptKey, setDismissedCheckinPromptKey] = useState<string | null>(null);
  const [loginError, setLoginError] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [spinTarget, setSpinTarget] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("draft");
  const [rankingRows, setRankingRows] = useState<RankingRow[]>([]);
  const [currentRankingRows, setCurrentRankingRows] = useState<RankingRow[]>([]);
  const [liveRankingRows, setLiveRankingRows] = useState<RankingRow[]>([]);
  const [previousRankingRows, setPreviousRankingRows] = useState<RankingRow[]>([]);
  const [championRankingRows, setChampionRankingRows] = useState<RankingRow[]>([]);
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
  const currentWeekday = now.getDay();
  const isLiveCheckinWindow = currentWeekday >= 3 && currentWeekday <= 6;
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
  const goStep = (next: number) => {
    if (next === 0) {
      setLoginError("");
      setStep(0);
      return;
    }
    if (activeUser?.role !== "admin" && !signedInMemberPresent) {
      setStep(0);
      return setLoginError("Bạn cần cập nhật điểm danh sang tham gia trước khi vào chọn số, lịch thi đấu hoặc xem kết quả buổi này.");
    }
    if (next > step && activeUser?.role !== "admin") {
      if (next === 1 && drawOpen) return setStep(1);
      if (next === 2 && scheduleOpen && currentScheduleScenario) return setStep(2);
      return;
    }
    if (next > step + 1 || (next === 1 && !drawOpen && (!isCheckinWindowOpen || !canSchedule || !allAttendanceDone)) || (next === 2 && (!currentScheduleScenario || !allDrawn))) return;
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
    setMembers((previous) => previous.map((member) => {
      const attendance = attendanceRows.find((item) => {
        const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
        return profile?.username === member.username;
      });
      const profile = attendance ? (Array.isArray(attendance.profiles) ? attendance.profiles[0] : attendance.profiles) : null;
      const nextName = profile?.full_name || member.name;
      if (attendance?.choice === "attending" && typeof attendance.drawn_number === "number") nextDrawn[nextName] = attendance.drawn_number;
      return attendance ? { ...member, name: nextName, level: Number(profile?.level || member.level) as 1 | 2, role: (profile?.role as "admin" | "member" | undefined) ?? member.role, present: attendance.choice === "attending", responded: attendance.choice !== "pending" } : { ...member, present: false, responded: false };
    }));
    setDrawn(nextDrawn);
  }, []);

  const signIn = async (username: string, password: string) => {
    const normalized = username.trim().toLowerCase();
    if (supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email: `${normalized}@anhemit.club`, password });
      if (error) return setLoginError("Tên đăng nhập hoặc mật khẩu chưa đúng.");
      const { data: profile } = await supabase.from("profiles").select("full_name, username, level, role").eq("username", normalized).single();
      const localUser = members.find((m) => m.username === normalized);
      if (profile && localUser) {
        const user = { ...localUser, name: profile.full_name, level: Number(profile.level) as 1 | 2, role: profile.role };
        setActiveUser(user); setLoginError(""); closeCheckinPopup(); return;
      }
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
        applyHomeSessionPayload(payload);
        if (payload.needsReset) {
          setDrawn({});
          setScores({});
          setConfirmedMatches({});
          setRankingRefreshTick((tick) => tick + 1);
          setAttendanceChangeNotice("Điểm danh đã thay đổi nên số đã chọn, lịch và kết quả tuần này đã được reset. Mọi người cần chọn số lại.");
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
        const [{ data: profile }, localUser] = await Promise.all([
          client.from("profiles").select("full_name, username, level, role").eq("username", username).single(),
          Promise.resolve(initialMembers.find((member) => member.username === username)),
        ]);
        if (profile && localUser) setActiveUser({ ...localUser, name: profile.full_name, level: Number(profile.level) as 1 | 2, role: profile.role });
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
    const client = supabase;
    let cancelled = false;
    const applyPendingProfiles = (profiles: SupabaseProfile[]) => {
      setMembers((previous) => previous.map((member) => {
        const profile = profiles.find((item) => item.username === member.username);
        return profile ? { ...member, name: profile.full_name || member.name, level: Number(profile.level || member.level) as 1 | 2, role: (profile.role as "admin" | "member" | undefined) ?? member.role, present: false, responded: false } : { ...member, present: false, responded: false };
      }));
    };
    const resetHomeWorkflow = async () => {
      const { data: profiles } = await client.from("profiles").select("username, full_name, level, role").eq("is_active", true).order("full_name");
      if (cancelled) return;
      applyPendingProfiles((profiles || []) as SupabaseProfile[]);
      setSessionId(null);
      setSessionStatus("draft");
      setDrawn({});
      setScores({});
      setConfirmedMatches({});
      setStep(0);
      setAttendanceSynced(true);
      if (checkinPopupMode === "auto") closeCheckinPopup();
    };
    if (!shouldLoadHomeSession) {
      void resetHomeWorkflow();
      return () => { cancelled = true; };
    }
    setAttendanceSynced(false);
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
          await resetHomeWorkflow();
          return;
        }
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
    const rankingCacheKey = `aemit-ranking-cache-v3:${month}:${currentMonthKey}:${sessionMonthKey}:${previousMonthKey}`;
    const appDataCacheKey = `aemit-app-data-cache-v1:${month}:${currentMonthKey}:${sessionMonthKey}:${previousMonthKey}`;
    const loadRanking = async () => {
      const useAggregatedAppData = true;
      const applyAppData = (payload: AppDataCachePayload) => {
        setRankingRows(payload.rankingRows);
        setCurrentRankingRows(payload.currentRankingRows);
        setLiveRankingRows(payload.liveRankingRows);
        setPreviousRankingRows(payload.previousRankingRows);
        setChampionRankingRows(payload.championRankingRows);
        setChampionRankingLabel(payload.championRankingLabel);
        setHistorySessions(payload.historySessions);
        setMonthCloseStatus(payload.monthCloseStatus);
      };
      if (useAggregatedAppData) {
        try {
          const cached = window.sessionStorage.getItem(appDataCacheKey);
          if (cached) {
            const parsed = JSON.parse(cached) as AppDataCachePayload;
            if (Date.now() - parsed.storedAt < rankingCacheTtlMs) applyAppData(parsed);
          }
        } catch {
          window.sessionStorage.removeItem(appDataCacheKey);
        }
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
          window.sessionStorage.setItem(appDataCacheKey, JSON.stringify(nextPayload));
        } catch (error) {
          setLoginError(error instanceof Error ? error.message : "Không thể tải dữ liệu CLB.");
        }
        return;
      }
      const rankingSelect = "month, total_points, points_for, points_against, point_diff, matches_played, level_next_month, created_at, profiles!monthly_results_member_id_fkey(username, full_name, level)";
      const championMonthDates = recentMonthStarts(monthStartFromKey(currentMonthKey), 12);
      const championMonthKeys = championMonthDates.map(localDateKey);
      const championFinalSessionKeys = championMonthDates.map((date) => localDateKey(finalSaturdayOfMonth(date)));
      const colorForIndex = (index: number) => ["#e7ad26", "#6ba9de", "#df8d2a", "#6846e8", "#e56a4d", "#2ba98b"][index % 6];
      const initialsFromName = (name: string) => name.split(" ").map((part: string) => part[0]).slice(-2).join("");
      const zeroRowsFromProfiles = (profiles: SupabaseProfile[]) => [...profiles]
        .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""), "vi"))
        .map((profile, index) => {
          const name = profile.full_name || "Thành viên";
          return { name, initials: initialsFromName(name), level: Number(profile.level || 2), points: 0, pointsWon: 0, pointsLost: 0, pointDiff: 0, matches: 0, color: colorForIndex(index), placeholder: true };
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
          if (!row) return { name, initials: initialsFromName(name), level: Number(profile.level || 2), points: 0, pointsWon: 0, pointsLost: 0, pointDiff: 0, matches: 0, color: colorForIndex(index), placeholder: true };
          return { name, initials: initialsFromName(name), level: Number(profile.level || row.level_next_month || 2), points: row.total_points, pointsWon: row.points_for, pointsLost: row.points_against, pointDiff: row.point_diff, matches: row.matches_played, color: colorForIndex(index), placeholder: row.matches_played === 0 };
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
        client.from("profiles").select("username, full_name, level").eq("is_active", true).order("full_name"),
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
    const historyCacheKey = "aemit-history-cache-v2";
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
      const { data } = await client.from("play_sessions").select("id, session_date, matches(count), attendances(choice)").eq("status", "completed").order("session_date", { ascending: false });
      if (!data) return;
      const nextSessions = (data as HistorySessionRow[]).map((session) => {
        const attendanceRows = session.attendances || [];
        const attendees = attendanceRows.some((row) => typeof row.choice === "string")
          ? attendanceRows.filter((row) => row.choice === "attending").length
          : attendanceRows[0]?.count || 0;
        return { id: session.id, date: session.session_date, matches: session.matches?.[0]?.count || 0, attendees };
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
      setScores(nextScores);
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
    setStep(2);
  };
  const confirmAttendanceAndOpenDraw = async () => {
    if (supabase) {
      if (!sessionId) return setLoginError("Phiên điểm danh chưa sẵn sàng. Vui lòng tải lại trang hoặc thử lại sau vài giây.");
      const { error } = await supabase.rpc("confirm_attendance", { p_session_id: sessionId });
      if (error) return setLoginError(error.message);
    }
    setLoginError("");
    setSessionStatus("checked_in");
    setStep(1);
  };

  useEffect(() => {
    if (!activeUser || screen !== "home") return;
    const isAdminUser = activeUser.role === "admin";
    if (!isAdminUser && !signedInMemberPresent) {
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
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".welcome-member, .member-profile-popover")) setShowProfileCard(false);
      if (!target.closest(".sidebar, .mobile-menu")) setSidebarOpen(false);
      if (target.closest(".modal-backdrop") && !target.closest(".checkin-modal, .confirm-modal, .history-detail, .member-editor")) {
        (document.querySelector(".modal-backdrop .modal-close") as HTMLButtonElement | null)?.click();
      }
    };
    trigger?.addEventListener("click", toggleProfile);
    document.addEventListener("pointerdown", closeOutside);
    return () => { trigger?.removeEventListener("click", toggleProfile); document.removeEventListener("pointerdown", closeOutside); };
  }, [activeUser]);
  useEffect(() => {
    if (activeUser && activeUser.role !== "admin" && screen === "members") setScreen("home");
  }, [activeUser, screen]);
  if (!activeUser && authRestoring) return <main className="login-page"><div className="login-card"><p>Đang khôi phục phiên đăng nhập...</p></div></main>;
  if (!activeUser) return <Login onLogin={signIn} error={loginError} />;
  const currentUser = members.find((member) => member.username === activeUser.username) ?? activeUser;
  const isAdmin = currentUser.role === "admin";
  const welcomeRows = championRankingRows.length ? championRankingRows : previousRankingRows.length ? previousRankingRows : rankingRows;
  const welcomeRank = welcomeRows.findIndex((row) => row.name === currentUser.name) + 1;
  const welcomeRankClass = welcomeRank > 0 && welcomeRank <= 3 ? `rank-${welcomeRank}` : "rank-none";
  const profileRows = ENABLE_TEST_FLOW ? (liveRankingRows.length ? liveRankingRows : currentRankingRows) : (currentRankingRows.length ? currentRankingRows : rankingRows);
  const profileAchievementMonth = ENABLE_TEST_FLOW ? sessionMonthLabel : currentMonthLabel;
  const profileRank = profileRows.findIndex((row) => row.name === currentUser.name) + 1;
  const profileAchievement = profileRank > 0 ? profileRows[profileRank - 1] : null;
  const profileHasRankingData = Boolean(profileAchievement && !profileAchievement.placeholder && profileAchievement.matches > 0);
  const profileRankClass = profileHasRankingData && profileRank > 0 && profileRank <= 3 ? `rank-${profileRank}` : "rank-none";
  const champion = championRankingRows[0];

  return <main className={"app-shell " + (sidebarOpen ? "sidebar-open" : "")}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" aria-hidden="true" /><div><b>ANH EM IT</b><small>BADMINTON CLUB</small></div></div>
      <nav onClick={() => setSidebarOpen(false)}>
        <button className={screen === "home" ? "active" : ""} onClick={() => setScreen("home")}><span>⌂</span> Home</button>
        {isAdmin && <button className={screen === "members" ? "active" : ""} onClick={() => setScreen("members")}><span>♙</span> Thành viên</button>}
        <button className={screen === "schedules" ? "active" : ""} onClick={() => setScreen("schedules")}><span>▤</span> Lịch thi đấu</button>
        <button className={screen === "ranking" ? "active" : ""} onClick={() => { setScreen("ranking"); setRankingMonth(ENABLE_TEST_FLOW ? sessionMonthLabel : currentMonthLabel); }}><span>▥</span> Bảng xếp hạng</button>
        <button className={screen === "history" ? "active" : ""} onClick={() => setScreen("history")}><span>◷</span> Lịch sử thi đấu</button>
        <button className={screen === "rules" ? "active" : ""} onClick={() => setScreen("rules")}><span>§</span> Thể lệ</button>
      </nav>
      <div className="club-card"><span>🏆</span><b>{currentMonthLabel}</b><small>{progress.completed} / {progress.total} buổi đã hoàn thành</small><div className="progress"><i style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }} /></div><div className={`club-top1 ${champion ? "" : "empty"}`}><small>NHÀ VÔ ĐỊCH {championRankingLabel.toUpperCase()}</small><b>{champion ? `👑 ${champion.name}` : "Chưa ghi danh"}</b><span>{champion ? `${champion.points} điểm · ${champion.pointDiff > 0 ? "+" : ""}${champion.pointDiff} hiệu số` : `Chưa có dữ liệu BXH ${championRankingLabel}.`}</span></div></div>
      <div className="profile"><MemberAvatar person={currentUser} className="small" /><div><b>{currentUser.name}</b><small>{isAdmin ? "Quản trị viên" : "Thành viên"}</small></div><button className="logout" onClick={() => { void supabase?.auth.signOut(); setActiveUser(null); }}>Đăng xuất</button></div>
    </aside>
    <section className="content">
      <header><div className="title-group"><button className="mobile-menu" aria-label="Mở menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}><span /><span /><span /></button><div><p className="eyebrow">{currentDateLabel}</p><h1>{screenTitles[screen]}</h1></div></div><p className={`welcome-member ${welcomeRankClass}`} aria-label={`Xin chào ${currentUser.name}, Level ${currentUser.level}`}><MemberAvatar person={currentUser} className="welcome-avatar" rank={welcomeRank > 0 && welcomeRank <= 3 ? welcomeRank : undefined} /><span className="welcome-text"><span className="welcome-line"><span className="welcome-copy">Xin chào!</span><b>{currentUser.name}</b></span><span className="welcome-level">Level {currentUser.level}</span></span></p></header>
      {screen === "members" ? <Members members={members} /> : screen === "rules" ? <Rules /> : screen === "schedules" ? <ScheduleLibrary scenarios={scheduleScenarios} /> : screen === "ranking" ? <Ranking month={rankingMonth} rows={rankingRows} onMonthChange={(month) => { setMonthCloseNotice(""); setRankingMonth(month); }} monthOptions={rankingMonthOptions} isAdmin={isAdmin} closeStatus={monthCloseStatus} closeNotice={monthCloseNotice} closingMonth={closingMonth} onCloseMonth={closeRankingMonth} /> : screen === "history" ? <History sessions={historySessions} currentMonth={currentMonthLabel} /> : <>
        <section className="hero"><div><span className="live-dot">● {session.state}</span><h2>{saturdaySessionTitle(session.date)}</h2><p>07:00 – 09:00</p></div><div className="hero-stats"><div><b>{present.length}</b><small>THAM GIA</small></div><div><b>{notAttending.length}</b><small>KHÔNG THAM GIA</small></div><div><b>{String(step + 1).padStart(2, "0")}<em>/{String(steps.length).padStart(2, "0")}</em></b><small>BƯỚC HIỆN TẠI</small></div></div></section>
        <section className="workflow">{steps.map((label, i) => <button key={label} className={i === step ? "current" : i < step ? "done" : ""} onClick={() => goStep(i)}><span>{i < step ? "✓" : i + 1}</span>{label}</button>)}</section>
        {loginError && <div className="warning">{loginError}</div>}
        {attendanceChangeNotice && <div className="warning">{attendanceChangeNotice}</div>}
        {step === 0 && <CheckIn members={members} setMembers={setMembers} onContinue={() => setConfirmation({ title: "Xác nhận điểm danh", message: "Mở chọn số sau khi xác nhận toàn bộ thành viên đã phản hồi?", action: confirmAttendanceAndOpenDraw })} canSchedule={canSchedule} isAdmin={isAdmin} currentUser={currentUser} isCheckinWindowOpen={isCheckinWindowOpen} isCheckinTestMode={isCheckinTestMode} openSelfCheckin={() => { setCheckinPopupMode("manual"); setShowCheckin(true); }} />}
        {step === 1 && <Draw members={present} drawn={validDrawn} allDrawn={allDrawn} drawSelf={drawSelf} spinning={spinning} spinTarget={spinTarget} currentUser={currentUser} isAdmin={isAdmin} onContinue={() => setConfirmation({ title: "Xác nhận tạo lịch", message: "Tạo lịch thi đấu từ kết quả chọn số hiện tại?", action: confirmScheduleFromDraw })} />}
        {step === 2 && <Schedule scenario={currentScheduleScenario} drawn={validDrawn} scores={scores} setScores={setScores} confirmedMatches={confirmedMatches} setConfirmedMatches={setConfirmedMatches} sessionId={sessionId} isAdmin={isAdmin} rankingRows={liveRankingRows} rankingMonth={sessionMonthLabel} onSaved={(completed) => { if (completed) { setSessionStatus("completed"); setHistoryRefreshTick((tick) => tick + 1); } setRankingMonth(ENABLE_TEST_FLOW ? sessionMonthLabel : currentMonthLabel); setRankingRefreshTick((tick) => tick + 1); }} />}
      </>}
    </section>
    {showCheckin && <CheckinModal member={activeUser} onAnswer={(attending) => { closeCheckinPopup(); if (!attending) setDismissedCheckinPromptKey(currentCheckinPromptKey); setConfirmation({ title: "Xác nhận điểm danh", message: attending ? "Bạn xác nhận tham gia buổi chơi này?" : "Bạn xác nhận không tham gia buổi chơi này?", action: () => checkInSelf(attending) }); }} onSkip={dismissCheckinPopupToAttendance} />}
    {confirmation && <ConfirmActionModal title={confirmation.title} message={confirmation.message} onCancel={() => setConfirmation(null)} onConfirm={async () => { await confirmation.action(); setConfirmation(null); }} />}
    {showProfileCard && <ProfilePopover member={currentUser} rank={profileRank} achievement={profileAchievement} achievementMonth={profileAchievementMonth} rankClass={profileRankClass} hasRankingData={profileHasRankingData} onClose={() => setShowProfileCard(false)} />}
  </main>;
}

function ProfilePopover({ member, rank, achievement, achievementMonth, rankClass, hasRankingData, onClose }: { member: Member; rank: number; achievement: RankingRow | null; achievementMonth: string; rankClass: string; hasRankingData: boolean; onClose: () => void }) {
  const isTopRank = hasRankingData && rank > 0 && rank <= 3;
  const pointDiff = achievement?.pointDiff;
  const pointDiffLabel = typeof pointDiff === "number" ? `${pointDiff > 0 ? "+" : ""}${pointDiff}` : "0";
  const positionLabel = hasRankingData && rank > 0 ? `Top ${rank}` : "—";
  const positionDisplay = isTopRank ? (rank === 1 ? "🏆 Top 1" : rank === 2 ? "🥈 Top 2" : "🥉 Top 3") : positionLabel;
  const points = achievement?.points ?? 0;
  const pointsWon = achievement?.pointsWon ?? 0;
  const pointsLost = achievement?.pointsLost ?? 0;
  const matches = achievement?.matches ?? 0;
  const roleLabel = member.role === "admin" ? "Quản trị viên" : "Thành viên";
  return <aside className={`member-profile-popover profile-${rankClass}`} role="dialog" aria-modal="true" aria-label={`Thông tin hồ sơ ${member.name}`}>
    <button className="modal-close profile-close" onClick={onClose} aria-label="Đóng">×</button>
    <div className="profile-hero-card">
      <MemberAvatar person={member} className="profile-avatar" rank={isTopRank ? rank : undefined} />
      <div className="profile-identity">
        <p>{hasRankingData && rank > 0 ? `${positionLabel} · ${achievementMonth}` : "Hồ sơ tháng hiện tại"}</p>
        <h2>{member.name}</h2>
        <span>{roleLabel} · Level {member.level}</span>
      </div>
    </div>
    <div className="profile-score-card">
      <div>
        <span>Thành tích {achievementMonth}</span>
        <b>{points} điểm</b>
      </div>
      <small>{hasRankingData ? `${matches} trận · hiệu số ${pointDiffLabel}` : "Chưa có trận trong tháng này."}</small>
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

function CheckIn({ members, onContinue, canSchedule, isAdmin, currentUser, isCheckinWindowOpen, openSelfCheckin }: { members: Member[]; setMembers: (m: Member[]) => void; onContinue: () => void; canSchedule: boolean; isAdmin: boolean; currentUser: Member; isCheckinWindowOpen: boolean; isCheckinTestMode: boolean; openSelfCheckin: () => void }) {
  const n = members.filter((m) => m.present).length;
  const l1 = members.filter((m) => m.present && m.level === 1).length;
  const l2 = n - l1;
  const allResponded = members.every((m) => m.responded);
  return <section className="panel checkin">
    <div className="panel-head checkin-head"><div><h2>Điểm danh thành viên</h2></div><div className="count-pill attendance-count-pill"><b>{n}</b><span>có mặt</span></div></div>
    <div className="member-grid">{members.map((m) => <div className="member-card readonly" key={m.name}><MemberAvatar person={m} /><div><b>{m.name}{m.name === currentUser.name && <em>Bạn</em>}</b><small>Level {m.level} · {m.responded ? <span className={"attendance-status " + (m.present ? "present" : "absent")}>{m.present ? "Tham gia" : "Không tham gia"}</span> : <span className="attendance-status pending">Chưa phản hồi</span>}</small></div><span className={"attendance-mark " + (!m.responded ? "waiting" : m.present ? "yes" : "no")}>{m.responded ? (m.present ? "✓" : "×") : ""}</span></div>)}</div>
    {isCheckinWindowOpen && !canSchedule && <div className="warning">{n < 5 ? "Cần tối thiểu 5 người có mặt để tạo lịch thi đấu tự động." : `Chưa có mẫu lịch phù hợp cho ${n} người (${l1} Level 1 + ${l2} Level 2).`}</div>}
    <div className="panel-foot checkin-actions-foot"><div className="attendance-actions"><button className="soft-btn" disabled={!isCheckinWindowOpen} onClick={openSelfCheckin}>{isCheckinWindowOpen ? (currentUser.responded ? "Cập nhật điểm danh của tôi" : "Điểm danh của tôi") : "Mở vào thứ Tư"}</button>{isAdmin && <button className="primary" disabled={!isCheckinWindowOpen || !canSchedule || !allResponded} onClick={onContinue}>Xác nhận điểm danh & mở chọn số <span>→</span></button>}</div></div>
  </section>;
}
function Draw({ members, drawn, allDrawn, drawSelf, spinning, spinTarget, currentUser, isAdmin, onContinue }: { members: Member[]; drawn: Record<string, number>; allDrawn: boolean; drawSelf: () => void; spinning: boolean; spinTarget: number | null; currentUser: Member; isAdmin: boolean; onContinue: () => void }) {
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
    {isAdmin && <div className="panel-foot draw-actions-foot"><button className="primary" disabled={!allDrawn} onClick={onContinue}>Tạo lịch thi đấu <span>→</span></button></div>}
  </section>;
}
function Schedule({ scenario, drawn, scores, setScores, confirmedMatches, setConfirmedMatches, sessionId, isAdmin, rankingRows, rankingMonth, onSaved }: { scenario: ScheduleScenario | null; drawn: Record<string, number>; scores: Record<number, [string, string]>; setScores: (x: Record<number, [string, string]>) => void; confirmedMatches: Record<number, boolean>; setConfirmedMatches: (x: Record<number, boolean>) => void; sessionId: string | null; isAdmin: boolean; rankingRows: RankingRow[]; rankingMonth: string; onSaved: (completed: boolean) => void }) {
  const namesBySlot = Object.fromEntries(Object.entries(drawn).map(([name, no]) => [no, name])) as Record<number, string>;
  if (!scenario) return <section className="panel"><div className="panel-head"><div><h2>Lịch thi đấu tự động</h2><p>Lịch chỉ được tạo khi có tối thiểu 5 thành viên và đúng tổ hợp trong thư viện lịch.</p></div></div><div className="empty-ranking">Chưa có lịch phù hợp cho danh sách điểm danh hiện tại.</div></section>;
  return <>
    <section className="panel combined-schedule-panel">
      <div className="panel-head"><div><h2>Lịch thi đấu & nhập điểm</h2></div><span className="count-pill schedule-count-pill">{scenario.matches.length} trận</span></div>
      <div className="schedule-grid">{scenario.matches.map((match, i) => <Match match={match} i={i} namesBySlot={namesBySlot} key={i} />)}</div>
    </section>
    <Results key={`${sessionId ?? "local"}-${scenario.id}`} matches={scenario.matches} drawn={drawn} scores={scores} setScores={setScores} confirmedMatches={confirmedMatches} setConfirmedMatches={setConfirmedMatches} sessionId={sessionId} isAdmin={isAdmin} onSaved={onSaved} />
    <LiveRankingSnapshot rows={rankingRows} month={rankingMonth} />
  </>;
}
function Rules() {
  const memberNames = ["Hùng", "Sơn", "Nam", "Phú", "Mạnh", "Thành", "Đạt", "Đức Anh", "Quý", "Hải"];

  return <section className="rules-page">
    <section className="rules-hero">
      <div className="rules-hero-copy">
        <p className="eyebrow">BỘ LUẬT CLB</p>
        <h2>Giải cầu lông Anh Em IT</h2>
        <p>Lịch đấu được tạo để mọi thành viên có số trận cân bằng, gặp nhiều đối thủ khác nhau và vẫn giữ tinh thần vui vẻ, cạnh tranh lành mạnh.</p>
      </div>
      <div className="rules-hero-stats" aria-label="Tóm tắt thể lệ">
        <div><b>2 vs 2</b><span>Thể thức đánh đôi</span></div>
        <div><b>4</b><span>Trận mỗi người / tuần</span></div>
        <div><b>10</b><span>Thành viên tối đa</span></div>
      </div>
    </section>

    <section className="rules-flow" aria-label="Quy trình buổi chơi">
      <article><span>01</span><b>Điểm danh</b><p>Thành viên xác nhận tham gia hoặc không tham gia trước khi lập lịch.</p></article>
      <article><span>02</span><b>Chọn số</b><p>Buổi 5 người chọn số 1–5 không phân Level; từ 6 người trở lên, Level 1 nhận số 1–4 và Level 2 nhận số 5–10 theo số người thực tế.</p></article>
      <article><span>03</span><b>Thi đấu & nhập điểm</b><p>Admin xác nhận từng trận, BXH tháng cập nhật ngay sau mỗi kết quả được lưu.</p></article>
    </section>

    <div className="rules-grid">
      <article className="rules-card">
        <div className="rules-card-title"><span className="rules-index">1</span><h2>Thể thức & mục tiêu</h2></div>
        <ul>
          <li>Thi đấu theo thể thức đánh đôi, mỗi trận gồm 2 người đấu với 2 người.</li>
          <li>Lịch đấu ưu tiên công bằng về số trận, đồng đội và đối thủ.</li>
          <li>Hạn chế tối đa việc trùng lặp cặp đấu trong cùng một buổi.</li>
          <li>Phân nhóm dựa trên BXH tháng trước để trận đấu vừa sức và hấp dẫn hơn.</li>
        </ul>
      </article>

      <article className="rules-card">
        <div className="rules-card-title"><span className="rules-index">2</span><h2>Thành viên & phân level</h2></div>
        <div className="rules-member-list" aria-label="Danh sách thành viên">
          {memberNames.map((name) => <span key={name}><b>{name}</b></span>)}
        </div>
        <div className="rules-level-grid">
          <div><span className="level-chip level-one">Level 1</span><b>Hạng 1–4</b><p>Nhóm đang dẫn đầu theo BXH tháng trước.</p></div>
          <div><span className="level-chip level-two">Level 2</span><b>Hạng 5–10</b><p>Nhóm còn lại, được cập nhật sau khi chốt BXH tháng.</p></div>
        </div>
      </article>

      <article className="rules-card rules-card-wide">
        <div className="rules-card-title"><span className="rules-index">3</span><h2>Cấu trúc lịch đấu hằng tuần</h2></div>
        <p>Lịch chỉ được tạo khi có từ 5 thành viên tham gia. Với buổi 5 người, hệ thống dùng lịch riêng không phân Level; từ 6 người trở lên sẽ chọn thư viện lịch phù hợp theo tổng số người và số lượng Level 1 / Level 2 của buổi đó.</p>
        <div className="rules-match-types">
          <div><b><span className="level-one">Level 1</span> + <span className="level-one">Level 1</span></b><span>vs</span><b><span className="level-one">Level 1</span> + <span className="level-one">Level 1</span></b></div>
          <div><b><span className="level-one">Level 1</span> + <span className="level-two">Level 2</span></b><span>vs</span><b><span className="level-one">Level 1</span> + <span className="level-two">Level 2</span></b></div>
          <div><b><span className="level-two">Level 2</span> + <span className="level-two">Level 2</span></b><span>vs</span><b><span className="level-two">Level 2</span> + <span className="level-two">Level 2</span></b></div>
        </div>
        <p className="rules-note">Nếu một trường hợp không thể áp dụng đủ mọi quy tắc, lịch sẽ ưu tiên các điều kiện khả thi theo thứ tự: đủ 4 trận mỗi người, hạn chế lặp đồng đội, rồi mới đến cân bằng tuyệt đối theo level.</p>
      </article>

      <article className="rules-card">
        <div className="rules-card-title"><span className="rules-index">4</span><h2>Nguyên tắc chi tiết</h2></div>
        <ol>
          <li>Mỗi thành viên tham gia sẽ thi đấu đúng 4 trận trong buổi.</li>
          <li>Không để hai người làm đồng đội quá 1 lần/tuần nếu lịch cho phép.</li>
          <li>Phân bổ đối thủ dựa trên level và thứ hạng hiện có.</li>
          <li>Ưu tiên đa dạng đội hình, tránh cảm giác “gặp mãi một cặp”.</li>
          <li>Khuyến khích giao lưu giữa các cấp độ để mọi trận đều mới mẻ.</li>
        </ol>
      </article>

      <article className="rules-card">
        <div className="rules-card-title"><span className="rules-index">5</span><h2>Quyền lợi & tính điểm</h2></div>
        <ul>
          <li>Thành viên đã điểm danh tham gia được đảm bảo lịch đấu 4 trận khi số người đủ điều kiện.</li>
          <li>Thắng được <strong>+1 điểm</strong>, thua <strong>0 điểm</strong>.</li>
          <li>Điểm thắng, điểm thua, hiệu số và số trận đều được lưu vào BXH tháng.</li>
          <li>Nếu vắng mặt trong buổi đã diễn ra, thành viên không được bù 4 trận của buổi đó.</li>
        </ul>
      </article>

      <article className="rules-card rules-card-wide rules-prize-card">
        <div className="rules-card-title"><span className="rules-index">6</span><h2>Cơ cấu giải thưởng</h2></div>
        <div className="rules-prizes">
          <div className="gold"><span>🏅</span><b>Vô địch</b><p>1 áo cầu lông, tối đa 200k. Nếu chọn áo đắt hơn, người nhận tự bù phần chênh lệch.</p></div>
          <div className="silver"><span>🥈</span><b>Á quân</b><p>2 cuốn cán Yonex xịn hoặc 1 đôi tất cầu lông cao cấp, khoảng 80–100k.</p></div>
          <div className="bronze"><span>🥉</span><b>Giải ba</b><p>1 đôi tất thủ công hoặc 1 cuốn cán Yonex xịn, khoảng 40–50k.</p></div>
          <div><span>🎖️</span><b>Giải tư</b><p>2 cuốn cán rẻ, khoảng 20k.</p></div>
        </div>
        <p className="rules-total">Tổng giá trị giải thưởng dự kiến: <strong>350k</strong>.</p>
      </article>
    </div>
  </section>;
}

function ScheduleLibrary({ scenarios }: { scenarios: ScheduleScenario[] }) {
  const [participantFilter, setParticipantFilter] = useState<ParticipantCount>(5);
  const visibleScenarios = scenarios.filter((scenario) => scenario.participantCount === participantFilter);
  return <section className="schedule-library">
    <section className="panel schedule-overview">
      <div>
        <p className="eyebrow">THƯ VIỆN LỊCH</p>
        <h2>Mẫu lịch theo số người & Level</h2>
        <p>Lịch chỉ có khi buổi chơi có từ 5 thành viên trở lên. Trang này chỉ để xem các trường hợp tạo lịch, không chọn hay ghi đè lịch của buổi hiện tại.</p>
      </div>
      <div className="schedule-overview-stats">
        <div><b>{participantFilter}</b><span>người tham gia</span></div>
        <div><b>{visibleScenarios.length}</b><span>trường hợp</span></div>
      </div>
    </section>
    <div className="schedule-filter" role="group" aria-label="Lọc lịch theo số lượng thành viên">
      {scheduleParticipants.map((count) => <button key={count} type="button" className={participantFilter === count ? "active" : ""} onClick={() => setParticipantFilter(count)}>{count} người</button>)}
    </div>
    <div className="schedule-case-list">
      {visibleScenarios.map((scenario) => <article className="panel schedule-case" key={scenario.id}>
        <div className="schedule-case-head">
          <div>
            <span className="schedule-case-badge">{scenario.badge}</span>
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
function Results({ matches, drawn, scores, setScores, confirmedMatches, setConfirmedMatches, sessionId, isAdmin, onSaved }: { matches: ScheduleMatch[]; drawn: Record<string, number>; scores: Record<number, [string, string]>; setScores: (x: Record<number, [string, string]>) => void; confirmedMatches: Record<number, boolean>; setConfirmedMatches: (x: Record<number, boolean>) => void; sessionId: string | null; isAdmin: boolean; onSaved: (completed: boolean) => void }) {
  const [editing, setEditing] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const namesBySlot = Object.fromEntries(Object.entries(drawn).map(([name, no]) => [no, name])) as Record<number, string>;
  const confirmedCount = Object.values(confirmedMatches).filter(Boolean).length;
  const saveMatch = async (match: ScheduleMatch, index: number) => {
    if (!supabase || !sessionId) return setNotice("Chưa có phiên Supabase để lưu kết quả.");
    const [scoreAText, scoreBText] = scores[index] ?? ["", ""];
    const scoreA = Number(scoreAText);
    const scoreB = Number(scoreBText);
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) return setNotice("Điểm phải là số nguyên không âm.");
    if (scoreA === scoreB) return setNotice("Kết quả không được hòa.");
    setSaving(index);
    setNotice("");
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/match-result", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ sessionId, matchNo: index + 1, matchType: match.type, teamA: match.teamA, teamB: match.teamB, scoreA, scoreB, totalMatches: matches.length }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; completed?: boolean };
    setSaving(null);
    if (!response.ok) {
      return setNotice(payload.error || "Không thể lưu kết quả trận.");
    }
    setConfirmedMatches({ ...confirmedMatches, [index]: true });
    setEditing({ ...editing, [index]: false });
    setNotice(`Đã cập nhật BXH sau trận ${index + 1}.`);
    onSaved(Boolean(payload.completed));
  };
  return <section className="panel result-entry-panel"><div className="panel-head"><div><h2>Điểm số từng trận</h2></div><span className="count-pill match-count-pill"><b>{confirmedCount}</b><small>/{matches.length} trận</small></span></div>{notice && <div className="warning result-notice">{notice}</div>}<div className="result-list">{matches.map((match, i) => {
    const confirmed = Boolean(confirmedMatches[i]);
    const locked = !isAdmin || (confirmed && !editing[i]);
    return <div className={"result-row schedule-result-row match-result-row " + (confirmed ? "confirmed" : "")} key={i}>
      <div className="match-result-meta"><b>{i + 1}</b>{confirmed && <span aria-label="Đã xác nhận">✓</span>}</div>
      <div className="match-result-team match-result-team-a"><TeamPair team={match.teamA} namesBySlot={namesBySlot} open={match.type === "MỞ"} /></div>
      <div className="match-score-controls"><input disabled={locked} aria-label={`Điểm đội A trận ${i + 1}`} value={scores[i]?.[0] ?? ""} onChange={e => setScores({ ...scores, [i]: [e.target.value, scores[i]?.[1] ?? ""] })}/><em>:</em><input disabled={locked} aria-label={`Điểm đội B trận ${i + 1}`} value={scores[i]?.[1] ?? ""} onChange={e => setScores({ ...scores, [i]: [scores[i]?.[0] ?? "", e.target.value] })}/></div>
      <div className="match-result-team match-result-team-b"><TeamPair team={match.teamB} namesBySlot={namesBySlot} open={match.type === "MỞ"} /></div>
      <div className="result-actions">{isAdmin && (confirmed && !editing[i] ? <button className="soft-btn result-icon-button edit" aria-label={`Sửa điểm trận ${i + 1}`} title="Sửa" onClick={() => setEditing({ ...editing, [i]: true })}><span className="result-action-icon" aria-hidden="true">✎</span><span className="result-action-text">Sửa</span></button> : <button className="primary result-icon-button save" aria-label={confirmed ? `Lưu lại điểm trận ${i + 1}` : `Xác nhận điểm trận ${i + 1}`} title={confirmed ? "Lưu lại" : "Xác nhận"} disabled={saving === i} onClick={() => void saveMatch(match, i)}><span className="result-action-icon" aria-hidden="true">{saving === i ? "…" : confirmed ? "✓" : "✓"}</span><span className="result-action-text">{saving === i ? "Đang lưu…" : confirmed ? "Lưu lại" : "Xác nhận"}</span></button>)}</div>
    </div>;
  })}</div></section>;
}
function LiveRankingSnapshot({ rows, month }: { rows: RankingRow[]; month: string }) {
  const hasRankingData = rows.some((row) => !row.placeholder && row.matches > 0);
  const completedMatches = Math.floor(rows.reduce((total, row) => total + row.matches, 0) / 4);
  return <section className="panel live-ranking-panel" aria-label={`Bảng xếp hạng theo tuần ${month}`}>
    <div className="panel-head"><div><h2>Bảng xếp hạng theo tuần</h2></div><span className="count-pill weekly-count-pill"><b>{completedMatches}</b><small>trận đã tính</small></span></div>
    <div className="rank-table live-rank-table"><div className="rank-head rank-columns"><span>Vị trí</span><span>Thành viên</span><span>Điểm</span><span>Điểm thắng</span><span>Điểm thua</span><span>Hiệu số</span><span>Số trận</span></div>{rows.length ? rows.map((row, i) => {
      const isTopRank = hasRankingData && i < 3;
      return <div className={"rank-row rank-columns " + (isTopRank ? "top-rank top-" + (i + 1) : "")} key={row.name}><b className={isTopRank ? "medal m" + i : "rank-number"}>{i + 1}</b><div className="person"><MemberAvatar person={row} className="small" /><b>{row.name}</b><span className="level">L{row.level}</span></div><b className="point-value">{row.points}</b><span>{row.pointsWon}</span><span>{row.pointsLost}</span><span className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</span><span>{row.matches}</span><div className="rank-mobile-stats" aria-hidden="true"><span><em>Thắng</em><b>{row.pointsWon}</b></span><span><em>Thua</em><b>{row.pointsLost}</b></span><span><em>Hiệu</em><b className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</b></span><span><em>Trận</em><b>{row.matches}</b></span></div></div>;
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
function drawCanvasMemberAvatar(ctx: CanvasRenderingContext2D, person: AvatarPerson, centerX: number, centerY: number, size: number) {
  const preset = avatarPresetFor(person);
  const radius = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.clip();
  const bg = ctx.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius);
  bg.addColorStop(0, "#fff8df");
  bg.addColorStop(1, person.color || preset.shirt);
  ctx.fillStyle = bg;
  ctx.fillRect(centerX - radius, centerY - radius, size, size);
  ctx.fillStyle = person.color || preset.shirt;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY + radius * 0.82, radius * 0.62, radius * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = preset.skin;
  ctx.beginPath();
  ctx.roundRect(centerX - radius * 0.16, centerY + radius * 0.22, radius * 0.32, radius * 0.34, radius * 0.08);
  ctx.fill();
  const faceWidth = radius * (preset.chubby ? 1.16 : 0.98);
  ctx.beginPath();
  ctx.ellipse(centerX, centerY + radius * 0.06, faceWidth * 0.5, radius * 0.58, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = preset.hair;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY - radius * 0.44, faceWidth * 0.55, radius * 0.32, -0.1, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(centerX - radius * 0.24, centerY - radius * 0.28, radius * 0.3, radius * 0.22, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#17120f";
  ctx.beginPath();
  ctx.arc(centerX - radius * 0.18, centerY + radius * 0.02, radius * 0.035, 0, Math.PI * 2);
  ctx.arc(centerX + radius * 0.18, centerY + radius * 0.02, radius * 0.035, 0, Math.PI * 2);
  ctx.fill();
  if (preset.glasses) {
    ctx.strokeStyle = "#17120f";
    ctx.lineWidth = Math.max(1.2, size * 0.035);
    ctx.beginPath();
    ctx.roundRect(centerX - radius * 0.34, centerY - radius * 0.07, radius * 0.27, radius * 0.18, radius * 0.06);
    ctx.roundRect(centerX + radius * 0.07, centerY - radius * 0.07, radius * 0.27, radius * 0.18, radius * 0.06);
    ctx.moveTo(centerX - radius * 0.07, centerY + radius * 0.02);
    ctx.lineTo(centerX + radius * 0.07, centerY + radius * 0.02);
    ctx.stroke();
  }
  ctx.strokeStyle = "#6f3526";
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.beginPath();
  ctx.arc(centerX, centerY + radius * 0.25, radius * 0.16, 0.15, Math.PI - 0.15);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
}
const rankingMonthForFile = (label: string) => {
  const date = monthDateFromLabel(label);
  if (!date) return { display: label, file: label.replace(/[\\/:*?"<>|]/g, "-") };
  const monthText = String(date.getMonth() + 1).padStart(2, "0");
  return { display: `Tháng ${monthText}/${date.getFullYear()}`, file: `${monthText}-${date.getFullYear()}` };
};
async function downloadRankingImage(month: string, rows: RankingRow[]) {
  if (typeof document === "undefined") return;
  await document.fonts?.ready.catch(() => undefined);
  const ratio = Math.max(1, Math.min(2.4, window.devicePixelRatio || 1));
  const visibleRows = rows.length ? rows : [{ name: "Chưa có dữ liệu", initials: "—", level: 2, points: 0, pointsWon: 0, pointsLost: 0, pointDiff: 0, matches: 0, color: "#b8760e", placeholder: true }];
  const width = 1080;
  const rowHeight = 82;
  const height = 226 + visibleRows.length * rowHeight + 62;
  const headingFont = `"Bricolage Grotesque", "Be Vietnam Pro", Arial, sans-serif`;
  const bodyFont = `"DM Sans", "Be Vietnam Pro", Arial, sans-serif`;
  const { display, file } = rankingMonthForFile(month);
  const canvas = document.createElement("canvas");
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#fffaf0");
  bg.addColorStop(0.62, "#fffdf8");
  bg.addColorStop(1, "#ffefbd");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255, 183, 0, 0.18)";
  ctx.beginPath();
  ctx.arc(width - 82, 88, 190, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff7df";
  fillRoundRect(ctx, 34, 30, width - 68, 150, 30);
  const hero = ctx.createLinearGradient(34, 30, width - 34, 180);
  hero.addColorStop(0, "#17140f");
  hero.addColorStop(0.58, "#2a210d");
  hero.addColorStop(1, "#946b00");
  ctx.fillStyle = hero;
  fillRoundRect(ctx, 34, 30, width - 68, 150, 30);
  ctx.fillStyle = "rgba(255, 214, 109, 0.14)";
  ctx.beginPath();
  ctx.arc(width - 112, 126, 118, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffcf4a";
  ctx.font = `900 16px ${bodyFont}`;
  ctx.letterSpacing = "0.08em";
  ctx.fillText("ANH EM IT BADMINTON CLUB", 72, 68);
  ctx.letterSpacing = "0";
  ctx.fillStyle = "#fffaf0";
  ctx.font = `900 48px ${headingFont}`;
  ctx.fillText("Bảng xếp hạng", 72, 122);
  ctx.fillStyle = "#ffd66b";
  ctx.font = `900 24px ${bodyFont}`;
  ctx.fillText(display, 72, 154);
  ctx.textAlign = "right";
  ctx.fillStyle = "#fff3c9";
  ctx.font = `900 54px ${headingFont}`;
  ctx.fillText(String(visibleRows[0]?.points ?? 0), width - 86, 112);
  ctx.fillStyle = "rgba(255, 250, 240, 0.72)";
  ctx.font = `800 15px ${bodyFont}`;
  ctx.fillText("điểm dẫn đầu", width - 86, 139);
  ctx.textAlign = "left";
  const headerY = 198;
  ctx.fillStyle = "#17140f";
  fillRoundRect(ctx, 42, headerY, width - 84, 44, 18);
  ctx.fillStyle = "#fff7df";
  ctx.font = `900 13px ${bodyFont}`;
  ctx.fillText("HẠNG", 72, headerY + 28);
  ctx.fillText("THÀNH VIÊN", 158, headerY + 28);
  ctx.textAlign = "right";
  ctx.fillText("ĐIỂM", 612, headerY + 28);
  ctx.fillText("THẮNG", 735, headerY + 28);
  ctx.fillText("THUA", 850, headerY + 28);
  ctx.fillText("HIỆU", 952, headerY + 28);
  ctx.fillText("TRẬN", 1020, headerY + 28);
  ctx.textAlign = "left";
  visibleRows.forEach((row, index) => {
    const y = 258 + index * rowHeight;
    const isTop = index < 3 && !row.placeholder;
    const rowGradient = ctx.createLinearGradient(42, y, width - 42, y + 66);
    rowGradient.addColorStop(0, index === 0 ? "#fff6cf" : index === 1 ? "#eef2f7" : index === 2 ? "#fff0e6" : "#ffffff");
    rowGradient.addColorStop(1, "#fffdf8");
    ctx.fillStyle = rowGradient;
    fillRoundRect(ctx, 42, y, width - 84, 66, 20);
    ctx.strokeStyle = isTop ? ["#e8b229", "#aeb6c5", "#cd8752"][index] : "rgba(32, 27, 20, 0.08)";
    ctx.lineWidth = isTop ? 2 : 1;
    strokeRoundRect(ctx, 42.5, y + 0.5, width - 85, 65, 20);
    ctx.fillStyle = index === 0 ? "#ffb700" : index === 1 ? "#c6cedb" : index === 2 ? "#d88639" : "#fffaf0";
    ctx.beginPath();
    ctx.arc(84, y + 33, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#17140f";
    ctx.font = `900 18px ${bodyFont}`;
    ctx.textAlign = "center";
    ctx.fillText(String(index + 1), 84, y + 40);
    drawCanvasMemberAvatar(ctx, row, 142, y + 33, 38);
    ctx.textAlign = "left";
    ctx.fillStyle = "#15120e";
    ctx.font = `900 24px ${headingFont}`;
    ctx.fillText(row.name, 176, y + 30);
    ctx.fillStyle = "#b8760e";
    ctx.font = `900 13px ${bodyFont}`;
    ctx.fillText(`Level ${row.level}`, 176, y + 52);
    ctx.textAlign = "right";
    ctx.fillStyle = index === 0 ? "#d28a00" : index === 1 ? "#657080" : index === 2 ? "#b96125" : "#15120e";
    ctx.font = `900 34px ${headingFont}`;
    ctx.fillText(String(row.points), 612, y + 44);
    ctx.fillStyle = "#15120e";
    ctx.font = `900 18px ${bodyFont}`;
    ctx.fillText(String(row.pointsWon), 735, y + 41);
    ctx.fillText(String(row.pointsLost), 850, y + 41);
    ctx.fillStyle = row.pointDiff >= 0 ? "#047843" : "#c63f51";
    ctx.fillText(`${row.pointDiff > 0 ? "+" : ""}${row.pointDiff}`, 952, y + 41);
    ctx.fillStyle = "#15120e";
    ctx.fillText(String(row.matches), 1020, y + 41);
    ctx.textAlign = "left";
  });
  ctx.fillStyle = "rgba(21, 18, 14, 0.56)";
  ctx.font = `800 14px ${bodyFont}`;
  ctx.fillText(`Xuất lúc ${new Date().toLocaleString("vi-VN")}`, 56, height - 28);
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
function Ranking({ month, rows, onMonthChange, monthOptions, isAdmin, closeStatus, closeNotice, closingMonth, onCloseMonth }: { month: string; rows: RankingRow[]; onMonthChange: (month: string) => void; monthOptions: string[]; isAdmin: boolean; closeStatus: MonthCloseStatus | null; closeNotice: string; closingMonth: boolean; onCloseMonth: () => void }) {
  const hasRankingData = rows.some((row) => !row.placeholder && row.matches > 0);
  return <section className="ranking">
    <div className="ranking-toolbar"><div className="ranking-filter-row"><label>Tháng<select value={month} onChange={(e) => onMonthChange(e.target.value)}>{monthOptions.map((option) => <option key={option}>{option}</option>)}</select></label><button type="button" className="soft-btn ranking-export-btn" onClick={() => void downloadRankingImage(month, rows)}><span className="ranking-export-full">Lưu ảnh BXH</span><span className="ranking-export-short">Lưu ảnh</span></button></div><p className="ranking-note">{closeStatus?.closed ? "BXH tháng này đã chốt, dữ liệu chỉ còn xem." : "Admin chốt BXH sau khi buổi cuối tháng hoàn tất để tạo tháng mới."}</p></div>
    {isAdmin && closeStatus && <div className={"month-close-card " + (closeStatus.closed ? "closed" : closeStatus.eligible ? "ready" : "waiting")}>
      <div>
        <span>{closeStatus.closed ? "ĐÃ CHỐT THÁNG" : closeStatus.eligible ? "SẴN SÀNG CHỐT" : "CHỜ ĐỦ ĐIỀU KIỆN"}</span>
        <h3>{closeStatus.monthLabel} → {closeStatus.nextMonthLabel}</h3>
        <p>{closeStatus.message}</p>
        {closeNotice && <p className="month-close-feedback" aria-live="polite">{closeNotice}</p>}
      </div>
      {!closeStatus.closed && <button className="primary" disabled={!closeStatus.eligible || closingMonth} onClick={onCloseMonth}>{closingMonth ? "Đang chốt..." : `Chốt BXH ${closeStatus.monthLabel}`}</button>}
    </div>}
    <div className="rank-table"><div className="rank-head rank-columns"><span>Vị trí</span><span>Thành viên</span><span>Điểm</span><span>Điểm thắng</span><span>Điểm thua</span><span>Hiệu số</span><span>Số trận</span></div>{rows.length ? rows.map((row, i) => {
      const isTopRank = hasRankingData && i < 3;
      return <div className={"rank-row rank-columns " + (isTopRank ? "top-rank top-" + (i + 1) : "")} key={row.name}><b className={isTopRank ? "medal m" + i : "rank-number"}>{i + 1}</b><div className="person"><MemberAvatar person={row} className="small" /><b>{row.name}</b><span className="level">L{row.level}</span></div><b className="point-value">{row.points}</b><span>{row.pointsWon}</span><span>{row.pointsLost}</span><span className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</span><span>{row.matches}</span><div className="rank-mobile-stats" aria-hidden="true"><span><em>Thắng</em><b>{row.pointsWon}</b></span><span><em>Thua</em><b>{row.pointsLost}</b></span><span><em>Hiệu</em><b className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</b></span><span><em>Trận</em><b>{row.matches}</b></span></div></div>;
    }) : <div className="empty-ranking">Chưa có thành viên hoạt động để hiển thị BXH {month}.</div>}</div>
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
        week: `Tuần ${Math.ceil(date.getDate() / 7)} · Thứ Bảy ${date.toLocaleDateString("vi-VN")}`,
        title: saturdaySessionTitle(date),
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
      <div className="history-list">{visible.length ? visible.map((session) => <article key={session.id}><div><span>{session.week}</span><h3>{session.title}</h3><p>{session.detail}</p></div><button className="soft-btn" onClick={() => void showDetail(session)}>Xem chi tiết →</button></article>) : <div className="empty-ranking">Chưa có dữ liệu cho bộ lọc này.</div>}</div>
    </section>
    {detail && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="history-detail"><button className="modal-close" onClick={() => setDetail(null)}>×</button><p className="eyebrow">KẾT QUẢ THI ĐẤU</p><h2>{detail.title}</h2><div className="history-match-list">{detail.rows.map((match) => <article className="history-match-row" key={match.no}><span className="history-match-index">Trận {match.no}</span><span className="history-team history-team-a">{match.a}</span><strong className="history-score"><span>{match.sa}</span><i>:</i><span>{match.sb}</span></strong><span className="history-team history-team-b">{match.b}</span></article>)}</div></section></div>}
  </>;
}
function Members({ members }: { members: Member[] }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [fullName, setFullName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const normalizeSearch = (value: string) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
  const normalizedSearch = normalizeSearch(searchTerm);
  const visibleMembers = normalizedSearch
    ? members.filter((member) => normalizeSearch(`${member.name} ${member.username} ${member.initials} level ${member.level} l${member.level}`).includes(normalizedSearch))
    : members;
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".member-actions")) setOpenMenu(null);
      if (target.closest(".modal-backdrop") && !target.closest(".member-editor, .confirm-modal")) setEditing(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const save = async () => {
    if (!editing || !fullName.trim()) return;
    setConfirm({ title: "Xác nhận cập nhật", message: `Lưu thông tin mới cho ${editing.name}?`, action: async () => {
      if (supabase) { const { error } = await supabase.rpc("admin_update_member", { p_username: editing.username, p_full_name: fullName.trim() }); if (error) { window.alert(error.message); return; } }
      window.location.reload();
    }});
  };
  const remove = (member: Member) => setConfirm({ title: "Xác nhận xóa thành viên", message: `Xóa ${member.name} khỏi danh sách hoạt động? Lịch sử thi đấu vẫn được giữ lại.`, action: async () => {
    if (supabase) { const { error } = await supabase.rpc("admin_remove_member", { p_username: member.username }); if (error) { window.alert(error.message); return; } }
    window.location.reload();
  }});
  return <>
    <section className="member-summary">
      <div><b>{members.length}</b><span>Tổng thành viên</span></div>
      <div><b>{visibleMembers.length}</b><span>{normalizedSearch ? "Kết quả tìm kiếm" : "Đang hoạt động"}</span></div>
    </section>
    <section className="panel">
      <div className="panel-head">
        <div><h2>Danh sách thành viên</h2><p>Quản lý thông tin các thành viên CLB.</p></div>
        <input className="search" placeholder="⌕  Tìm tên, username, level..." value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setOpenMenu(null); }} />
      </div>
      <div className="member-table">{visibleMembers.length ? visibleMembers.map((member) => <div key={member.username}><div className="person"><MemberAvatar person={member} /><div><b>{member.name}</b><small>@{member.username}</small></div></div><span className="status">● Hoạt động</span><div className="member-actions"><button className="more" aria-label={`Thao tác ${member.name}`} onClick={() => setOpenMenu(openMenu === member.username ? null : member.username)}>•••</button>{openMenu === member.username && <div className="member-menu"><button onClick={() => { setEditing(member); setFullName(member.name); setOpenMenu(null); }}>Sửa thành viên</button><button className="danger-text" onClick={() => { remove(member); setOpenMenu(null); }}>Xóa thành viên</button></div>}</div></div>) : <div className="empty-ranking">Không tìm thấy thành viên phù hợp với “{searchTerm}”.</div>}</div>
    </section>
    {editing && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="member-editor"><button className="modal-close" onClick={() => setEditing(null)}>×</button><p className="eyebrow">CHỈNH SỬA THÀNH VIÊN</p><h2>{editing.name}</h2><label>Họ và tên<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoFocus /></label><div className="editor-actions"><button className="soft-btn" onClick={() => setEditing(null)}>Hủy bỏ</button><button className="primary" onClick={() => void save()}>Lưu</button></div></section></div>}
    {confirm && <ConfirmActionModal title={confirm.title} message={confirm.message} onCancel={() => setConfirm(null)} onConfirm={async () => { try { await confirm.action(); } finally { setConfirm(null); } }} />}
  </>;
}

function Login({ onLogin, error }: { onLogin: (username: string, password: string) => void | Promise<void>; error: string }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  return <main className="login-page"><section className="login-card"><div className="login-brand"><span aria-hidden="true" /><div><b>ANH EM IT</b><small>BADMINTON CLUB</small></div></div><div><p className="eyebrow">Xin chào!</p><h1>Đăng nhập CLB</h1><p>Đăng nhập để điểm danh và theo dõi lịch thi đấu của bạn.</p></div><form onSubmit={(e) => { e.preventDefault(); void onLogin(username, password); }}><label>Tên đăng nhập<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Nhập tên đăng nhập" /></label><label>Mật khẩu<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nhập mật khẩu" /></label>{error && <p className="login-error">{error}</p>}<button className="primary" type="submit">Đăng nhập <span>→</span></button></form></section></main>;
}

function CheckinModal({ member, onAnswer, onSkip }: { member: Member; onAnswer: (attending: boolean) => void; onSkip: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Điểm danh buổi chơi" onPointerDown={(event) => { if (event.target === event.currentTarget) onSkip(); }}><section className="checkin-modal"><button className="modal-close" onClick={onSkip} aria-label="Đóng">×</button><span className="modal-icon">🏸</span><p className="eyebrow">BUỔI CHƠI THỨ BẢY</p><h2>Chào {member.name}, bạn có tham gia không?</h2><p>Hãy phản hồi để Admin chốt danh sách và mở chọn số vào thứ Tư. Bạn vẫn có thể thay đổi sau trong trang chính.</p><div className="modal-actions"><button className="primary" onClick={() => onAnswer(true)}>✓ Tôi tham gia</button><button className="secondary" onClick={() => onAnswer(false)}>Tôi không tham gia</button></div><button className="skip" onClick={onSkip}>Để sau</button></section></div>;
}
function ConfirmActionModal({ title, message, onCancel, onConfirm }: { title: string; message: string; onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="confirm-modal"><span className="modal-icon">?</span><h2>{title}</h2><p>{message}</p><div className="modal-actions confirm-actions"><button className="secondary" onClick={onCancel}>Không</button><button className="primary" onClick={() => void onConfirm()}>Có, xác nhận</button></div></section></div>;
}
