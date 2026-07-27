"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Member = { name: string; initials: string; level: 1 | 2; color: string; present: boolean; username: string; password: string; role?: "admin" | "member"; responded?: boolean };
type RankingRow = { name: string; initials: string; level: number; points: number; pointsWon: number; pointsLost: number; pointDiff: number; matches: number; color: string };
type HistorySession = { id: string; date: string; matches: number; attendees: number };
type SupabaseProfile = { id?: string; username?: string | null; full_name?: string | null; level?: number | string | null; role?: "admin" | "member" | string | null };
type MonthlyResultRow = { total_points: number; points_for: number; points_against: number; point_diff: number; matches_played: number; level_next_month: number | null; profiles: SupabaseProfile | SupabaseProfile[] | null };
type HistorySessionRow = { id: string; session_date: string; matches?: { count: number }[] | null; attendances?: { count: number }[] | null };
type MatchRow = { match_no: number; team_a: string[]; team_b: string[]; score_a: number; score_b: number };
type ProfileRow = { id: string; full_name: string };
const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monthLabel = (date: Date) => `Tháng ${date.getMonth() + 1}, ${date.getFullYear()}`;
function homeSession(now: Date) { const day = now.getDay(); const offset = day >= 3 ? 6 - day : -(day + 1); const date = new Date(now); date.setDate(now.getDate() + offset); const state = day === 6 ? "ĐANG DIỄN RA" : day < 3 ? "ĐÃ DIỄN RA" : "CHƯA DIỄN RA"; return { date, state }; }
function monthlyProgress(now: Date) { const year = now.getFullYear(), month = now.getMonth(); const saturdays: Date[] = []; for (let d = new Date(year, month, 1); d.getMonth() === month; d.setDate(d.getDate() + 1)) if (d.getDay() === 6) saturdays.push(new Date(d)); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); return { total: saturdays.length, completed: saturdays.filter((d) => d < today).length }; }
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
  const [screen, setScreen] = useState<"home" | "members" | "ranking" | "history">("home");
  const [rankingMonth, setRankingMonth] = useState(() => monthLabel(new Date()));
  const [step, setStep] = useState(0);
  const [members, setMembers] = useState(initialMembers);
  const [drawn, setDrawn] = useState<Record<string, number>>({});
  const [scores, setScores] = useState<Record<number, [string, string]>>({});
  const [activeUser, setActiveUser] = useState<Member | null>(null);
  const [showCheckin, setShowCheckin] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rankingRows, setRankingRows] = useState<RankingRow[]>([]);
  const [previousRankingRows, setPreviousRankingRows] = useState<RankingRow[]>([]);
  const [historySessions, setHistorySessions] = useState<HistorySession[]>([]);
  const [confirmation, setConfirmation] = useState<{ title: string; message: string; action: () => void | Promise<void> } | null>(null);
  const [attendanceChangeNotice, setAttendanceChangeNotice] = useState<string | null>(null);
  const [showProfileCard, setShowProfileCard] = useState(false);
  const [authRestoring, setAuthRestoring] = useState(Boolean(supabase));
  const [now, setNow] = useState(() => new Date());
  const currentDateLabel = now.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).toUpperCase();
  const previousMonthKey = localDateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const isCheckinWindowOpen = now.getDay() === 3;
  const session = homeSession(now);
  const progress = monthlyProgress(now);
  const present = members.filter((m) => m.present);
  const canSchedule = present.length >= 6;
  const allAttendanceDone = members.every((m) => m.responded);
  const slots = useMemo(() => {
    const l1 = present.filter((m) => m.level === 1).map((m, i) => [m.name, i + 1] as const);
    const l2 = present.filter((m) => m.level === 2).map((m, i) => [m.name, i + 5] as const);
    return [...l1, ...l2];
  }, [present]);
  const matches = [
    ["Mạnh", "Hùng", "Quý", "Thành", "MIXED"], ["Mạnh", "Quý", "Hùng", "Phú", "MIXED"],
    ["Mạnh", "Sơn", "Đạt", "Đức Anh", "MIXED"], ["Mạnh", "Phú", "Thành", "Nam", "MIXED"],
    ["Hùng", "Quý", "Đức Anh", "Phú", "MIXED"], ["Hùng", "Thành", "Nam", "Sơn", "MIXED"],
    ["Quý", "Đạt", "Đức Anh", "Sơn", "MIXED"], ["Thành", "Đạt", "Nam", "Đức Anh", "MIXED"],
    ["Đạt", "Nam", "Sơn", "Phú", "L2 ONLY"],
  ];
  const steps = ["Điểm danh", "Bốc số", "Lịch thi đấu", "Nhập kết quả"];
  const goStep = (next: number) => {
    if (next > step && activeUser?.role !== "admin") return;
    if (next > step + 1 || (next === 1 && (!isCheckinWindowOpen || !canSchedule || !allAttendanceDone)) || (next === 2 && Object.keys(drawn).length === 0)) return;
    setStep(next);
  };
  const draw = () => {
    const shuffled = [...slots].sort(() => Math.random() - 0.5);
    setDrawn(Object.fromEntries(shuffled));
  };

  const signIn = async (username: string, password: string) => {
    const normalized = username.trim().toLowerCase();
    if (supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email: `${normalized}@anhemit.club`, password });
      if (error) return setLoginError("Tên đăng nhập hoặc mật khẩu chưa đúng.");
      const { data: profile } = await supabase.from("profiles").select("full_name, username, level, role").eq("username", normalized).single();
      const localUser = members.find((m) => m.username === normalized);
      if (profile && localUser) {
        const user = { ...localUser, name: profile.full_name, level: Number(profile.level) as 1 | 2, role: profile.role };
        setActiveUser(user); setLoginError(""); setShowCheckin(isCheckinWindowOpen && !user.responded); return;
      }
    }
    const user = members.find((m) => m.username === normalized && m.password === password);
    if (!user) return setLoginError("Tên đăng nhập hoặc mật khẩu chưa đúng.");
    setActiveUser(user); setLoginError(""); setShowCheckin(isCheckinWindowOpen && !user.responded);
  };
  const checkInSelf = async (attending: boolean) => {
    if (!activeUser) return;
    if (supabase && sessionId) {
      const { data: needsReset, error } = await supabase.rpc("change_my_attendance", { p_session_id: sessionId, p_choice: attending ? "attending" : "absent" });
      if (error) return setLoginError(error.message);
      if (needsReset) setAttendanceChangeNotice("Một thành viên vừa thay đổi điểm danh sau khi đã bốc số/lập lịch.");
    }
    const updated = members.map((m) => m.username === activeUser.username ? { ...m, present: attending, responded: true } : m);
    localStorage.setItem("aemit-attendance", JSON.stringify(updated));
    setMembers(updated); setActiveUser({ ...activeUser, present: attending, responded: true }); setShowCheckin(false);
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
    const saved = localStorage.getItem("aemit-attendance");
    if (saved) window.queueMicrotask(() => setMembers(JSON.parse(saved) as Member[]));
    const syncAttendance = (event: StorageEvent) => { if (event.key === "aemit-attendance" && event.newValue) setMembers(JSON.parse(event.newValue)); };
    window.addEventListener("storage", syncAttendance);
    return () => window.removeEventListener("storage", syncAttendance);
  }, []);
  useEffect(() => {
    if (!supabase || !activeUser) return;
    const client = supabase;
    const loadLiveAttendance = async () => {
      const { data: ensuredSessionId } = await client.rpc("ensure_weekly_session", { p_session_date: localDateKey(session.date) });
      if (!ensuredSessionId) return;
      setSessionId(ensuredSessionId);
      const { data } = await client.from("attendances").select("choice, profiles!attendances_member_id_fkey(username)").eq("session_id", ensuredSessionId);
      if (!data) return;
      setMembers((previous) => previous.map((member) => {
        const attendance = data.find((item) => {
          const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
          return profile?.username === member.username;
        });
        return attendance ? { ...member, present: attendance.choice === "attending", responded: attendance.choice !== "pending" } : member;
      }));
    };
    void loadLiveAttendance();
    const channel = client.channel("club-attendance-live").on("postgres_changes", { event: "*", schema: "public", table: "attendances" }, loadLiveAttendance).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [activeUser, session.date]);
  useEffect(() => {
    if (!sessionId || now.getDay() !== 3) return;
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
    const match = rankingMonth.match(/Tháng (\d+), (\d+)/); const month = match ? `${match[2]}-${String(match[1]).padStart(2, "0")}-01` : "2026-07-01";
    const loadRanking = async () => {
      const rankingSelect = "total_points, points_for, points_against, point_diff, matches_played, level_next_month, profiles!monthly_results_member_id_fkey(full_name, level)";
      const mapRows = (rows: MonthlyResultRow[]) => rows.map((row, index) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        const name = profile?.full_name || "Thành viên";
        return { name, initials: name.split(" ").map((part: string) => part[0]).slice(-2).join(""), level: Number(profile?.level || row.level_next_month || 2), points: row.total_points, pointsWon: row.points_for, pointsLost: row.points_against, pointDiff: row.point_diff, matches: row.matches_played, color: ["#e7ad26", "#6ba9de", "#df8d2a", "#6846e8", "#e56a4d", "#2ba98b"][index % 6] };
      });
      const [{ data }, { data: previousData }] = await Promise.all([
        client.from("monthly_results").select(rankingSelect).eq("month", month).order("total_points", { ascending: false }).order("point_diff", { ascending: false }).order("points_for", { ascending: false }),
        client.from("monthly_results").select(rankingSelect).eq("month", previousMonthKey).order("total_points", { ascending: false }).order("point_diff", { ascending: false }).order("points_for", { ascending: false }),
      ]);
      setRankingRows(data ? mapRows(data as MonthlyResultRow[]) : []);
      setPreviousRankingRows(previousData ? mapRows(previousData as MonthlyResultRow[]) : []);
    };
    void loadRanking();
  }, [rankingMonth, previousMonthKey]);
  useEffect(() => {
    if (!supabase || !activeUser || activeUser.role !== "admin" || !sessionId) return;
    const client = supabase;
    const checkRequests = async () => {
      const { data } = await client.from("attendance_change_requests").select("id, profiles!attendance_change_requests_member_id_fkey(full_name)").eq("session_id", sessionId).eq("status", "pending").limit(1);
      if (data?.[0]) { const profile = Array.isArray(data[0].profiles) ? data[0].profiles[0] : data[0].profiles; setAttendanceChangeNotice(`${profile?.full_name || "Một thành viên"} vừa thay đổi điểm danh sau khi đã bốc số/lập lịch.`); }
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
  const drawSelf = () => {
    if (!activeUser) return;
    const existing = JSON.parse(localStorage.getItem("aemit-drawn-slots") || "{}");
    if (existing[activeUser.name]) return setDrawn({ ...drawn, [activeUser.name]: existing[activeUser.name] });
    if (spinning) return;
    setSpinning(true);
    window.setTimeout(() => {
      const latest = JSON.parse(localStorage.getItem("aemit-drawn-slots") || "{}");
      const pool = activeUser.level === 1 ? [1, 2, 3, 4] : [5, 6, 7, 8, 9, 10];
      const available = pool.filter((slot) => !Object.values(latest).includes(slot));
      const selected = available[Math.floor(Math.random() * available.length)];
      if (selected) { const next = { ...latest, [activeUser.name]: selected }; localStorage.setItem("aemit-drawn-slots", JSON.stringify(next)); setDrawn(next); }
      setSpinning(false);
    }, 3500);
  };

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
  if (!activeUser && authRestoring) return <main className="login-page"><div className="login-card"><p>Đang khôi phục phiên đăng nhập...</p></div></main>;
  if (!activeUser) return <Login onLogin={signIn} error={loginError} />;
  const isAdmin = activeUser.role === "admin";
  const achievementRows = previousRankingRows.length ? previousRankingRows : rankingRows;
  const profileRank = achievementRows.findIndex((row) => row.name === activeUser.name) + 1;
  const profileAchievement = profileRank > 0 ? achievementRows[profileRank - 1] : null;
  const welcomeRankClass = profileRank > 0 && profileRank <= 3 ? `rank-${profileRank}` : "rank-none";

  return <main className={"app-shell " + (sidebarOpen ? "sidebar-open" : "")}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">🏸</span><div><b>ANH EM IT</b><small>BADMINTON CLUB</small></div></div>
      <nav onClick={() => setSidebarOpen(false)}>
        <button className={screen === "home" ? "active" : ""} onClick={() => setScreen("home")}><span>⌂</span> Home</button>
        {isAdmin && <button className={screen === "members" ? "active" : ""} onClick={() => setScreen("members")}><span>♙</span> Thành viên</button>}
        <button className={screen === "ranking" ? "active" : ""} onClick={() => { setScreen("ranking"); setRankingMonth(monthLabel(now)); }}><span>▥</span> Bảng xếp hạng</button>
        <button className={screen === "history" ? "active" : ""} onClick={() => setScreen("history")}><span>◷</span> Lịch sử thi đấu</button>
      </nav>
      <div className="club-card"><span>🏆</span><b>{monthLabel(now)}</b><small>{progress.completed} / {progress.total} buổi đã hoàn thành</small><div className="progress"><i style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }} /></div>{previousRankingRows[0] && <div className="club-top1"><small>TOP 1 THÁNG TRƯỚC</small><b>👑 {previousRankingRows[0].name}</b><span>{previousRankingRows[0].points} điểm · +{previousRankingRows[0].pointDiff} hiệu số</span></div>}</div>
      <div className="profile"><div className="avatar small" style={{ background: activeUser.color }}>{activeUser.initials}</div><div><b>{activeUser.name}</b><small>{isAdmin ? "Quản trị viên" : "Thành viên"}</small></div><button className="logout" onClick={() => { void supabase?.auth.signOut(); setActiveUser(null); }}>Đăng xuất</button></div>
    </aside>
    <section className="content">
      <header><div className="title-group"><button className="mobile-menu" aria-label="Mở menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}><span /><span /><span /></button><div><p className="eyebrow">{currentDateLabel}</p><h1>{screen === "home" ? "Home" : screen === "members" ? "Quản lý thành viên" : screen === "ranking" ? "Bảng xếp hạng" : "Lịch sử thi đấu"}</h1></div></div><p className={`welcome-member ${welcomeRankClass}`}><span className="welcome-rank">{profileRank > 0 && profileRank <= 3 ? `TOP ${profileRank}` : "THÀNH VIÊN"}</span><b>{activeUser.name}</b><span className="welcome-level">Level {activeUser.level}</span></p></header>
      {screen === "members" ? <Members members={members} /> : screen === "ranking" ? <Ranking month={rankingMonth} rows={rankingRows} onMonthChange={setRankingMonth} /> : screen === "history" ? <History sessions={historySessions} /> : <>
        <section className="hero"><div><span className="live-dot">● {session.state}</span><h2>Buổi thứ Bảy ngày {session.date.toLocaleDateString("vi-VN")}</h2><p>07:00 – 09:00</p></div><div className="hero-stats"><div><b>{present.length}</b><small>NGƯỜI CÓ MẶT</small></div><div><b>0{step + 1}<em>/04</em></b><small>BƯỚC HIỆN TẠI</small></div></div></section>
        <section className="workflow">{steps.map((label, i) => <button key={label} className={i === step ? "current" : i < step ? "done" : ""} onClick={() => goStep(i)}><span>{i < step ? "✓" : i + 1}</span>{label}</button>)}</section>
        {step === 0 && <CheckIn members={members} setMembers={setMembers} onContinue={() => setConfirmation({ title: "Xác nhận điểm danh", message: "Mở bốc số sau khi xác nhận toàn bộ thành viên đã phản hồi?", action: async () => { if (supabase && sessionId) { const { error } = await supabase.rpc("confirm_attendance", { p_session_id: sessionId }); if (error) return setLoginError(error.message); } goStep(1); } })} canSchedule={canSchedule} isAdmin={isAdmin} currentUser={activeUser} isCheckinWindowOpen={isCheckinWindowOpen} openSelfCheckin={() => setShowCheckin(true)} />}
        {step === 1 && <Draw drawn={drawn} draw={draw} drawSelf={drawSelf} spinning={spinning} currentUser={activeUser} isAdmin={isAdmin} onContinue={() => setConfirmation({ title: "Xác nhận tạo lịch", message: "Tạo lịch thi đấu từ kết quả bốc số hiện tại?", action: () => goStep(2) })} />}
        {step === 2 && <Schedule matches={matches} drawn={drawn} onContinue={() => setConfirmation({ title: "Xác nhận nhập kết quả", message: "Chuyển sang bước ghi nhận kết quả các trận?", action: () => goStep(3) })} isAdmin={isAdmin} />}
        {step === 3 && <Results matches={matches} scores={scores} setScores={setScores} isAdmin={isAdmin} />}
      </>}
    </section>
    {showCheckin && <CheckinModal member={activeUser} onAnswer={(attending) => { setShowCheckin(false); setConfirmation({ title: "Xác nhận điểm danh", message: attending ? "Bạn xác nhận tham gia buổi chơi này?" : "Bạn xác nhận không tham gia buổi chơi này?", action: () => checkInSelf(attending) }); }} onSkip={() => setShowCheckin(false)} />}
    {confirmation && <ConfirmActionModal title={confirmation.title} message={confirmation.message} onCancel={() => setConfirmation(null)} onConfirm={async () => { await confirmation.action(); setConfirmation(null); }} />}
    {isAdmin && attendanceChangeNotice && <ConfirmActionModal title="Thay đổi điểm danh" message={`${attendanceChangeNotice} Xác nhận để reset bốc số và lịch thi đấu; điểm danh mới sẽ được giữ lại.`} onCancel={() => setAttendanceChangeNotice(null)} onConfirm={async () => { if (supabase && sessionId) await supabase.rpc("reset_session_after_attendance_change", { p_session_id: sessionId }); setDrawn({}); setStep(0); setAttendanceChangeNotice(null); }} />}
    {showProfileCard && <div className="member-profile-popover"><button className="modal-close" onClick={() => setShowProfileCard(false)}>×</button><p className="eyebrow">THÀNH TÍCH THÁNG TRƯỚC</p><h2>{activeUser.name}</h2><div className="profile-stat"><span>Level</span><b>Level {activeUser.level}</b></div><div className="profile-stat"><span>Vị trí</span><b>{profileAchievement ? `#${profileRank}` : "—"}</b></div><div className="profile-stat"><span>Điểm</span><b>{profileAchievement ? `${profileAchievement.points} điểm` : "—"}</b></div></div>}
  </main>;
}

