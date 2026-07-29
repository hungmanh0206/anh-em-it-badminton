"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Member = { name: string; initials: string; level: 1 | 2; color: string; present: boolean; username: string; password: string; role?: "admin" | "member"; responded?: boolean };
type RankingRow = { name: string; initials: string; level: number; points: number; pointsWon: number; pointsLost: number; pointDiff: number; matches: number; color: string; placeholder?: boolean };
type MonthCloseStatus = { monthKey: string; monthLabel: string; nextMonthKey: string; nextMonthLabel: string; finalSessionCompleted: boolean; closed: boolean; eligible: boolean; currentRows: number; message: string };
type HistorySession = { id: string; date: string; matches: number; attendees: number };
type SupabaseProfile = { id?: string; username?: string | null; full_name?: string | null; level?: number | string | null; role?: "admin" | "member" | string | null; is_active?: boolean | null };
type MonthlyResultRow = { month?: string | null; total_points: number; points_for: number; points_against: number; point_diff: number; matches_played: number; level_next_month: number | null; profiles: SupabaseProfile | SupabaseProfile[] | null };
type HistorySessionRow = { id: string; session_date: string; matches?: { count: number }[] | null; attendances?: { count: number }[] | null };
type MatchRow = { match_no: number; team_a: string[]; team_b: string[]; score_a: number; score_b: number };
type SavedMatchRow = { match_no: number; score_a: number | null; score_b: number | null };
type ProfileRow = { id: string; full_name: string };
type Screen = "home" | "members" | "schedules" | "ranking" | "history";
type SessionStatus = "draft" | "checked_in" | "drawn" | "scheduled" | "completed";
type AttendanceRow = { choice: "pending" | "attending" | "absent"; drawn_number: number | null; profiles: SupabaseProfile | SupabaseProfile[] | null };
type HomeSessionPayload = { inactive?: boolean; sessionId?: string | null; sessionDate?: string; status?: SessionStatus; attendances?: AttendanceRow[]; needsReset?: boolean; error?: string };
const scheduleParticipants = [6, 7, 8, 9, 10] as const;
type ParticipantCount = typeof scheduleParticipants[number];
type MatchPattern = readonly [number, number, number, number, string?];
type ScheduleMatch = { teamA: readonly [number, number]; teamB: readonly [number, number]; type: string };
type ScheduleScenario = { id: string; participantCount: ParticipantCount; level1Count: number; level2Count: number; title: string; subtitle: string; badge: string; note: string; matches: ScheduleMatch[]; relaxedReason?: string };
const screenTitles: Record<Screen, string> = {
  home: "Home",
  members: "Quản lý thành viên",
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
const drawSlotsForLevel = (level: 1 | 2, level1Count: number, level2Count: number) => {
  const count = Math.max(0, level === 1 ? level1Count : level2Count);
  const start = level === 1 ? 1 : 5;
  return Array.from({ length: count }, (_, index) => start + index);
};
const wheelGradient = (level: 1 | 2, count: number) => {
  const colors = level === 1 ? ["#1d7ff2", "#bfe4ff", "#0b5fc8", "#eaf6ff"] : ["#0e9a64", "#b9f5d0", "#08744f", "#effdf5"];
  const safeCount = Math.max(1, count);
  return `conic-gradient(${Array.from({ length: safeCount }, (_, index) => {
    const start = (index * 360) / safeCount;
    const end = ((index + 1) * 360) / safeCount;
    return `${colors[index % colors.length]} ${start}deg ${end}deg`;
  }).join(", ")})`;
};
const drawSlotRangeLabel = (level: 1 | 2, level1Count: number, level2Count: number) => {
  const slots = drawSlotsForLevel(level, level1Count, level2Count);
  if (!slots.length) return "chưa có số";
  return slots.length === 1 ? `số ${slots[0]}` : `số ${slots[0]}–${slots[slots.length - 1]}`;
};
const isDrawSlotValid = (level: 1 | 2, slot: number, level1Count: number, level2Count: number) =>
  drawSlotsForLevel(level, level1Count, level2Count).includes(slot);
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
  return {
    id: `${participantCount}-players-${level1Count}-l1-${level2Count}-l2`,
    participantCount,
    level1Count,
    level2Count,
    title: `${participantCount} người · ${level1Count} Level 1 + ${level2Count} Level 2`,
    subtitle: `${matches.length} trận`,
    badge: `${level1Count}L1 + ${level2Count}L2`,
    note: relaxedReason ?? `Áp dụng khi buổi chơi có ${level1Count} thành viên Level 1 và ${level2Count} thành viên Level 2.`,
    matches,
    relaxedReason,
  };
};
const scheduleScenarios: ScheduleScenario[] = [
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
function homeSession(now: Date) { const day = now.getDay(); const offset = (6 - day + 7) % 7; const date = new Date(now); date.setDate(now.getDate() + offset); const state = day === 6 ? "ĐANG DIỄN RA" : day < 3 ? "CHỜ THỨ TƯ" : "CHƯA DIỄN RA"; return { date, state }; }
function monthlyProgress(now: Date) { const year = now.getFullYear(), month = now.getMonth(); const saturdays: Date[] = []; for (let d = new Date(year, month, 1); d.getMonth() === month; d.setDate(d.getDate() + 1)) if (d.getDay() === 6) saturdays.push(new Date(d)); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); return { total: saturdays.length, completed: saturdays.filter((d) => d < today).length }; }
function finalSaturdayOfMonth(date: Date) { const finalSaturday = new Date(date.getFullYear(), date.getMonth() + 1, 0); while (finalSaturday.getDay() !== 6) finalSaturday.setDate(finalSaturday.getDate() - 1); return finalSaturday; }
const recentMonthStarts = (start: Date, count: number) => Array.from({ length: count }, (_, index) => new Date(start.getFullYear(), start.getMonth() - index, 1));
const sortMonthlyResultRows = (rows: MonthlyResultRow[]) => [...rows].sort((a, b) =>
  b.total_points - a.total_points ||
  b.point_diff - a.point_diff ||
  b.points_for - a.points_for ||
  b.matches_played - a.matches_played
);
const TEMP_ENABLE_CHECKIN_FOR_TEST = false;
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

