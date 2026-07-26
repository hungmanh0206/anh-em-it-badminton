"use client";

import { useEffect, useMemo, useState } from "react";

type Member = { name: string; initials: string; level: 1 | 2; color: string; present: boolean; username: string; password: string; role?: "admin" | "member"; responded?: boolean };
const initialMembers: Member[] = [
  { name: "Mạnh", initials: "M", level: 1, color: "#6846e8", present: true, username: "manh", password: "123456", role: "admin" },
  { name: "Hùng", initials: "H", level: 1, color: "#e56a4d", present: true, username: "hung", password: "123456" },
  { name: "Quý", initials: "Q", level: 1, color: "#2ba98b", present: true, username: "quy", password: "123456" },
  { name: "Thành", initials: "T", level: 1, color: "#e3a63c", present: true, username: "thanh", password: "123456" },
  { name: "Đạt", initials: "Đ", level: 2, color: "#e05591", present: true, username: "dat", password: "123456" },
  { name: "Nam", initials: "N", level: 2, color: "#4175e8", present: true, username: "nam", password: "123456" },
  { name: "Đức Anh", initials: "ĐA", level: 2, color: "#2f9c9f", present: true, username: "ducanh", password: "123456" },
  { name: "Sơn", initials: "S", level: 2, color: "#9c69e9", present: true, username: "son", password: "123456" },
  { name: "Hải", initials: "H", level: 2, color: "#ef8b3d", present: false, username: "hai", password: "123456" },
  { name: "Phú", initials: "P", level: 2, color: "#3f9c59", present: true, username: "phu", password: "123456" },
];

const ranking = [
  ["Mạnh", "M", 12, 224, 190, "+34", 16, "#6846e8"], ["Hùng", "H", 10, 216, 197, "+19", 16, "#e56a4d"],
  ["Quý", "Q", 9, 211, 199, "+12", 16, "#2ba98b"], ["Thành", "T", 8, 205, 198, "+7", 16, "#e3a63c"],
  ["Nam", "N", 7, 200, 198, "+2", 16, "#4175e8"], ["Đạt", "Đ", 6, 194, 199, "−5", 16, "#e05591"],
  ["Đức Anh", "ĐA", 5, 190, 198, "−8", 16, "#2f9c9f"], ["Sơn", "S", 4, 185, 195, "−10", 16, "#9c69e9"],
  ["Phú", "P", 3, 181, 196, "−15", 16, "#3f9c59"], ["Hải", "H", 2, 145, 166, "−21", 12, "#ef8b3d"],
];