function CheckIn({ members, onContinue, canSchedule, isAdmin, currentUser, isCheckinWindowOpen, openSelfCheckin }: { members: Member[]; setMembers: (m: Member[]) => void; onContinue: () => void; canSchedule: boolean; isAdmin: boolean; currentUser: Member; isCheckinWindowOpen: boolean; openSelfCheckin: () => void }) {
  const n = members.filter((m) => m.present).length;
  const allResponded = members.every((m) => m.responded);
  return <section className="panel checkin">
    <div className="panel-head"><div><h2>Điểm danh thành viên</h2><p>{isCheckinWindowOpen ? (isAdmin ? "Admin chỉ điểm danh cho chính mình và mở bước tiếp theo khi toàn bộ thành viên đã phản hồi." : "Bạn chỉ có thể điểm danh cho chính mình; các nội dung khác ở chế độ xem.") : "Điểm danh mở từ thứ Tư hằng tuần cho buổi chơi thứ Bảy."}</p></div><div className="count-pill">{n} người có mặt</div></div>
    <div className="member-grid">{members.map((m) => <div className="member-card readonly" key={m.name}><div className="avatar" style={{ background: m.color }}>{m.initials}</div><div><b>{m.name}{m.name === currentUser.name && <em>Bạn</em>}</b><small>Level {m.level} (theo BXH tháng trước) · {m.responded ? (m.present ? "Tham gia" : "Không tham gia") : "Chưa phản hồi"}</small></div><span className={"attendance-mark " + (!m.responded ? "waiting" : m.present ? "yes" : "no")}>{m.responded ? (m.present ? "✓" : "×") : ""}</span></div>)}</div>
    {isCheckinWindowOpen && !canSchedule && <div className="warning">Cần tối thiểu 6 người có mặt để tạo lịch thi đấu tự động.</div>}
    <div className="panel-foot"><span>{!isCheckinWindowOpen ? "Điểm danh và popup nhắc sẽ tự mở vào thứ Tư." : allResponded ? "✓ Toàn bộ thành viên đã phản hồi. Admin có thể xác nhận để mở bốc số." : "Đang chờ các thành viên tự phản hồi điểm danh — trạng thái cập nhật trực tiếp."}</span><div className="attendance-actions"><button className="soft-btn" disabled={!isCheckinWindowOpen} onClick={openSelfCheckin}>{isCheckinWindowOpen ? (currentUser.responded ? "Cập nhật điểm danh của tôi" : "Điểm danh của tôi") : "Mở vào thứ Tư"}</button>{isAdmin && <button className="primary" disabled={!isCheckinWindowOpen || !canSchedule || !allResponded} onClick={onContinue}>Xác nhận điểm danh & mở bốc số <span>→</span></button>}</div></div>
  </section>;
}
function Draw({ drawn, draw, drawSelf, spinning, currentUser, isAdmin, onContinue }: { drawn: Record<string, number>; draw: () => void; drawSelf: () => void; spinning: boolean; currentUser: Member; isAdmin: boolean; onContinue: () => void }) { const entries = Object.entries(drawn); const mine = drawn[currentUser.name]; return <section className="panel draw-panel"><div className="panel-head"><div><h2>Bốc số ngẫu nhiên</h2><p>{isAdmin ? "Theo dõi số đã bốc. Bước tạo lịch chỉ mở sau khi mọi người hoàn tất." : `Bạn đang ở Level ${currentUser.level}; giao diện chỉ hiển thị vòng quay phù hợp với cấp độ của bạn.`}</p></div><span className="mode">LEVEL {currentUser.level}</span></div><div className="draw-body"><div className={"wheel " + (spinning ? "spinning" : "")}><div className="wheel-inner">{spinning ? <b>…<small>ĐANG QUAY</small></b> : mine ? <b>#{mine}<small>SỐ CỦA BẠN</small></b> : <b>?</b>}</div></div><div className="draw-copy"><span className="tag">{currentUser.level === 1 ? "VÒNG QUAY LEVEL 1 · SỐ 1–4" : "VÒNG QUAY LEVEL 2 · SỐ 5–10"}</span><h2>{spinning ? "Vòng quay đang chọn số…" : mine ? "Bạn đã có số!" : "Đến lượt bạn bốc số"}</h2><p>Vòng quay kéo dài 3,5 giây. Hệ thống giữ số đã chọn ngay khi bốc để không thành viên nào nhận trùng số.</p><button className="primary" disabled={spinning} onClick={isAdmin ? draw : drawSelf}>{spinning ? "Đang quay…" : isAdmin ? "Bốc số mô phỏng" : mine ? "Xem số đã bốc" : "Bốc số của tôi"} <span>↻</span></button></div></div>{entries.length > 0 && <div className="draw-list">{entries.map(([name, no]) => <div key={name}><span>{name}</span><b>#{no}</b></div>)}</div>}<div className="panel-foot"><span>🔒 Số được giữ duy nhất ngay khi quay.</span>{isAdmin && <button className="primary" disabled={entries.length < 1} onClick={onContinue}>Tạo lịch thi đấu <span>→</span></button>}</div></section> }
function Schedule({ matches, drawn, onContinue, isAdmin }: { matches: string[][]; drawn: Record<string, number>; onContinue: () => void; isAdmin: boolean }) { return <section className="panel"><div className="panel-head"><div><h2>Lịch thi đấu tự động</h2><p>{Object.keys(drawn).length ? "Đã ghép lịch theo số bốc và Level của các thành viên." : "Lịch mẫu được tạo theo quy tắc mỗi người thi đấu 4 trận."}</p></div>{isAdmin && <button className="soft-btn">↻ Tạo lại lịch</button>}</div><div className="schedule-grid">{matches.map((m, i) => <Match match={m} i={i} key={i} />)}</div>{isAdmin && <div className="panel-foot"><span>✓ Mỗi người 4 trận · Không lặp đồng đội</span><button className="primary" onClick={onContinue}>Bắt đầu nhập điểm <span>→</span></button></div>}</section> }
function Match({ match, i }: { match: string[]; i: number }) { return <article className="match"><div className="match-top"><b>TRẬN {String(i + 1).padStart(2, "0")}</b><span>{match[4]}</span></div><div className="teams"><div>{match[0]}<small> + {match[1]}</small></div><strong>VS</strong><div>{match[2]}<small> + {match[3]}</small></div></div></article> }
function Results({ matches, scores, setScores, isAdmin }: { matches: string[][]; scores: Record<number, [string, string]>; setScores: (x: Record<number, [string, string]>) => void; isAdmin: boolean }) { return <section className="panel"><div className="panel-head"><div><h2>Nhập kết quả</h2><p>{isAdmin ? "Cập nhật điểm từng trận. Hệ thống sẽ tự tính bảng xếp hạng tháng." : "Chỉ Admin có thể nhập và chốt kết quả buổi chơi."}</p></div><span className="count-pill">{Object.keys(scores).length}/{matches.length} trận</span></div><div className="result-list">{matches.map((m, i) => <div className="result-row" key={i}><b>#{i + 1}</b><span>{m[0]} + {m[1]}</span><input disabled={!isAdmin} aria-label="Điểm đội A" value={scores[i]?.[0] ?? ""} onChange={e => setScores({ ...scores, [i]: [e.target.value, scores[i]?.[1] ?? ""] })}/><em>:</em><input disabled={!isAdmin} aria-label="Điểm đội B" value={scores[i]?.[1] ?? ""} onChange={e => setScores({ ...scores, [i]: [scores[i]?.[0] ?? "", e.target.value] })}/><span>{m[2]} + {m[3]}</span></div>)}</div>{isAdmin && <div className="panel-foot"><span>Điểm cao hơn sẽ được tính là thắng (+1 điểm).</span><button className="primary">Chốt kết quả buổi chơi <span>✓</span></button></div>}</section> }
function Ranking({ month, rows, onMonthChange }: { month: string; rows: RankingRow[]; onMonthChange: (month: string) => void }) { return <section className="ranking"><div className="section-title"><div><p className="eyebrow">XẾP HẠNG THEO THÁNG</p><h2>Bảng xếp hạng</h2></div></div><div className="ranking-toolbar"><label>Tháng<select value={month} onChange={(e) => onMonthChange(e.target.value)}><option>Tháng 7, 2026</option><option>Tháng 6, 2026</option></select></label><p>{month === monthLabel(new Date()) ? "BXH hiện tại sẽ khóa và reset sau 3 ngày kể từ buổi cuối tháng." : "Dữ liệu lịch sử đã được lưu và chỉ có thể xem."}</p></div><div className="rank-table"><div className="rank-head rank-columns"><span>Vị trí</span><span>Thành viên</span><span>Điểm</span><span>Điểm thắng</span><span>Điểm thua</span><span>Hiệu số</span><span>Số trận</span></div>{rows.length ? rows.map((row, i) => <div className={"rank-row rank-columns " + (i < 3 ? "top-rank top-" + (i + 1) : "")} key={row.name}><b className={i < 3 ? "medal m" + i : "rank-number"}>{i + 1}</b><div className="person"><div className="avatar small" style={{ background: row.color }}>{row.initials}</div><b>{row.name}</b><span className="level">L{row.level}</span></div><b className="point-value">{row.points}</b><span>{row.pointsWon}</span><span>{row.pointsLost}</span><span className={row.pointDiff >= 0 ? "positive" : "negative"}>{row.pointDiff > 0 ? "+" : ""}{row.pointDiff}</span><span>{row.matches}</span></div>) : <div className="empty-ranking">Chưa có kết quả thi đấu cho {month}.</div>}</div></section> }
function History({ sessions }: { sessions: HistorySession[] }) { const [month, setMonth] = useState("Tháng 7, 2026"); const [week, setWeek] = useState("Tất cả các tuần"); const [detail, setDetail] = useState<{ title: string; rows: { no: number; a: string; b: string; sa: number; sb: number }[] } | null>(null); const entries = sessions.filter((session) => { const date = new Date(`${session.date}T00:00:00`); return month === monthLabel(date); }).map((session) => { const date = new Date(`${session.date}T00:00:00`); return { ...session, week: `Tuần ${Math.ceil(date.getDate() / 7)} · Thứ Bảy ${date.toLocaleDateString("vi-VN")}`, title: `Buổi chơi ${date.toLocaleDateString("vi-VN")}`, detail: `${session.matches} trận · ${session.attendees} thành viên` }; }); const visible = week === "Tất cả các tuần" ? entries : entries.filter((session) => session.week === week); const showDetail = async (session: typeof entries[number]) => { if (!supabase) return; const [{ data: matches }, { data: profiles }] = await Promise.all([supabase.from("matches").select("match_no,team_a,team_b,score_a,score_b").eq("session_id", session.id).order("match_no"), supabase.from("profiles").select("id,full_name")]); const names: Record<string, string> = Object.fromEntries(((profiles || []) as ProfileRow[]).map((profile) => [profile.id, profile.full_name])); setDetail({ title: session.title, rows: ((matches || []) as MatchRow[]).map((match) => ({ no: match.match_no, a: match.team_a.map((id: string) => names[id] || "?").join(" - "), b: match.team_b.map((id: string) => names[id] || "?").join(" - "), sa: match.score_a, sb: match.score_b })) }); }; return <><section className="panel history-panel"><div className="panel-head"><div><h2>Lịch sử thi đấu</h2><p>Dữ liệu từng buổi chơi, số bốc thăm và kết quả được lưu theo tuần.</p></div></div><div className="history-filters"><label>Tháng<select value={month} onChange={(e) => { setMonth(e.target.value); setWeek("Tất cả các tuần"); }}><option>Tháng 7, 2026</option><option>Tháng 6, 2026</option></select></label><label>Tuần<select value={week} onChange={(e) => setWeek(e.target.value)}><option>Tất cả các tuần</option>{entries.map((session) => <option key={session.id}>{session.week}</option>)}</select></label></div><div className="history-list">{visible.length ? visible.map((session) => <article key={session.id}><div><span>{session.week}</span><h3>{session.title}</h3><p>{session.detail}</p></div><button className="soft-btn" onClick={() => void showDetail(session)}>Xem chi tiết →</button></article>) : <div className="empty-ranking">Chưa có dữ liệu cho bộ lọc này.</div>}</div></section>{detail && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="history-detail"><button className="modal-close" onClick={() => setDetail(null)}>×</button><p className="eyebrow">KẾT QUẢ THI ĐẤU</p><h2>{detail.title}</h2><div className="history-match-list">{detail.rows.map((match) => <article className="history-match-row" key={match.no}><span className="history-match-index">Trận {match.no}</span><span className="history-team history-team-a">{match.a}</span><strong className="history-score"><span>{match.sa}</span><i>:</i><span>{match.sb}</span></strong><span className="history-team history-team-b">{match.b}</span></article>)}</div></section></div>}</> }
function Members({ members }: { members: Member[] }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [fullName, setFullName] = useState("");
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
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
  return <><section className="member-summary"><div><b>{members.length}</b><span>Tổng thành viên</span></div><div><b>{members.length}</b><span>Đang hoạt động</span></div></section><section className="panel"><div className="panel-head"><div><h2>Danh sách thành viên</h2><p>Quản lý thông tin các thành viên CLB.</p></div><input className="search" placeholder="⌕  Tìm thành viên..." /></div><div className="member-table">{members.map((member) => <div key={member.username}><div className="person"><div className="avatar" style={{ background: member.color }}>{member.initials}</div><div><b>{member.name}</b><small>@{member.username}</small></div></div><span className="status">● Hoạt động</span><div className="member-actions"><button className="more" aria-label={`Thao tác ${member.name}`} onClick={() => setOpenMenu(openMenu === member.username ? null : member.username)}>•••</button>{openMenu === member.username && <div className="member-menu"><button onClick={() => { setEditing(member); setFullName(member.name); setOpenMenu(null); }}>Sửa thành viên</button><button className="danger-text" onClick={() => { remove(member); setOpenMenu(null); }}>Xóa thành viên</button></div>}</div></div>)}</div></section>{editing && <div className="modal-backdrop" role="dialog" aria-modal="true"><section className="member-editor"><button className="modal-close" onClick={() => setEditing(null)}>×</button><p className="eyebrow">CHỈNH SỬA THÀNH VIÊN</p><h2>{editing.name}</h2><label>Họ và tên<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoFocus /></label><div className="editor-actions"><button className="soft-btn" onClick={() => setEditing(null)}>Hủy bỏ</button><button className="primary" onClick={() => void save()}>Lưu</button></div></section></div>}{confirm && <ConfirmActionModal title={confirm.title} message={confirm.message} onCancel={() => setConfirm(null)} onConfirm={async () => { try { await confirm.action(); } finally { setConfirm(null); } }} />}</>;
}

function Login({ onLogin, error }: { onLogin: (username: string, password: string) => void | Promise<void>; error: string }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  return <main className="login-page"><section className="login-card"><div className="login-brand"><span>🏸</span><div><b>ANH EM IT</b><small>BADMINTON CLUB</small></div></div><div><p className="eyebrow">CHÀO MỪNG TRỞ LẠI</p><h1>Đăng nhập CLB</h1><p>Đăng nhập để điểm danh và theo dõi lịch thi đấu của bạn.</p></div><form onSubmit={(e) => { e.preventDefault(); void onLogin(username, password); }}><label>Tên đăng nhập<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Nhập tên đăng nhập" /></label><label>Mật khẩu<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nhập mật khẩu" /></label>{error && <p className="login-error">{error}</p>}<button className="primary" type="submit">Đăng nhập <span>→</span></button></form></section></main>;
}

function CheckinModal({ member, onAnswer, onSkip }: { member: Member; onAnswer: (attending: boolean) => void; onSkip: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Điểm danh buổi chơi" onPointerDown={(event) => { if (event.target === event.currentTarget) onSkip(); }}><section className="checkin-modal"><button className="modal-close" onClick={onSkip} aria-label="Đóng">×</button><span className="modal-icon">🏸</span><p className="eyebrow">BUỔI CHƠI THỨ BẢY</p><h2>Chào {member.name}, bạn có tham gia không?</h2><p>Hãy phản hồi để Admin chốt danh sách và mở bốc số vào thứ Tư. Bạn vẫn có thể thay đổi sau trong trang chính.</p><div className="modal-actions"><button className="primary" onClick={() => onAnswer(true)}>✓ Tôi tham gia</button><button className="secondary" onClick={() => onAnswer(false)}>Tôi không tham gia</button></div><button className="skip" onClick={onSkip}>Để sau</button></section></div>;
}
function ConfirmActionModal({ title, message, onCancel, onConfirm }: { title: string; message: string; onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="confirm-modal"><span className="modal-icon">?</span><h2>{title}</h2><p>{message}</p><div className="modal-actions confirm-actions"><button className="secondary" onClick={onCancel}>Không</button><button className="primary" onClick={() => void onConfirm()}>Có, xác nhận</button></div></section></div>;
}