export default function Home() {
  const [screen, setScreen] = useState<Screen>(screenFromLocation);
  const [rankingMonth, setRankingMonth] = useState(() => monthLabel(new Date()));
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("draft");
  const [rankingRows, setRankingRows] = useState<RankingRow[]>([]);
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
  const nextVisibleMonthStart = nextMonthStartDate(currentMonthStart);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const rankingMonthOptions = [nextVisibleMonthStart, currentMonthStart, previousMonthStart, new Date(now.getFullYear(), now.getMonth() - 2, 1)].map(monthLabel).filter((month) => !hiddenRankingMonths.has(month));
  const previousMonthKey = localDateKey(previousMonthStart);
  const isCheckinTestMode = TEMP_ENABLE_CHECKIN_FOR_TEST && now.getDay() !== 3;
  const isCheckinWindowOpen = TEMP_ENABLE_CHECKIN_FOR_TEST || now.getDay() === 3;
  const shouldLoadHomeSession = TEMP_ENABLE_CHECKIN_FOR_TEST || now.getDay() >= 3;
  const session = homeSession(now);
  const sessionDateKey = localDateKey(session.date);
  const currentCheckinPromptKey = `${activeUsername || "guest"}:${sessionId || sessionDateKey}`;
  const signedInMember = activeUsername ? members.find((member) => member.username === activeUsername) : null;
  const signedInMemberPresent = Boolean(signedInMember?.present);
  const progress = monthlyProgress(now);
  const present = members.filter((m) => m.present);
  const level1PresentCount = present.filter((m) => m.level === 1).length;
  const level2PresentCount = present.length - level1PresentCount;
  const validDrawn = Object.fromEntries(present.flatMap((member) => {
    const slot = drawn[member.name];
    return typeof slot === "number" && isDrawSlotValid(member.level, slot, level1PresentCount, level2PresentCount) ? [[member.name, slot]] : [];
  })) as Record<string, number>;
  const currentScheduleScenario = findScheduleScenario(present.length, level1PresentCount);
  const canSchedule = present.length >= 6 && Boolean(currentScheduleScenario);
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
        if (payload.needsReset) setAttendanceChangeNotice("Một thành viên vừa thay đổi điểm danh sau khi đã chọn số/lập lịch.");
        setActiveUser({ ...activeUser, present: attending, responded: true });
        closeCheckinPopup();
        setScreen("home");
        if (attending) {
          setDismissedCheckinPromptKey(null);
          const nextStatus = payload.status || sessionStatus;
          if (["checked_in", "drawn", "scheduled", "completed"].includes(nextStatus)) setStep(1);
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
    if (!syncedUser.present) {
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
    if (!supabase) return;
    const client = supabase;
    const selectedMonthDate = monthDateFromLabel(rankingMonth) ?? new Date();
    const month = localDateKey(selectedMonthDate);
    const selectedNextMonthDate = nextMonthStartDate(selectedMonthDate);
    const selectedNextMonthKey = localDateKey(selectedNextMonthDate);
    const selectedFinalSaturdayKey = localDateKey(finalSaturdayOfMonth(selectedMonthDate));
    const loadRanking = async () => {
      const rankingSelect = "month, total_points, points_for, points_against, point_diff, matches_played, level_next_month, profiles!monthly_results_member_id_fkey(username, full_name, level)";
      const championMonthDates = recentMonthStarts(monthStartFromKey(currentMonthKey), 12);
      const championMonthKeys = championMonthDates.map(localDateKey);
      const championFinalSessionKeys = championMonthDates.map((date) => localDateKey(finalSaturdayOfMonth(date)));
      const zeroRowsFromProfiles = (profiles: SupabaseProfile[]) => [...profiles]
        .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""), "vi"))
        .map((profile, index) => {
          const name = profile.full_name || "Thành viên";
          return { name, initials: name.split(" ").map((part: string) => part[0]).slice(-2).join(""), level: Number(profile.level || 2), points: 0, pointsWon: 0, pointsLost: 0, pointDiff: 0, matches: 0, color: ["#e7ad26", "#6ba9de", "#df8d2a", "#6846e8", "#e56a4d", "#2ba98b"][index % 6], placeholder: true };
        });
      const mapRows = (rows: MonthlyResultRow[]) => rows.map((row, index) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        const name = profile?.full_name || "Thành viên";
        return { name, initials: name.split(" ").map((part: string) => part[0]).slice(-2).join(""), level: Number(profile?.level || row.level_next_month || 2), points: row.total_points, pointsWon: row.points_for, pointsLost: row.points_against, pointDiff: row.point_diff, matches: row.matches_played, color: ["#e7ad26", "#6ba9de", "#df8d2a", "#6846e8", "#e56a4d", "#2ba98b"][index % 6] };
      });
      const [{ data }, { data: currentData }, { data: previousData }, { data: championData }, { data: championFinalSessions }, { data: activeProfiles }, { data: finalSession }, { count: nextMonthRows }] = await Promise.all([
        client.from("monthly_results").select(rankingSelect).eq("month", month).order("total_points", { ascending: false }).order("point_diff", { ascending: false }).order("points_for", { ascending: false }),
        client.from("monthly_results").select(rankingSelect).eq("month", currentMonthKey).order("total_points", { ascending: false }).order("point_diff", { ascending: false }).order("points_for", { ascending: false }),
        client.from("monthly_results").select(rankingSelect).eq("month", previousMonthKey).order("total_points", { ascending: false }).order("point_diff", { ascending: false }).order("points_for", { ascending: false }),
        client.from("monthly_results").select(rankingSelect).in("month", championMonthKeys),
        client.from("play_sessions").select("session_date, status").in("session_date", championFinalSessionKeys),
        client.from("profiles").select("username, full_name, level").eq("is_active", true).order("full_name"),
        client.from("play_sessions").select("status").eq("session_date", selectedFinalSaturdayKey).maybeSingle(),
        client.from("monthly_results").select("id", { count: "exact", head: true }).eq("month", selectedNextMonthKey),
      ]);
      const selectedRows = data ? data as MonthlyResultRow[] : [];
      const selectedHasMatchData = selectedRows.some((row) => row.matches_played > 0);
      const activeProfileRows = (activeProfiles || []) as SupabaseProfile[];
      const currentRowsForLive = month === currentMonthKey ? selectedRows : currentData ? currentData as MonthlyResultRow[] : [];
      const currentHasMatchData = currentRowsForLive.some((row) => row.matches_played > 0);
      setRankingRows(selectedHasMatchData ? mapRows(selectedRows) : zeroRowsFromProfiles(activeProfileRows));
      setLiveRankingRows(currentHasMatchData ? mapRows(currentRowsForLive) : zeroRowsFromProfiles(activeProfileRows));
      setPreviousRankingRows(previousData ? mapRows(previousData as MonthlyResultRow[]) : []);
      const championRowsByMonth = new Map<string, MonthlyResultRow[]>();
      ((championData || []) as MonthlyResultRow[]).forEach((row) => {
        if (!row.month) return;
        const rows = championRowsByMonth.get(row.month) ?? [];
        rows.push(row);
        championRowsByMonth.set(row.month, rows);
      });
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
        setChampionRankingRows(mapRows(sortMonthlyResultRows(championRowsByMonth.get(championMonthKey) ?? [])));
        setChampionRankingLabel(monthLabel(latestChampionMonth));
      } else {
        setChampionRankingRows([]);
        setChampionRankingLabel(monthLabel(monthStartFromKey(previousMonthKey)));
      }
      const currentRows = data ? (data as MonthlyResultRow[]).length : 0;
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
  }, [rankingMonth, currentMonthKey, previousMonthKey, rankingRefreshTick]);
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const channel = client
      .channel("club-ranking-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "monthly_results" }, () => {
        setRankingRefreshTick((tick) => tick + 1);
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, []);
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
    if (!supabase || !activeUser || activeUser.role !== "admin" || !sessionId) return;
    const client = supabase;
    const checkRequests = async () => {
      const { data } = await client.from("attendance_change_requests").select("id, profiles!attendance_change_requests_member_id_fkey(full_name)").eq("session_id", sessionId).eq("status", "pending").limit(1);
      if (data?.[0]) { const profile = Array.isArray(data[0].profiles) ? data[0].profiles[0] : data[0].profiles; setAttendanceChangeNotice(`${profile?.full_name || "Một thành viên"} vừa thay đổi điểm danh sau khi đã chọn số/lập lịch.`); }
    };
    void checkRequests();
    const channel = client.channel("attendance-change-admin").on("postgres_changes", { event: "INSERT", schema: "public", table: "attendance_change_requests", filter: `session_id=eq.${sessionId}` }, checkRequests).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [activeUser, sessionId]);
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const loadHistory = async () => {
      const { data } = await client.from("play_sessions").select("id, session_date, matches(count), attendances(count)").eq("status", "completed").order("session_date", { ascending: false });
      if (!data) return;
      setHistorySessions((data as HistorySessionRow[]).map((session) => ({ id: session.id, date: session.session_date, matches: session.matches?.[0]?.count || 0, attendees: session.attendances?.[0]?.count || 0 })));
    };
    void loadHistory();
  }, []);
  useEffect(() => {
    if (!supabase || !sessionId) return;
    const client = supabase;
    const loadSavedMatches = async () => {
      const { data } = await client.from("matches").select("match_no, score_a, score_b").eq("session_id", sessionId).order("match_no");
      const rows = (data || []) as SavedMatchRow[];
      const nextScores: Record<number, [string, string]> = {};
      const nextConfirmed: Record<number, boolean> = {};
      rows.forEach((match) => {
        if (typeof match.score_a === "number" && typeof match.score_b === "number") {
          nextScores[match.match_no - 1] = [String(match.score_a), String(match.score_b)];
          nextConfirmed[match.match_no - 1] = true;
        }
      });
      setScores((previous) => ({ ...previous, ...nextScores }));
      setConfirmedMatches(nextConfirmed);
    };
    void loadSavedMatches();
    const channel = client.channel("club-match-results").on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `session_id=eq.${sessionId}` }, loadSavedMatches).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [sessionId]);
  const drawSelf = async () => {
    if (!activeUser || spinning) return;
    const self = members.find((member) => member.username === activeUser.username) ?? activeUser;
    if (!self.present) return setLoginError("Bạn cần điểm danh tham gia trước khi chọn số.");
    if (validDrawn[self.name]) return;
    setLoginError("");
    setSpinning(true);
    const revealAfterSpin = (selected?: number) => {
      window.setTimeout(() => {
        if (selected) {
          setDrawn((previous) => {
            const next = { ...previous, [self.name]: selected };
            if (!supabase) localStorage.setItem("aemit-drawn-slots", JSON.stringify(next));
            return next;
          });
        }
        setSpinning(false);
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
        const payload = await response.json().catch(() => ({ error: "Không thể chọn số lúc này." })) as { drawnNumber?: number; error?: string };
        if (!response.ok || typeof payload.drawnNumber !== "number") throw new Error(payload.error || "Không thể chọn số lúc này.");
        revealAfterSpin(payload.drawnNumber);
        return;
      }
      const latest = JSON.parse(localStorage.getItem("aemit-drawn-slots") || "{}") as Record<string, number>;
      const pool = drawSlotsForLevel(self.level, level1PresentCount, level2PresentCount);
      const usedSlots = present.flatMap((member) => {
        const slot = latest[member.name];
        return typeof slot === "number" && isDrawSlotValid(member.level, slot, level1PresentCount, level2PresentCount) ? [slot] : [];
      });
      const available = pool.filter((slot) => !usedSlots.includes(slot));
      if (!available.length) throw new Error("Không còn số trống trong dải Level của bạn.");
      const selected = available[Math.floor(Math.random() * available.length)];
      revealAfterSpin(selected);
    } catch (error) {
      window.setTimeout(() => {
        setSpinning(false);
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
    if ((sessionStatus === "scheduled" || sessionStatus === "completed") && currentScheduleScenario && allDrawn) setStep((current) => Math.max(current, 2));
    else if (drawOpen) setStep((current) => Math.max(current, 1));
  }, [activeUser, allDrawn, currentScheduleScenario, drawOpen, screen, sessionStatus, signedInMemberPresent]);

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
  const profileRows = liveRankingRows.length ? liveRankingRows : rankingRows;
  const profileRank = profileRows.findIndex((row) => row.name === currentUser.name) + 1;
  const profileAchievement = profileRank > 0 ? profileRows[profileRank - 1] : null;
  const profileHasRankingData = Boolean(profileAchievement && !profileAchievement.placeholder && profileAchievement.matches > 0);
  const profileRankClass = profileHasRankingData && profileRank > 0 && profileRank <= 3 ? `rank-${profileRank}` : "rank-none";
  const champion = championRankingRows[0];

  return <main className={"app-shell " + (sidebarOpen ? "sidebar-open" : "")}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">🏸</span><div><b>ANH EM IT</b><small>BADMINTON CLUB</small></div></div>
      <nav onClick={() => setSidebarOpen(false)}>
        <button className={screen === "home" ? "active" : ""} onClick={() => setScreen("home")}><span>⌂</span> Home</button>
        {isAdmin && <button className={screen === "members" ? "active" : ""} onClick={() => setScreen("members")}><span>♙</span> Thành viên</button>}
        <button className={screen === "schedules" ? "active" : ""} onClick={() => setScreen("schedules")}><span>▤</span> Lịch thi đấu</button>
        <button className={screen === "ranking" ? "active" : ""} onClick={() => { setScreen("ranking"); setRankingMonth(currentMonthLabel); }}><span>▥</span> Bảng xếp hạng</button>
        <button className={screen === "history" ? "active" : ""} onClick={() => setScreen("history")}><span>◷</span> Lịch sử thi đấu</button>
      </nav>
      <div className="club-card"><span>🏆</span><b>{currentMonthLabel}</b><small>{progress.completed} / {progress.total} buổi đã hoàn thành</small><div className="progress"><i style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }} /></div><div className={`club-top1 ${champion ? "" : "empty"}`}><small>NHÀ VÔ ĐỊCH {championRankingLabel.toUpperCase()}</small><b>{champion ? `👑 ${champion.name}` : "Chưa ghi danh"}</b><span>{champion ? `${champion.points} điểm · ${champion.pointDiff > 0 ? "+" : ""}${champion.pointDiff} hiệu số` : `Chưa có dữ liệu BXH ${championRankingLabel}.`}</span></div></div>
      <div className="profile"><div className="avatar small" style={{ background: currentUser.color }}>{currentUser.initials}</div><div><b>{currentUser.name}</b><small>{isAdmin ? "Quản trị viên" : "Thành viên"}</small></div><button className="logout" onClick={() => { void supabase?.auth.signOut(); setActiveUser(null); }}>Đăng xuất</button></div>
    </aside>
    <section className="content">
      <header><div className="title-group"><button className="mobile-menu" aria-label="Mở menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}><span /><span /><span /></button><div><p className="eyebrow">{currentDateLabel}</p><h1>{screenTitles[screen]}</h1></div></div><p className={`welcome-member ${welcomeRankClass}`} aria-label={`Xin chào ${currentUser.name}, Level ${currentUser.level}`}><span className="welcome-avatar" style={{ background: currentUser.color }} aria-hidden="true">{welcomeRank > 0 && welcomeRank <= 3 ? welcomeRank : currentUser.initials}</span><span className="welcome-text"><span className="welcome-line"><span className="welcome-copy">Xin chào!</span><b>{currentUser.name}</b></span><span className="welcome-level">Level {currentUser.level}</span></span></p></header>
      {screen === "members" ? <Members members={members} /> : screen === "schedules" ? <ScheduleLibrary scenarios={scheduleScenarios} /> : screen === "ranking" ? <Ranking month={rankingMonth} rows={rankingRows} onMonthChange={(month) => { setMonthCloseNotice(""); setRankingMonth(month); }} monthOptions={rankingMonthOptions} isAdmin={isAdmin} closeStatus={monthCloseStatus} closeNotice={monthCloseNotice} closingMonth={closingMonth} onCloseMonth={closeRankingMonth} /> : screen === "history" ? <History sessions={historySessions} /> : <>
        <section className="hero"><div><span className="live-dot">● {session.state}</span><h2>Buổi thứ Bảy ngày {session.date.toLocaleDateString("vi-VN")}</h2><p>07:00 – 09:00</p></div><div className="hero-stats"><div><b>{present.length}</b><small>NGƯỜI CÓ MẶT</small></div><div><b>{String(step + 1).padStart(2, "0")}<em>/{String(steps.length).padStart(2, "0")}</em></b><small>BƯỚC HIỆN TẠI</small></div></div></section>
        <section className="workflow">{steps.map((label, i) => <button key={label} className={i === step ? "current" : i < step ? "done" : ""} onClick={() => goStep(i)}><span>{i < step ? "✓" : i + 1}</span>{label}</button>)}</section>
        {loginError && <div className="warning">{loginError}</div>}
        {step === 0 && <CheckIn members={members} setMembers={setMembers} onContinue={() => setConfirmation({ title: "Xác nhận điểm danh", message: "Mở chọn số sau khi xác nhận toàn bộ thành viên đã phản hồi?", action: confirmAttendanceAndOpenDraw })} canSchedule={canSchedule} isAdmin={isAdmin} currentUser={currentUser} isCheckinWindowOpen={isCheckinWindowOpen} isCheckinTestMode={isCheckinTestMode} openSelfCheckin={() => { setCheckinPopupMode("manual"); setShowCheckin(true); }} />}
        {step === 1 && <Draw members={present} drawn={validDrawn} allDrawn={allDrawn} drawSelf={drawSelf} spinning={spinning} currentUser={currentUser} isAdmin={isAdmin} onContinue={() => setConfirmation({ title: "Xác nhận tạo lịch", message: "Tạo lịch thi đấu từ kết quả chọn số hiện tại?", action: confirmScheduleFromDraw })} />}
        {step === 2 && <Schedule scenario={currentScheduleScenario} drawn={validDrawn} scores={scores} setScores={setScores} confirmedMatches={confirmedMatches} setConfirmedMatches={setConfirmedMatches} sessionId={sessionId} isAdmin={isAdmin} rankingRows={liveRankingRows} rankingMonth={currentMonthLabel} onSaved={(completed) => { if (completed) setSessionStatus("completed"); setRankingMonth(currentMonthLabel); setRankingRefreshTick((tick) => tick + 1); }} />}
      </>}
    </section>
    {showCheckin && <CheckinModal member={activeUser} onAnswer={(attending) => { closeCheckinPopup(); if (!attending) setDismissedCheckinPromptKey(currentCheckinPromptKey); setConfirmation({ title: "Xác nhận điểm danh", message: attending ? "Bạn xác nhận tham gia buổi chơi này?" : "Bạn xác nhận không tham gia buổi chơi này?", action: () => checkInSelf(attending) }); }} onSkip={dismissCheckinPopupToAttendance} />}
    {confirmation && <ConfirmActionModal title={confirmation.title} message={confirmation.message} onCancel={() => setConfirmation(null)} onConfirm={async () => { await confirmation.action(); setConfirmation(null); }} />}
    {isAdmin && attendanceChangeNotice && <ConfirmActionModal title="Thay đổi điểm danh" message={`${attendanceChangeNotice} Xác nhận để reset chọn số và lịch thi đấu; điểm danh mới sẽ được giữ lại.`} onCancel={() => setAttendanceChangeNotice(null)} onConfirm={async () => { if (supabase && sessionId) await supabase.rpc("reset_session_after_attendance_change", { p_session_id: sessionId }); setDrawn({}); setStep(0); setAttendanceChangeNotice(null); }} />}
    {showProfileCard && <ProfilePopover member={currentUser} rank={profileRank} achievement={profileAchievement} achievementMonth={currentMonthLabel} rankClass={profileRankClass} hasRankingData={profileHasRankingData} onClose={() => setShowProfileCard(false)} />}
  </main>;
}