export default function Home() {
  const [screen, setScreen] = useState<"home" | "members">("home");
  const [step, setStep] = useState(0);
  const [members, setMembers] = useState(initialMembers);
  const [drawn, setDrawn] = useState<Record<string, number>>({});
  const [scores, setScores] = useState<Record<number, [string, string]>>({});
  const [activeUser, setActiveUser] = useState<Member | null>(null);
  const [showCheckin, setShowCheckin] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    if (next > step + 1 || (next === 1 && (!canSchedule || !allAttendanceDone)) || (next === 2 && Object.keys(drawn).length === 0)) return;
    setStep(next);
  };
  const draw = () => {
    const shuffled = [...slots].sort(() => Math.random() - 0.5);
    setDrawn(Object.fromEntries(shuffled));
  };

  const signIn = (username: string, password: string) => {
    const user = members.find((m) => m.username === username.trim().toLowerCase() && m.password === password);
    if (!user) return setLoginError("Tên đăng nhập hoặc mật khẩu chưa đúng.");
    setActiveUser(user); setLoginError(""); setShowCheckin(!user.responded);
  };
  const checkInSelf = (attending: boolean) => {
    if (!activeUser) return;
    const updated = members.map((m) => m.name === activeUser.name ? { ...m, present: attending, responded: true } : m);
    localStorage.setItem("aemit-attendance", JSON.stringify(updated));
    setMembers(updated); setActiveUser({ ...activeUser, present: attending, responded: true }); setShowCheckin(false);
  };
  useEffect(() => {
    const saved = localStorage.getItem("aemit-attendance");
    if (saved) setMembers(JSON.parse(saved));
    const syncAttendance = (event: StorageEvent) => { if (event.key === "aemit-attendance" && event.newValue) setMembers(JSON.parse(event.newValue)); };
    window.addEventListener("storage", syncAttendance);
    return () => window.removeEventListener("storage", syncAttendance);
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

  if (!activeUser) return <Login onLogin={signIn} error={loginError} />;
  const isAdmin = activeUser.role === "admin";

  return <main className={"app-shell " + (sidebarOpen ? "sidebar-open" : "")}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">🏸</span><div><b>ANH EM IT</b><small>BADMINTON CLUB</small></div></div>
      <nav onClick={() => setSidebarOpen(false)}>
        <button className={screen === "home" ? "active" : ""} onClick={() => setScreen("home")}><span>⌂</span> Buổi chơi hôm nay</button>
        {isAdmin && <button className={screen === "members" ? "active" : ""} onClick={() => setScreen("members")}><span>♙</span> Thành viên</button>}
        <button><span>▥</span> Bảng xếp hạng</button>
        <button><span>◷</span> Lịch sử thi đấu</button>
      </nav>
      <div className="club-card"><span>🏆</span><b>Tháng 7, 2026</b><small>3 / 4 buổi đã hoàn thành</small><div className="progress"><i /></div></div>
      <div className="profile"><div className="avatar small" style={{ background: activeUser.color }}>{activeUser.initials}</div><div><b>{activeUser.name}</b><small>{isAdmin ? "Quản trị viên" : "Thành viên"}</small></div><button className="logout" onClick={() => setActiveUser(null)}>Đăng xuất</button></div>
    </aside>
    <section className="content">
      <header><div className="title-group"><button className="mobile-menu" aria-label="Mở menu" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button><div><p className="eyebrow">THỨ BẢY, 26 THÁNG 7</p><h1>{screen === "home" ? "Buổi chơi hôm nay" : "Quản lý thành viên"}</h1></div></div><div className="header-actions"><button className="icon-btn">⌕</button><button className="icon-btn">♧</button>{isAdmin && <button className="new-btn" onClick={() => setScreen("members")}>+ {screen === "home" ? "Tạo buổi mới" : "Thêm thành viên"}</button>}</div></header>
      {screen === "members" ? <Members members={members} /> : <>
        <section className="hero"><div><span className="live-dot">● ĐANG DIỄN RA</span><h2>Buổi chơi #04 <span>·</span> Tháng 7</h2><p>19:00 – 21:30 &nbsp;·&nbsp; Sân cầu lông Hoàng Mai</p></div><div className="hero-stats"><div><b>{present.length}</b><small>NGƯỜI CÓ MẶT</small></div><div><b>0{step + 1}<em>/04</em></b><small>BƯỚC HIỆN TẠI</small></div></div></section>
        <section className="workflow">{steps.map((label, i) => <button key={label} className={i === step ? "current" : i < step ? "done" : ""} onClick={() => goStep(i)}><span>{i < step ? "✓" : i + 1}</span>{label}</button>)}</section>
        {step === 0 && <CheckIn members={members} setMembers={setMembers} onContinue={() => goStep(1)} canSchedule={canSchedule} isAdmin={isAdmin} currentUser={activeUser} openSelfCheckin={() => setShowCheckin(true)} />}
        {step === 1 && <Draw drawn={drawn} draw={draw} drawSelf={drawSelf} spinning={spinning} currentUser={activeUser} isAdmin={isAdmin} onContinue={() => goStep(2)} />}
        {step === 2 && <Schedule matches={matches} drawn={drawn} onContinue={() => goStep(3)} isAdmin={isAdmin} />}
        {step === 3 && <Results matches={matches} scores={scores} setScores={setScores} isAdmin={isAdmin} />}
        <Ranking />
      </>}
    </section>
    {showCheckin && <CheckinModal member={activeUser} onAnswer={checkInSelf} onSkip={() => setShowCheckin(false)} />}
  </main>;
}

function CheckIn({ members, onContinue, canSchedule, isAdmin, currentUser, openSelfCheckin }: { members: Member[]; setMembers: (m: Member[]) => void; onContinue: () => void; canSchedule: boolean; isAdmin: boolean; currentUser: Member; openSelfCheckin: () => void }) { const n = members.filter(m => m.present).length; const allResponded = members.every((m) => m.responded); return <section className="panel checkin"><div className="panel-head"><div><h2>Điểm danh thành viên</h2><p>{isAdmin ? "Admin chỉ điểm danh cho chính mình và mở bước tiếp theo khi toàn bộ thành viên đã phản hồi." : "Bạn chỉ có thể điểm danh cho chính mình; các nội dung khác ở chế độ xem."}</p></div><div className="attendance-live"><i /> Cập nhật trực tiếp</div><div className="count-pill">{n} người có mặt</div></div><div className="member-grid">{members.map((m) => <div className={"member-card readonly " + (m.present ? "selected" : "")} key={m.name}><div className="avatar" style={{ background: m.color }}>{m.initials}</div><div><b>{m.name}{m.name === currentUser.name && <em>Bạn</em>}</b><small>Level {m.level} · {m.responded ? (m.present ? "Tham gia" : "Không tham gia") : "Chưa phản hồi"}</small></div><span className={"attendance-mark " + (!m.responded ? "waiting" : m.present ? "yes" : "no")}>{!m.responded ? "…" : m.present ? "✓" : "×"}</span></div>)}</div>{!canSchedule && <div className="warning">Cần tối thiểu 6 người có mặt để tạo lịch thi đấu tự động.</div>}<div className="panel-foot"><span>{allResponded ? "✓ Toàn bộ thành viên đã phản hồi. Admin có thể xác nhận để mở bốc số." : "Đang chờ các thành viên tự phản hồi điểm danh — trạng thái cập nhật trực tiếp."}</span><div className="attendance-actions"><button className="soft-btn" onClick={openSelfCheckin}>{currentUser.responded ? "Cập nhật điểm danh của tôi" : "Điểm danh của tôi"}</button>{isAdmin && <button className="primary" disabled={!canSchedule || !allResponded} onClick={onContinue}>Xác nhận điểm danh & mở bốc số <span>→</span></button>}</div></div></section> }
function Draw({ drawn, draw, drawSelf, spinning, currentUser, isAdmin, onContinue }: { drawn: Record<string, number>; draw: () => void; drawSelf: () => void; spinning: boolean; currentUser: Member; isAdmin: boolean; onContinue: () => void }) { const entries = Object.entries(drawn); const mine = drawn[currentUser.name]; return <section className="panel draw-panel"><div className="panel-head"><div><h2>Bốc số ngẫu nhiên</h2><p>{isAdmin ? "Theo dõi số đã bốc. Bước tạo lịch chỉ mở sau khi mọi người hoàn tất." : `Bạn đang ở Level ${currentUser.level}; giao diện chỉ hiển thị vòng quay phù hợp với cấp độ của bạn.`}</p></div><span className="mode">LEVEL {currentUser.level}</span></div><div className="draw-body"><div className={"wheel " + (spinning ? "spinning" : "")}><div className="wheel-inner">{spinning ? <b>…<small>ĐANG QUAY</small></b> : mine ? <b>#{mine}<small>SỐ CỦA BẠN</small></b> : <b>?</b>}</div></div><div className="draw-copy"><span className="tag">{currentUser.level === 1 ? "VÒNG QUAY LEVEL 1 · SỐ 1–4" : "VÒNG QUAY LEVEL 2 · SỐ 5–10"}</span><h2>{spinning ? "Vòng quay đang chọn số…" : mine ? "Bạn đã có số!" : "Đến lượt bạn bốc số"}</h2><p>Vòng quay kéo dài 3,5 giây. Hệ thống giữ số đã chọn ngay khi bốc để không thành viên nào nhận trùng số.</p><button className="primary" disabled={spinning} onClick={isAdmin ? draw : drawSelf}>{spinning ? "Đang quay…" : isAdmin ? "Bốc số mô phỏng" : mine ? "Xem số đã bốc" : "Bốc số của tôi"} <span>↻</span></button></div></div>{entries.length > 0 && <div className="draw-list">{entries.map(([name, no]) => <div key={name}><span>{name}</span><b>#{no}</b></div>)}</div>}<div className="panel-foot"><span>🔒 Số được giữ duy nhất ngay khi quay.</span>{isAdmin && <button className="primary" disabled={entries.length < 1} onClick={onContinue}>Tạo lịch thi đấu <span>→</span></button>}</div></section> }
function Schedule({ matches, drawn, onContinue, isAdmin }: { matches: string[][]; drawn: Record<string, number>; onContinue: () => void; isAdmin: boolean }) { return <section className="panel"><div className="panel-head"><div><h2>Lịch thi đấu tự động</h2><p>{Object.keys(drawn).length ? "Đã ghép lịch theo số bốc và Level của các thành viên." : "Lịch mẫu được tạo theo quy tắc mỗi người thi đấu 4 trận."}</p></div>{isAdmin && <button className="soft-btn">↻ Tạo lại lịch</button>}</div><div className="schedule-grid">{matches.map((m, i) => <Match match={m} i={i} key={i} />)}</div>{isAdmin && <div className="panel-foot"><span>✓ Mỗi người 4 trận · Không lặp đồng đội</span><button className="primary" onClick={onContinue}>Bắt đầu nhập điểm <span>→</span></button></div>}</section> }
function Match({ match, i }: { match: string[]; i: number }) { return <article className="match"><div className="match-top"><b>TRẬN {String(i + 1).padStart(2, "0")}</b><span>{match[4]}</span></div><div className="teams"><div>{match[0]}<small> + {match[1]}</small></div><strong>VS</strong><div>{match[2]}<small> + {match[3]}</small></div></div></article> }
function Results({ matches, scores, setScores, isAdmin }: { matches: string[][]; scores: Record<number, [string, string]>; setScores: (x: Record<number, [string, string]>) => void; isAdmin: boolean }) { return <section className="panel"><div className="panel-head"><div><h2>Nhập kết quả</h2><p>{isAdmin ? "Cập nhật điểm từng trận. Hệ thống sẽ tự tính bảng xếp hạng tháng." : "Chỉ Admin có thể nhập và chốt kết quả buổi chơi."}</p></div><span className="count-pill">{Object.keys(scores).length}/{matches.length} trận</span></div><div className="result-list">{matches.map((m, i) => <div className="result-row" key={i}><b>#{i + 1}</b><span>{m[0]} + {m[1]}</span><input disabled={!isAdmin} aria-label="Điểm đội A" value={scores[i]?.[0] ?? ""} onChange={e => setScores({ ...scores, [i]: [e.target.value, scores[i]?.[1] ?? ""] })}/><em>:</em><input disabled={!isAdmin} aria-label="Điểm đội B" value={scores[i]?.[1] ?? ""} onChange={e => setScores({ ...scores, [i]: [scores[i]?.[0] ?? "", e.target.value] })}/><span>{m[2]} + {m[3]}</span></div>)}</div>{isAdmin && <div className="panel-foot"><span>Điểm cao hơn sẽ được tính là thắng (+1 điểm).</span><button className="primary">Chốt kết quả buổi chơi <span>✓</span></button></div>}</section> }
function Ranking() { const [month, setMonth] = useState("Tháng 7, 2026"); const months = ["Tháng 7, 2026", "Tháng 6, 2026", "Tháng 5, 2026"]; return <section className="ranking"><div className="section-title"><div><p className="eyebrow">XẾP HẠNG THEO THÁNG</p><h2>Bảng xếp hạng</h2></div></div><div className="ranking-toolbar"><div className="month-tabs">{months.map((m) => <button key={m} className={month === m ? "chosen" : ""} onClick={() => setMonth(m)}>{m}{m !== months[0] && <small>Lịch sử</small>}</button>)}</div><p>{month === months[0] ? "BXH hiện tại sẽ khóa và reset sau 3 ngày kể từ buổi cuối tháng." : "Dữ liệu lịch sử đã được lưu và chỉ có thể xem."}</p></div><div className="rank-table"><div className="rank-head rank-columns"><span>Vị trí</span><span>Thành viên</span><span>Điểm</span><span>Điểm thắng</span><span>Điểm thua</span><span>Hiệu số</span><span>Số trận</span></div>{ranking.map((r, i) => <div className={"rank-row rank-columns " + (i < 3 ? "top-rank top-" + (i + 1) : "")} key={r[0] as string}><b className={i < 3 ? "medal m" + i : "rank-number"}>{i + 1}</b><div className="person"><div className="avatar small" style={{ background: r[7] as string }}>{r[1]}</div><b>{r[0]}</b><span className="level">L{i < 4 ? 1 : 2}</span></div><b className="point-value">{r[2]}</b><span>{r[3]}</span><span>{r[4]}</span><span className={String(r[5]).startsWith("+") ? "positive" : "negative"}>{r[5]}</span><span>{r[6]}</span></div>)}</div></section> }
function Members({ members }: { members: Member[] }) { return <><section className="member-summary"><div><b>{members.length}</b><span>Tổng thành viên</span></div><div><b>4</b><span>Level 1</span></div><div><b>6</b><span>Level 2</span></div><div><b>{members.length}</b><span>Đang hoạt động</span></div></section><section className="panel"><div className="panel-head"><div><h2>Danh sách thành viên</h2><p>Quản lý thông tin và cấp độ của các thành viên CLB.</p></div><input className="search" placeholder="⌕  Tìm thành viên..." /></div><div className="member-table">{members.map(m => <div key={m.name}><div className="person"><div className="avatar" style={{ background: m.color }}>{m.initials}</div><div><b>{m.name}</b><small>@{m.name.toLowerCase().replace(" ", "")}</small></div></div><span className="level">Level {m.level}</span><span className="status">● Hoạt động</span><button className="more">•••</button></div>)}</div></section></> }

function Login({ onLogin, error }: { onLogin: (username: string, password: string) => void; error: string }) {
  const [username, setUsername] = useState("manh"); const [password, setPassword] = useState("123456");
  return <main className="login-page"><section className="login-card"><div className="login-brand"><span>🏸</span><div><b>ANH EM IT</b><small>BADMINTON CLUB</small></div></div><div><p className="eyebrow">CHÀO MỪNG TRỞ LẠI</p><h1>Đăng nhập CLB</h1><p>Đăng nhập để điểm danh và theo dõi lịch thi đấu của bạn.</p></div><form onSubmit={(e) => { e.preventDefault(); onLogin(username, password); }}><label>Tên đăng nhập<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Ví dụ: manh" /></label><label>Mật khẩu<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nhập mật khẩu" /></label>{error && <p className="login-error">{error}</p>}<button className="primary" type="submit">Đăng nhập <span>→</span></button></form><div className="demo-login"><b>Tài khoản demo</b><span>Admin: <code>manh / 123456</code></span><span>Thành viên: <code>hung / 123456</code></span></div></section></main>;
}

function CheckinModal({ member, onAnswer, onSkip }: { member: Member; onAnswer: (attending: boolean) => void; onSkip: () => void }) { return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Điểm danh buổi chơi"><section className="checkin-modal"><button className="modal-close" onClick={onSkip} aria-label="Đóng">×</button><span className="modal-icon">🏸</span><p className="eyebrow">BUỔI CHƠI THỨ BẢY</p><h2>Chào {member.name}, bạn có tham gia không?</h2><p>Hãy phản hồi để Admin chốt danh sách và mở bốc số vào thứ Tư. Bạn vẫn có thể thay đổi sau trong trang chính.</p><div className="modal-actions"><button className="primary" onClick={() => onAnswer(true)}>✓ Tôi tham gia</button><button className="secondary" onClick={() => onAnswer(false)}>Tôi không tham gia</button></div><button className="skip" onClick={onSkip}>Để sau</button></section></div> }