function ProfilePopover({ member, rank, achievement, achievementMonth, rankClass, hasRankingData, onClose }: { member: Member; rank: number; achievement: RankingRow | null; achievementMonth: string; rankClass: string; hasRankingData: boolean; onClose: () => void }) {
  const isTopRank = hasRankingData && rank > 0 && rank <= 3;
  const pointDiff = achievement?.pointDiff;
  const pointDiffLabel = typeof pointDiff === "number" ? `${pointDiff > 0 ? "+" : ""}${pointDiff}` : "0";
  const positionLabel = hasRankingData && rank > 0 ? `Top ${rank}` : "—";
  const points = achievement?.points ?? 0;
  const pointsWon = achievement?.pointsWon ?? 0;
  const pointsLost = achievement?.pointsLost ?? 0;
  const matches = achievement?.matches ?? 0;
  const roleLabel = member.role === "admin" ? "Quản trị viên" : "Thành viên";
  return <aside className={`member-profile-popover profile-${rankClass}`} role="dialog" aria-modal="true" aria-label={`Thông tin hồ sơ ${member.name}`}>
    <button className="modal-close profile-close" onClick={onClose} aria-label="Đóng">×</button>
    <div className="profile-hero-card">
      <span className="profile-medal" style={{ background: member.color }} aria-hidden="true">{isTopRank ? rank : member.initials}</span>
      <div>
        <p>{hasRankingData && rank > 0 ? `${positionLabel} · ${achievementMonth}` : "Hồ sơ tháng hiện tại"}</p>
        <h2>{member.name}</h2>
        <span>{roleLabel} · Level {member.level}</span>
      </div>
    </div>
    <div className="profile-score-card">
      <span>Thành tích {achievementMonth}</span>
      <b>{points} điểm</b>
      <small>{hasRankingData ? `${matches} trận · hiệu số ${pointDiffLabel}` : "Tháng này đã reset; sẽ tự cập nhật sau trận đầu tiên."}</small>
    </div>
    <div className="profile-stat-grid">
      <div className="profile-stat"><span>Vị trí</span><b>{positionLabel}</b></div>
      <div className="profile-stat"><span>Level</span><b>{member.level}</b></div>
      <div className="profile-stat"><span>Điểm thắng</span><b>{pointsWon}</b></div>
      <div className="profile-stat"><span>Điểm thua</span><b>{pointsLost}</b></div>
      <div className={`profile-stat ${typeof pointDiff === "number" ? pointDiff >= 0 ? "positive" : "negative" : ""}`}><span>Hiệu số</span><b>{pointDiffLabel}</b></div>
      <div className="profile-stat"><span>Số trận</span><b>{matches}</b></div>
    </div>
    <p className="profile-note">{hasRankingData ? `Đang cập nhật realtime theo BXH ${achievementMonth}.` : `BXH ${achievementMonth} đang ở trạng thái mới; chỉ số sẽ chạy lại khi có kết quả thi đấu.`}</p>
  </aside>;
}

function CheckIn({ members, onContinue, canSchedule, isAdmin, currentUser, isCheckinWindowOpen, isCheckinTestMode, openSelfCheckin }: { members: Member[]; setMembers: (m: Member[]) => void; onContinue: () => void; canSchedule: boolean; isAdmin: boolean; currentUser: Member; isCheckinWindowOpen: boolean; isCheckinTestMode: boolean; openSelfCheckin: () => void }) {
  const n = members.filter((m) => m.present).length;
  const l1 = members.filter((m) => m.present && m.level === 1).length;
  const l2 = n - l1;
  const allResponded = members.every((m) => m.responded);
  return <section className="panel checkin">
    <div className="panel-head checkin-head"><div><h2>Điểm danh thành viên</h2></div><div className="count-pill attendance-count-pill"><b>{n}</b><span>có mặt</span></div></div>
    <div className="member-grid">{members.map((m) => <div className="member-card readonly" key={m.name}><div className="avatar" style={{ background: m.color }}>{m.initials}</div><div><b>{m.name}{m.name === currentUser.name && <em>Bạn</em>}</b><small>Level {m.level} (theo BXH tháng trước) · {m.responded ? (m.present ? "Tham gia" : "Không tham gia") : "Chưa phản hồi"}</small></div><span className={"attendance-mark " + (!m.responded ? "waiting" : m.present ? "yes" : "no")}>{m.responded ? (m.present ? "✓" : "×") : ""}</span></div>)}</div>
    {isCheckinWindowOpen && !canSchedule && <div className="warning">{n < 6 ? "Cần tối thiểu 6 người có mặt để tạo lịch thi đấu tự động." : `Chưa có mẫu lịch phù hợp cho ${n} người (${l1} Level 1 + ${l2} Level 2).`}</div>}
    <div className="panel-foot"><span>{isCheckinTestMode ? "Chế độ test đang bật — nút điểm danh có thể dùng ngay hôm nay." : !isCheckinWindowOpen ? "Điểm danh và popup nhắc sẽ tự mở vào thứ Tư." : allResponded ? "✓ Toàn bộ thành viên đã phản hồi. Admin có thể xác nhận để mở chọn số." : "Đang chờ các thành viên tự phản hồi điểm danh — trạng thái cập nhật trực tiếp."}</span><div className="attendance-actions"><button className="soft-btn" disabled={!isCheckinWindowOpen} onClick={openSelfCheckin}>{isCheckinWindowOpen ? (currentUser.responded ? "Cập nhật điểm danh của tôi" : "Điểm danh của tôi") : "Mở vào thứ Tư"}</button>{isAdmin && <button className="primary" disabled={!isCheckinWindowOpen || !canSchedule || !allResponded} onClick={onContinue}>Xác nhận điểm danh & mở chọn số <span>→</span></button>}</div></div>
  </section>;
}
function Draw({ members, drawn, allDrawn, drawSelf, spinning, currentUser, isAdmin, onContinue }: { members: Member[]; drawn: Record<string, number>; allDrawn: boolean; drawSelf: () => void; spinning: boolean; currentUser: Member; isAdmin: boolean; onContinue: () => void }) {
  const level1Count = members.filter((member) => member.level === 1).length;
  const level2Count = members.length - level1Count;
  const pool = drawSlotsForLevel(currentUser.level, level1Count, level2Count);
  const rangeLabel = drawSlotRangeLabel(currentUser.level, level1Count, level2Count);
  const mine = drawn[currentUser.name];
  const entries = members.map((member) => ({ member, no: drawn[member.name] }));
  const wheelStyle = { "--spin-duration": "3.9s", "--spin-deg": `${currentUser.level === 1 ? 1738 : 2096}deg`, "--wheel-gradient": wheelGradient(currentUser.level, pool.length) } as CSSProperties;
  return <section className="panel draw-panel">
    <div className="panel-head"><div><h2>Chọn số ngẫu nhiên</h2><p>{isAdmin ? "Admin cũng chỉ chọn số cho chính mình. Khi tất cả người tham gia đã có số, Admin xác nhận để tạo lịch." : `Bạn đang ở Level ${currentUser.level}; vòng quay chỉ lấy số trong đúng dải của bạn.`}</p></div><span className="mode">LEVEL {currentUser.level}</span></div>
    <div className="draw-body">
      <div className={"wheel level-wheel level-wheel-" + currentUser.level + (spinning ? " spinning" : "")} style={wheelStyle}>
        <div className="wheel-numbers">{pool.map((slot, index) => {
          const angle = (index + 0.5) * (360 / pool.length);
          return <span key={slot} style={{ "--slot-angle": `${angle}deg`, "--slot-angle-inverse": `${-angle}deg` } as CSSProperties}>{slot}</span>;
        })}</div>
        <div className="wheel-inner">{spinning ? <b>…<small>ĐANG QUAY</small></b> : mine ? <b>{mine}<small>SỐ CỦA BẠN</small></b> : <b>?</b>}</div>
      </div>
      <div className="draw-copy"><span className="tag">VÒNG QUAY LEVEL {currentUser.level} · {rangeLabel.toUpperCase()}</span><h2>{spinning ? "Vòng quay đang chọn số…" : mine ? "Bạn đã chọn xong" : currentUser.present ? "Đến lượt bạn chọn số" : "Bạn chưa điểm danh tham gia"}</h2><p>Vòng quay chạy khoảng 4 giây. Số được claim ngay trên hệ thống để không ai bị trùng, sau đó mới reveal ra màn hình.</p><button className="primary" disabled={spinning || !currentUser.present || Boolean(mine)} onClick={drawSelf}>{spinning ? "Đang quay…" : mine ? "Đã có số" : "Chọn số của tôi"} <span>↻</span></button></div>
    </div>
    <div className="draw-list draw-roster">{entries.map(({ member, no }) => <div className={no ? "drawn" : "pending"} key={member.username}><span>{member.name}</span><b>{no ?? "—"}</b><small>Level {member.level}</small></div>)}</div>
    <div className="panel-foot"><span>{allDrawn ? "✓ Tất cả người tham gia đã chọn số. Admin có thể tạo lịch." : "Đang chờ các thành viên tự chọn số của mình."}</span>{isAdmin && <button className="primary" disabled={!allDrawn} onClick={onContinue}>Tạo lịch thi đấu <span>→</span></button>}</div>
  </section>;
}
function Schedule({ scenario, drawn, scores, setScores, confirmedMatches, setConfirmedMatches, sessionId, isAdmin, rankingRows, rankingMonth, onSaved }: { scenario: ScheduleScenario | null; drawn: Record<string, number>; scores: Record<number, [string, string]>; setScores: (x: Record<number, [string, string]>) => void; confirmedMatches: Record<number, boolean>; setConfirmedMatches: (x: Record<number, boolean>) => void; sessionId: string | null; isAdmin: boolean; rankingRows: RankingRow[]; rankingMonth: string; onSaved: (completed: boolean) => void }) {
  const namesBySlot = Object.fromEntries(Object.entries(drawn).map(([name, no]) => [no, name])) as Record<number, string>;
  if (!scenario) return <section className="panel"><div className="panel-head"><div><h2>Lịch thi đấu tự động</h2><p>Lịch chỉ được tạo khi có tối thiểu 6 thành viên và đúng tổ hợp Level trong thư viện lịch.</p></div></div><div className="empty-ranking">Chưa có lịch phù hợp cho danh sách điểm danh hiện tại.</div></section>;
  return <>
    <section className="panel combined-schedule-panel">
      <div className="panel-head"><div><h2>Lịch thi đấu & nhập điểm</h2><p>Đã chọn mẫu theo danh sách hôm nay: {scenario.level1Count} Level 1 + {scenario.level2Count} Level 2. Nhập điểm ngay bên dưới từng trận.</p></div><span className="count-pill">{scenario.matches.length} trận</span></div>
      <div className="schedule-grid">{scenario.matches.map((match, i) => <Match match={match} i={i} namesBySlot={namesBySlot} key={i} />)}</div>
      <div className="panel-foot"><span>✓ {scenario.title} · Mỗi người 4 trận</span><span>{isAdmin ? "Admin xác nhận từng trận; BXH cập nhật ngay sau khi lưu." : "Thành viên được xem lịch và kết quả, chỉ Admin được sửa điểm."}</span></div>
    </section>
    <Results matches={scenario.matches} drawn={drawn} scores={scores} setScores={setScores} confirmedMatches={confirmedMatches} setConfirmedMatches={setConfirmedMatches} sessionId={sessionId} isAdmin={isAdmin} onSaved={onSaved} />
    <LiveRankingSnapshot rows={rankingRows} month={rankingMonth} />
  </>;
}
function ScheduleLibrary({ scenarios }: { scenarios: ScheduleScenario[] }) {
  const [participantFilter, setParticipantFilter] = useState<ParticipantCount>(6);
  const visibleScenarios = scenarios.filter((scenario) => scenario.participantCount === participantFilter);
  return <section className="schedule-library">
    <section className="panel schedule-overview">
      <div>
        <p className="eyebrow">THƯ VIỆN LỊCH</p>
        <h2>Mẫu lịch theo số người & Level</h2>
        <p>Lịch chỉ có khi buổi chơi có từ 6 thành viên trở lên. Trang này chỉ để xem các trường hợp tạo lịch, không chọn hay ghi đè lịch của buổi hiện tại.</p>
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
function SlotToken({ no, name }: { no: number; name?: string }) { return <span className={`slot-token level-${slotLevel(no)}`}><b>{no}</b>{name && <small>{name}</small>}</span>; }
function TeamPair({ team, namesBySlot }: { team: readonly [number, number]; namesBySlot?: Record<number, string> }) { return <span className="team-pair"><SlotToken no={team[0]} name={namesBySlot?.[team[0]]} /><i>+</i><SlotToken no={team[1]} name={namesBySlot?.[team[1]]} /></span>; }
function Match({ match, i, namesBySlot }: { match: ScheduleMatch; i: number; namesBySlot?: Record<number, string> }) { return <article className="match schedule-match-card"><div className="match-top"><b>TRẬN {String(i + 1).padStart(2, "0")}</b></div><div className="teams"><TeamPair team={match.teamA} namesBySlot={namesBySlot} /><strong>VS</strong><TeamPair team={match.teamB} namesBySlot={namesBySlot} /></div></article>; }
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
  return <section className="panel result-entry-panel"><div className="panel-head"><div><h2>Điểm số từng trận</h2><p>{isAdmin ? "Xác nhận từng trận. Mỗi lần xác nhận sẽ cập nhật ngay xuống BXH bên dưới và tab BXH chính." : "Bạn có thể xem điểm từng trận tại đây; chỉ Admin có quyền nhập, sửa và xác nhận."}</p></div><span className="count-pill">{confirmedCount}/{matches.length} trận</span></div>{notice && <div className="warning result-notice">{notice}</div>}<div className="result-list">{matches.map((match, i) => {
    const confirmed = Boolean(confirmedMatches[i]);
    const locked = !isAdmin || (confirmed && !editing[i]);
    return <div className={"result-row schedule-result-row match-result-row " + (confirmed ? "confirmed" : "")} key={i}><b>{i + 1}</b><TeamPair team={match.teamA} namesBySlot={namesBySlot} /><input disabled={locked} aria-label={`Điểm đội A trận ${i + 1}`} value={scores[i]?.[0] ?? ""} onChange={e => setScores({ ...scores, [i]: [e.target.value, scores[i]?.[1] ?? ""] })}/><em>:</em><input disabled={locked} aria-label={`Điểm đội B trận ${i + 1}`} value={scores[i]?.[1] ?? ""} onChange={e => setScores({ ...scores, [i]: [scores[i]?.[0] ?? "", e.target.value] })}/><TeamPair team={match.teamB} namesBySlot={namesBySlot} /><div className="result-actions">{isAdmin && (confirmed && !editing[i] ? <button className="soft-btn" onClick={() => setEditing({ ...editing, [i]: true })}>Sửa</button> : <button className="primary" disabled={saving === i} onClick={() => void saveMatch(match, i)}>{saving === i ? "Đang lưu…" : confirmed ? "Lưu lại" : "Xác nhận"}</button>)}</div></div>;
  })}</div>{isAdmin && <div className="panel-foot"><span>{confirmedCount === matches.length ? "✓ Toàn bộ trận đã xác nhận và BXH đã được cập nhật." : "Điểm cao hơn được tính là thắng (+1 điểm cho mỗi thành viên đội thắng)."}</span></div>}</section>;
}
function LiveRankingSnapshot({ rows, month }: { rows: RankingRow[]; month: string }) {
  const hasRankingData = rows.some((row) => !row.placeholder && row.matches > 0);
  const completedMatches = Math.floor(rows.reduce((total, row) => total + row.matches, 0) / 4);
  return <section className="panel live-ranking-panel">
    <div className="panel-head"><div><h2>BXH tạm thời</h2><p>Tự động cập nhật theo điểm đã lưu của {month}. Bảng xếp hạng chính cũng dùng cùng dữ liệu này.</p></div><span className="count-pill">{completedMatches} trận đã tính</span></div>
    <div className="rank-table live-rank-table"><div className="rank-head rank-columns"><span>Vị trí</span><span>Thành viên</span><span>Điểm</span><span>Điểm thắng</span><span>Điểm thua</span><span>Hiệu số</span><span>Số trận</span></div>{rows.length ? rows.map((row, i) => {
      const isTopRank = hasRankingData && i < 3;
      return <div className={"rank-row rank-columns " + (isTopRank ? "top-rank top-" + (i + 1) : "")} key={row.name}><b className={isTopRank ? "medal m" + i : "rank-number"}>{i + 1}</b><div className="person"><div className="avatar small" style={{ background: row.color }}>{row.initials}</div><b>{row.name}</b><span className="level">L{row.level}</span><span className="rank-match-count">{row.matches} trận</span></div><b className="point-value">{row.points}</b><span>{row.pointsWon}</span><span>{row.pointsLost}</span><span className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</span><span>{row.matches}</span><div className="rank-mobile-stats" aria-hidden="true"><span><em>Thắng</em><b>{row.pointsWon}</b></span><span><em>Thua</em><b>{row.pointsLost}</b></span><span><em>Hiệu</em><b className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</b></span></div></div>;
    }) : <div className="empty-ranking">Chưa có dữ liệu BXH cho tháng hiện tại.</div>}</div>
  </section>;
}
function Ranking({ month, rows, onMonthChange, monthOptions, isAdmin, closeStatus, closeNotice, closingMonth, onCloseMonth }: { month: string; rows: RankingRow[]; onMonthChange: (month: string) => void; monthOptions: string[]; isAdmin: boolean; closeStatus: MonthCloseStatus | null; closeNotice: string; closingMonth: boolean; onCloseMonth: () => void }) {
  const hasRankingData = rows.some((row) => !row.placeholder && row.matches > 0);
  return <section className="ranking">
    <div className="section-title"><div><p className="eyebrow">XẾP HẠNG THEO THÁNG</p><h2>Bảng xếp hạng</h2></div></div>
    <div className="ranking-toolbar"><label>Tháng<select value={month} onChange={(e) => onMonthChange(e.target.value)}>{monthOptions.map((option) => <option key={option}>{option}</option>)}</select></label><p>{closeStatus?.closed ? "BXH tháng này đã chốt, dữ liệu chỉ còn xem." : "Admin chốt BXH sau khi buổi cuối tháng hoàn tất để tạo tháng mới."}</p></div>
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
      return <div className={"rank-row rank-columns " + (isTopRank ? "top-rank top-" + (i + 1) : "")} key={row.name}><b className={isTopRank ? "medal m" + i : "rank-number"}>{i + 1}</b><div className="person"><div className="avatar small" style={{ background: row.color }}>{row.initials}</div><b>{row.name}</b><span className="level">L{row.level}</span><span className="rank-match-count">{row.matches} trận</span></div><b className="point-value">{row.points}</b><span>{row.pointsWon}</span><span>{row.pointsLost}</span><span className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</span><span>{row.matches}</span><div className="rank-mobile-stats" aria-hidden="true"><span><em>Thắng</em><b>{row.pointsWon}</b></span><span><em>Thua</em><b>{row.pointsLost}</b></span><span><em>Hiệu</em><b className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</b></span></div></div>;
    }) : <div className="empty-ranking">Chưa có thành viên hoạt động để hiển thị BXH {month}.</div>}</div>
  </section>;
}
function History({ sessions }: { sessions: HistorySession[] }) { const [month, setMonth] = useState("Tháng 7, 2026"); const [week, setWeek] = useState("Tất cả các tuần"); const [detail, setDetail] = useState<{ title: string; rows: { no: number; a: string; b: string; sa: number; sb: number }[] } | null>(null); const entries = sessions.filter((session) => { const date = new Date(`${session.date}T00:00:00`); return month === monthLabel(date); }).map((session) => { const date = new Date(`${session.date}T00:00:00`); return { ...session, week: `Tuần ${Math.ceil(date.getDate() / 7)} · Thứ Bảy ${date.toLocaleDateString("vi-VN")}`, title: `Buổi chơi ${date.toLocaleDateString("vi-VN")}`, detail: `${session.matches} trận · ${session.attendees} thành viên` }; }); const visible = week === "Tất cả các tuần" ? entries : entries.filter((session) => session.week === week); const showDetail = async (session: typeof entries[number]) => { if (!supabase) return; const [{ data: matches }, { data: profiles }] = await Promise.all([supabase.from("matches").select("match_no,team_a,team_b,score_a,score_b").eq("session_id", session.id).order("match_no"), supabase.from("profiles").select("id,full_name")]); const names: Record<string, string> = Object.fromEntries(((profiles || []) as ProfileRow[]).map((profile) => [profile.id, profile.full_name])); setDetail({ title: session.title, rows: ((matches || []) as MatchRow[]).map((match) => ({ no: match.match_no, a: match.team_a.map((id: string) => names[id] || "?").join(" - "), b: match.team_b.map((id: string) => names[id] || "?").join(" - "), sa: match.score_a, sb: match.score_b })) }); }; return <><section className="panel history-panel"><div className="panel-head"><div><h2>Lịch sử thi đấu</h2><p>Dữ liệu từng buổi chơi, số đã chọn và kết quả được lưu theo tuần.</p></div></div><div className="history-filters"><label>Tháng<select value={month} onChange={(e) => { setMonth(e.target.value); setWeek("Tất cả các tuần"); }}><option>Tháng 7, 2026</option><option>Tháng 6, 2026</option></select></label><label>Tuần<select value={week} onChange={(e) => setWeek(e.target.value)}><option>Tất cả các tuần</option>{entries.map((session) => <option key={session.id}>{session.week}</option>)}</select></label></div><div className="history-list">{visible.length ? visible.map((session) => <article key={session.id}><div><span>{session.week}</span><h3>{session.title}</h3><p>{session.detail}</p></div><button className="soft-btn" onClick={() => void showDetail(session)}>Xem chi tiết →</button></article>) : <div className="empty-ranking">Chưa có dữ liệu cho bộ lọc này.</div>}</div></section>{detail && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="history-detail"><button className="modal-close" onClick={() => setDetail(null)}>×</button><p className="eyebrow">KẾT QUẢ THI ĐẤU</p><h2>{detail.title}</h2><div className="history-match-list">{detail.rows.map((match) => <article className="history-match-row" key={match.no}><span className="history-match-index">Trận {match.no}</span><span className="history-team history-team-a">{match.a}</span><strong className="history-score"><span>{match.sa}</span><i>:</i><span>{match.sb}</span></strong><span className="history-team history-team-b">{match.b}</span></article>)}</div></section></div>}</> }
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
      <div className="member-table">{visibleMembers.length ? visibleMembers.map((member) => <div key={member.username}><div className="person"><div className="avatar" style={{ background: member.color }}>{member.initials}</div><div><b>{member.name}</b><small>@{member.username}</small></div></div><span className="status">● Hoạt động</span><div className="member-actions"><button className="more" aria-label={`Thao tác ${member.name}`} onClick={() => setOpenMenu(openMenu === member.username ? null : member.username)}>•••</button>{openMenu === member.username && <div className="member-menu"><button onClick={() => { setEditing(member); setFullName(member.name); setOpenMenu(null); }}>Sửa thành viên</button><button className="danger-text" onClick={() => { remove(member); setOpenMenu(null); }}>Xóa thành viên</button></div>}</div></div>) : <div className="empty-ranking">Không tìm thấy thành viên phù hợp với “{searchTerm}”.</div>}</div>
    </section>
    {editing && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="member-editor"><button className="modal-close" onClick={() => setEditing(null)}>×</button><p className="eyebrow">CHỈNH SỬA THÀNH VIÊN</p><h2>{editing.name}</h2><label>Họ và tên<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoFocus /></label><div className="editor-actions"><button className="soft-btn" onClick={() => setEditing(null)}>Hủy bỏ</button><button className="primary" onClick={() => void save()}>Lưu</button></div></section></div>}
    {confirm && <ConfirmActionModal title={confirm.title} message={confirm.message} onCancel={() => setConfirm(null)} onConfirm={async () => { try { await confirm.action(); } finally { setConfirm(null); } }} />}
  </>;
}

function Login({ onLogin, error }: { onLogin: (username: string, password: string) => void | Promise<void>; error: string }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  return <main className="login-page"><section className="login-card"><div className="login-brand"><span>🏸</span><div><b>ANH EM IT</b><small>BADMINTON CLUB</small></div></div><div><p className="eyebrow">Xin chào!</p><h1>Đăng nhập CLB</h1><p>Đăng nhập để điểm danh và theo dõi lịch thi đấu của bạn.</p></div><form onSubmit={(e) => { e.preventDefault(); void onLogin(username, password); }}><label>Tên đăng nhập<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Nhập tên đăng nhập" /></label><label>Mật khẩu<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nhập mật khẩu" /></label>{error && <p className="login-error">{error}</p>}<button className="primary" type="submit">Đăng nhập <span>→</span></button></form></section></main>;
}

function CheckinModal({ member, onAnswer, onSkip }: { member: Member; onAnswer: (attending: boolean) => void; onSkip: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Điểm danh buổi chơi" onPointerDown={(event) => { if (event.target === event.currentTarget) onSkip(); }}><section className="checkin-modal"><button className="modal-close" onClick={onSkip} aria-label="Đóng">×</button><span className="modal-icon">🏸</span><p className="eyebrow">BUỔI CHƠI THỨ BẢY</p><h2>Chào {member.name}, bạn có tham gia không?</h2><p>Hãy phản hồi để Admin chốt danh sách và mở chọn số vào thứ Tư. Bạn vẫn có thể thay đổi sau trong trang chính.</p><div className="modal-actions"><button className="primary" onClick={() => onAnswer(true)}>✓ Tôi tham gia</button><button className="secondary" onClick={() => onAnswer(false)}>Tôi không tham gia</button></div><button className="skip" onClick={onSkip}>Để sau</button></section></div>;
}
function ConfirmActionModal({ title, message, onCancel, onConfirm }: { title: string; message: string; onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="confirm-modal"><span className="modal-icon">?</span><h2>{title}</h2><p>{message}</p><div className="modal-actions confirm-actions"><button className="secondary" onClick={onCancel}>Không</button><button className="primary" onClick={() => void onConfirm()}>Có, xác nhận</button></div></section></div>;
}
