"use client";

import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { analyze, attendance, bestPartners, eloChange, eloSeries, highlights, inRange, MIN_MATCHES, CLOSE_MARGIN, monthsWithMatches, pairKey, pointDiff, rivals, winRate } from "@/lib/stats";
import { GlassSelect } from "./glass-select";
import { PageHero } from "./page-hero";
import { useSlidingIndicator } from "./use-sliding-indicator";

// Xếp hạng › Thống kê and the page each member opens to from Thành viên. Styles: app/stats.css (classes start "st-").

export type StatsMember = { id: string; username: string; name: string; level: 1 | 2; active: boolean; joinedOn: string | null; elo: number };
export type StatsMatch = { id: string; date: string; no: number; a: string[]; b: string[]; sa: number; sb: number; expA: number | null };
export type StatsPayload = { members: StatsMember[]; matches: StatsMatch[]; sessions: { date: string; present: string[] }[]; eloBySession: { date: string; r: Record<string, number> }[] };
type AvatarSize = "sm" | "md" | "lg" | "xl";
type Common = { data: StatsPayload | null; error: string; meId: string | null; avatar: (member: StatsMember, size: AvatarSize) => ReactNode; onOpenMember: (id: string) => void };
type Section = "tong-quan" | "cap-doi" | "doi-dau" | "ca-nhan";
type Tally = { m: number; w: number; pf: number; pa: number };
type Pair = Tally & { key: string; ids: string[]; chem: number; list: StatsMatch[] };
type Stats = ReturnType<typeof analyze>;

const collator = new Intl.Collator("vi");
const nf = new Intl.NumberFormat("vi-VN");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (n: number) => (n > 0 ? `+${nf.format(n)}` : nf.format(n));
const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const wl = (x: Tally) => `${x.w}–${x.m - x.w}`;
const SECTIONS: { key: Section; label: string }[] = [{ key: "tong-quan", label: "Tổng quan" }, { key: "cap-doi", label: "Cặp đôi" }, { key: "doi-dau", label: "Đối đầu" }, { key: "ca-nhan", label: "Cá nhân" }];
const SERIES = ["--st-s1", "--st-s2", "--st-s3", "--st-s4", "--st-s5"];
const PREF_KEY = "aemit-stats-filters";

const readPrefs = (): { range?: string; section?: Section; member?: string | null; person?: string } => {
  try { return JSON.parse(window.localStorage.getItem(PREF_KEY) || "{}"); } catch { return {}; }
};
const writePrefs = (prefs: object) => { try { window.localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} };
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// A number that counts from its last value to the new one.
function Count({ value, format = "int" }: { value: number; format?: "int" | "dec" | "pct" }) {
  // Starts at 0 on the server and in the browser alike; the effect then counts up (or jumps, with reduced motion).
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (reduceMotion() || start === value) { setShown(value); return; }
    let frame = 0;
    const t0 = performance.now();
    const step = (now: number) => { const t = Math.min(1, (now - t0) / 900); setShown(start + (value - start) * (1 - (1 - t) ** 3)); if (t < 1) frame = requestAnimationFrame(step); };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  const text = format === "pct" ? `${Math.round(shown)}%` : format === "dec" ? shown.toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : nf.format(Math.round(shown));
  return <span className="st-num">{text}</span>;
}

// Bars, rings and splits grow from zero when they first appear, then move between values.
function useGrown() {
  const [grown, setGrown] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true))); return () => cancelAnimationFrame(frame); }, []);
  return grown;
}
const grow = (grown: boolean, value: number) => ({ "--v": grown ? value : 0 } as CSSProperties);

function Switch<T extends string>({ value, options, onChange, label, className = "" }: { value: T; options: { key: T; label: string }[]; onChange: (next: T) => void; label: string; className?: string }) {
  const ref = useSlidingIndicator<HTMLDivElement>(value);
  return <div ref={ref} className={`st-switch ${className}`} role="tablist" aria-label={label}>
    {options.map((o) => <button key={o.key} type="button" role="tab" aria-selected={o.key === value} className={o.key === value ? "active" : ""} onClick={() => o.key !== value && onChange(o.key)}>{o.label}</button>)}
    <i className="slide-indicator" aria-hidden="true" />
  </div>;
}

function Head({ title, sub, children, inline = false }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; inline?: boolean }) {
  return <div className={"panel-head st-head" + (inline ? " st-head-inline" : "")}><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{children}</div>;
}

function Stat({ label, children, foot, small = false }: { label: string; children: ReactNode; foot?: ReactNode; small?: boolean }) {
  return <div className={"st-card st-stat" + (small ? " sm" : "")}><span>{label}</span><b>{children}</b>{foot && <em>{foot}</em>}</div>;
}

function Empty({ children }: { children: ReactNode }) { return <div className="st-empty">{children}</div>; }

function HlCard({ label, who, sub, go }: { label: string; who: ReactNode; sub: ReactNode; go: () => void }) {
  return <button type="button" className="st-card st-hl" onClick={go}><span>{label}</span><span className="st-who">{who}</span><span className="st-sub">{sub}</span></button>;
}
function HlMissing({ label, text }: { label: string; text: string }) {
  return <div className="st-card st-hl"><span>{label}</span><span className="st-sub">{text}</span></div>;
}

// ---------- ELO chart ----------
function EloChart({ ids, points, nameOf }: { ids: string[]; points: { date: string; r: Record<string, number> }[]; nameOf: (id: string) => string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  if (!points.length || !ids.length) return <Empty>Chưa có buổi nào trong khoảng thời gian này.</Empty>;
  const H = width < 480 ? 220 : 260, pad = { l: 46, r: 14, t: 12, b: 28 };
  const value = (p: { r: Record<string, number> }, id: string) => p.r[id];
  const values = points.flatMap((p) => ids.map((id) => value(p, id))).filter((v) => Number.isFinite(v));
  if (!values.length) return <Empty>Chưa có trận nào trong khoảng thời gian này.</Empty>;
  const raw = (Math.max(...values) - Math.min(...values) || 1) / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(Math.min(...values) / step) * step, hi = Math.ceil(Math.max(...values) / step) * step;
  const ticks: number[] = []; for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const x = (i: number) => pad.l + (points.length === 1 ? (width - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (width - pad.l - pad.r));
  const every = Math.ceil(points.length / Math.max(2, Math.floor((width - pad.l) / 64)));
  const pathOf = (id: string) => { let d = "", started = false; points.forEach((p, i) => { const v = value(p, id); if (!Number.isFinite(v)) return; d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; started = true; }); return d; };
  const lastIndex = (id: string) => { for (let i = points.length - 1; i >= 0; i--) if (Number.isFinite(value(points[i], id))) return i; return -1; };
  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!rect) return;
    const px = ((event.clientX - rect.left) / rect.width) * width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / (width - pad.l - pad.r)) * (points.length - 1)))));
  };
  return <div className="st-chart" ref={box}>
    <svg key={`${ids.join()}-${points.length}-${points[0].date}`} viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label="ELO theo thời gian">
      {ticks.map((t) => <g key={t}><line className="st-grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} /><text x={pad.l - 8} y={y(t) + 4} textAnchor="end">{nf.format(t)}</text></g>)}
      {points.map((p, i) => ((i % every === 0 && points.length - 1 - i >= every) || i === points.length - 1) && <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle">{fmtDate(p.date)}</text>)}
      {ids.length === 1 && (() => { const d = pathOf(ids[0]), li = lastIndex(ids[0]); return d && li >= 0 ? <path className="st-area" d={`${d}L${x(li)},${H - pad.b}L${x(points.findIndex((p) => Number.isFinite(value(p, ids[0]))))},${H - pad.b}Z`} fill={`var(${SERIES[0]})`} /> : null; })()}
      {ids.map((id, n) => <path key={id} className="st-line" pathLength={1} d={pathOf(id)} stroke={`var(${SERIES[n % 5]})`} style={{ animationDelay: `${n * 90}ms` }} />)}
      {ids.map((id, n) => { const li = lastIndex(id); return li >= 0 ? <circle key={id} className="st-dot" cx={x(li)} cy={y(value(points[li], id))} r={4.5} fill={`var(${SERIES[n % 5]})`} /> : null; })}
      {hover !== null && <line className="st-guide" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />}
      <rect x={pad.l} y={0} width={width - pad.l - pad.r} height={H} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
    </svg>
    {hover !== null && <div className="st-tip" style={{ left: `${Math.min(Math.max(x(hover), 80), width - 80)}px` }}>
      <b>Sau buổi {fmtDate(points[hover].date)}</b>
      {ids.map((id, n) => [id, n, value(points[hover], id)] as const).filter(([, , v]) => Number.isFinite(v)).sort((a, b) => b[2] - a[2]).map(([id, n, v]) => <div key={id}><i style={{ background: `var(${SERIES[n % 5]})` }} />{nameOf(id)}<span className="st-num">{nf.format(Math.round(v))}</span></div>)}
    </div>}
  </div>;
}

// ---------- Shared pieces ----------
function PeopleCard({ title, sub, rows, none, avatarOf, nameOf }: { title: string; sub: string; rows: [string, Tally][]; none: string; avatarOf: (id: string) => ReactNode; nameOf: (id: string) => string }) {
  return <div className="st-card st-people"><h3>{title}</h3><p>{sub}</p>{rows.length ? <ol>{rows.map(([id, x]) => <li key={id}>{avatarOf(id)}<b>{nameOf(id)}</b><span className="st-num">{wl(x)}</span><span className={"st-num " + (winRate(x) >= 0.5 ? "st-pos" : "st-neg")}>{pct(winRate(x))}</span></li>)}</ol> : <p className="st-none">{none}</p>}</div>;
}

function MatchList({ matches, sideOf, nameOf }: { matches: StatsMatch[]; sideOf: (m: StatsMatch) => "a" | "b"; nameOf: (id: string) => string }) {
  const team = (t: string[]) => t.map(nameOf).join(" + ");
  return <ol className="st-matches">{matches.map((m) => {
    const mine = sideOf(m) === "a", A = mine ? m.a : m.b, B = mine ? m.b : m.a, sa = mine ? m.sa : m.sb, sb = mine ? m.sb : m.sa;
    return <li key={m.id}><span className="st-d">{fmtDate(m.date)} · trận {m.no}</span><span className={"st-t" + (sa > sb ? " won" : "")}>{team(A)}</span><span className="st-sc">{sa}–{sb}</span><span className={"st-t b" + (sb > sa ? " won" : "")}>{team(B)}</span></li>;
  })}</ol>;
}

function Heat({ ids, get, none, nameOf }: { ids: string[]; get: (a: string, b: string) => Tally | undefined; none: string; nameOf: (id: string) => string }) {
  let i = 0;
  return <><div className="st-heat" style={{ gridTemplateColumns: `64px repeat(${ids.length}, minmax(0, 1fr))` }}>
    <span />
    {ids.map((id) => <span key={id} className="st-hd">{nameOf(id)}</span>)}
    {ids.map((a) => [<span key={`h-${a}`} className="st-hd r">{nameOf(a)}</span>, ...ids.map((b) => {
      i++;
      if (a === b) return <span key={`${a}-${b}`} className="st-cell self" />;
      const c = get(a, b), title = `${nameOf(a)} – ${nameOf(b)}`;
      if (!c || !c.m) return <span key={`${a}-${b}`} className="st-cell none" style={{ "--i": i } as CSSProperties} title={`${title}: ${none}`}>–</span>;
      const r = winRate(c), strength = Math.round(Math.abs(r - 0.5) * 140) + 10;
      return <span key={`${a}-${b}`} className={"st-cell" + (c.m < MIN_MATCHES ? " thin" : "")} style={{ "--i": i, "--bg": `color-mix(in srgb, var(${r >= 0.5 ? "--st-win" : "--st-lose"}) ${strength}%, var(--st-track))` } as CSSProperties} title={`${title}: ${c.w} thắng, ${c.m - c.w} thua`}>{wl(c)}</span>;
    })])}
  </div><div className="st-heat-key">Thua nhiều<i />Thắng nhiều</div></>;
}

// ---------- The data every screen works from ----------
function useModel(data: StatsPayload | null) {
  return useMemo(() => {
    if (!data) return null;
    const byId = new Map(data.members.map((m) => [m.id, m]));
    const nameOf = (id: string) => byId.get(id)?.name ?? "Thành viên cũ";
    const months = monthsWithMatches(data.matches);
    const rangeOptions = [{ value: "month", label: "Tháng này" }, { value: "3m", label: "3 tháng" }, { value: "all", label: "Từ đầu" }, ...months.map((ym: string) => ({ value: `m-${ym}`, label: `Tháng ${Number(ym.slice(5))}, ${ym.slice(0, 4)}` }))];
    const active = data.members.filter((m) => m.active);
    const eloRank = [...active].sort((a, b) => b.elo - a.elo);
    return { byId, nameOf, rangeOptions, active, eloRank };
  }, [data]);
}

// ---------- Personal block (the Cá nhân tab and the member page) ----------
function Personal({ st, data, id, compact, rangeLabel, model, avatarOf, sessions, meId, onOpenMember, filters }: { filters?: ReactNode; st: Stats; data: StatsPayload; id: string; compact: boolean; rangeLabel: string; model: NonNullable<ReturnType<typeof useModel>>; avatarOf: (id: string, size?: AvatarSize) => ReactNode; sessions: { date: string; present: string[] }[]; meId: string | null; onOpenMember: (id: string) => void }) {
  const grown = useGrown();
  const member = model.byId.get(id);
  const p = (st.person as Record<string, Tally & { closeW: number; closeL: number; deuceW: number; deuceL: number; blowW: number; upsetW: number; bestStreak: number; current: { won: boolean; n: number } }>)[id];
  const name = model.nameOf(id);
  const delta = Math.round(eloChange(data.eloBySession, id, member?.elo));
  const head = compact
    ? <Head title="Thành tích" sub={`${rangeLabel}${p ? ` · ${p.m} trận có tỉ số` : ""}`} />
    : <div className="panel-head st-me-head">
      <button type="button" className="st-avatar-btn" aria-label={`Mở trang của ${name}`} title={`Mở trang của ${name}`} onClick={() => onOpenMember(id)}>{avatarOf(id, "md")}</button>
      <div className="st-me-who"><h2>{name}{member && <span className={`st-chip l${member.level}`}>Level {member.level}</span>}{id === meId && <span className="st-chip me">Tôi</span>}</h2><p>{rangeLabel}{p ? ` · ${p.m} trận` : ""}</p></div>
      <div className="st-elo-now"><b className="st-num">{member ? nf.format(Math.round(member.elo)) : "–"}</b><span>ELO hiện tại · <span className={delta >= 0 ? "st-pos" : "st-neg"}>{signed(delta)} trong 4 tuần</span></span></div>
      {filters}
    </div>;
  if (!p) return <section className="panel st-panel">{head}<div className="st-body"><Empty>{name} chưa có trận nào có tỉ số trong khoảng thời gian này.</Empty></div></section>;
  const att = attendance(sessions, id, member?.joinedOn ?? null), attPct = att.held ? (att.came / att.held) * 100 : 0;
  const { nemesis, prey } = rivals(st, id, model.nameOf, collator) as { nemesis: [string, Tally][]; prey: [string, Tally][] };
  const partners = bestPartners(st, id, model.nameOf, collator) as [string, Tally][];
  const cur = p.current.n ? `${p.current.won ? "Thắng" : "Thua"} ${p.current.n}` : "–";
  return <>
    <section className="panel st-panel">{head}
      <div className="st-body"><div className="st-me-main">
        <div className="st-ring" role="img" aria-label={`Tỉ lệ thắng ${pct(winRate(p))}`}><svg viewBox="0 0 148 148"><circle className="bg" cx="74" cy="74" r="60" /><circle className="fg" cx="74" cy="74" r="60" style={grow(grown, winRate(p) * 100)} /></svg><div><b><Count value={winRate(p) * 100} format="pct" /></b><span>tỉ lệ thắng</span></div></div>
        <div className="st-grid-4">
          <Stat label="Thắng – thua" small><span className="st-num">{wl(p)}</span></Stat>
          <Stat label="Hiệu số" small><span className={"st-num " + (pointDiff(p) >= 0 ? "st-pos" : "st-neg")}>{signed(pointDiff(p))}</span></Stat>
          <Stat label="Chuỗi hiện tại" small>{cur}</Stat>
          <Stat label="Chuỗi thắng dài nhất" small><span className="st-num">{p.bestStreak}</span><small>trận</small></Stat>
          <Stat label="Trận sát nút" small><span className="st-num">{p.closeW}–{p.closeL}</span></Stat>
          <Stat label="Trận deuce" small><span className="st-num">{p.deuceW}–{p.deuceL}</span></Stat>
          <Stat label="Thắng cách biệt" small><span className="st-num">{p.blowW}</span><small>trận</small></Stat>
          <Stat label="Thắng bất ngờ" small><span className="st-num">{p.upsetW}</span><small>trận</small></Stat>
        </div>
      </div></div>
    </section>
    <section className="panel st-panel"><Head title={`ELO của ${name}`} sub="Sau mỗi buổi trong khoảng thời gian đã chọn." /><div className="st-body"><EloChart ids={[id]} points={eloSeries(data.eloBySession, sessions)} nameOf={model.nameOf} /></div></section>
    <section className="panel st-panel"><Head title="Chuyên cần" sub="Các buổi đã diễn ra trong khoảng thời gian đã chọn." />
      <div className="st-body"><div className="st-attend">
        <div className="st-attend-stat"><b><Count value={attPct} format="pct" /></b><span><span className="st-num">{att.came}/{att.held}</span> buổi có mặt</span></div>
        <div className="st-days">{att.days.map((d: { date: string; came: boolean }) => <span key={d.date} className={"st-day" + (d.came ? " on" : "")} title={`${fmtDate(d.date)}: ${d.came ? "có mặt" : "vắng"}`}>{fmtDate(d.date)}</span>)}</div>
      </div></div>
    </section>
    <section className="panel st-panel"><Head title="Đồng đội và đối thủ" sub={`Chỉ tính người đã đánh cùng hoặc gặp từ ${MIN_MATCHES} trận.`} />
      <div className="st-body"><div className="st-grid-3">
        <PeopleCard title="Đồng đội hợp nhất" sub="Thắng nhiều nhất khi đánh cùng đội" rows={partners} none="Chưa có đồng đội nào cùng thắng quá nửa số trận." avatarOf={avatarOf} nameOf={model.nameOf} />
        <PeopleCard title="Khắc tinh" sub="Đối thủ thắng mình nhiều hơn thua" rows={nemesis} none="Không đối thủ nào thắng mình quá nửa số lần gặp." avatarOf={avatarOf} nameOf={model.nameOf} />
        <PeopleCard title="Con mồi" sub="Đối thủ mình thắng nhiều hơn thua" rows={prey} none="Chưa thắng đối thủ nào quá nửa số lần gặp." avatarOf={avatarOf} nameOf={model.nameOf} />
      </div></div>
    </section>
  </>;
}

// ---------- Xếp hạng › Thống kê ----------
export function StatsScreen({ data, error, meId, avatar, onOpenMember }: Common) {
  const model = useModel(data);
  const prefs = useMemo(() => (typeof window === "undefined" ? {} : readPrefs()), []);
  const [section, setSection] = useState<Section>(prefs.section ?? "tong-quan");
  const [range, setRange] = useState(prefs.range ?? "3m");
  const [member, setMember] = useState<string | null>(prefs.member ?? null);
  const [person, setPerson] = useState<string | null>(prefs.person ?? null);
  const [vs, setVs] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  const [eloIds, setEloIds] = useState<string[] | null>(null);
  const [sort, setSort] = useState<{ key: "w" | "m" | "rate" | "diff" | "chem"; dir: 1 | -1 }>({ key: "w", dir: -1 });
  const [showFew, setShowFew] = useState(false);
  const [allPairs, setAllPairs] = useState(false);
  const [openPair, setOpenPair] = useState<string | null>(null);
  const grown = useGrown();
  useEffect(() => writePrefs({ section, range, member, person }), [section, range, member, person]);

  if (error) return <Empty>{error}</Empty>;
  if (!data || !model) return <div className="st-loading" aria-busy="true">Đang tải số liệu…</div>;
  const rangeOk = model.rangeOptions.some((o) => o.value === range) ? range : "3m";
  const rangeLabel = model.rangeOptions.find((o) => o.value === rangeOk)?.label ?? "";
  const { matches, sessions } = inRange(data, rangeOk);
  const st = analyze(matches) as Stats;
  const me = meId && model.byId.has(meId) ? meId : model.active[0]?.id ?? null;
  const personId = person && model.byId.has(person) ? person : me;
  const memberId = member && model.byId.has(member) ? member : null;
  const avatarOf = (id: string, size: AvatarSize = "sm") => { const m = model.byId.get(id); return m ? avatar(m, size) : null; };
  const pairName = (q: { ids: string[] }) => q.ids.map(model.nameOf).join(" + ");
  const plainOptions = () => [...model.active].sort((x, y) => (x.id === me ? -1 : y.id === me ? 1 : collator.compare(x.name, y.name))).map((m) => ({ value: m.id, label: m.name }));
  const memberOptions = (withAll: boolean) => [
    ...(withAll ? [{ value: "", label: "Cả CLB" }] : []),
    ...(me ? [{ value: me, label: `${model.nameOf(me)} (tôi)` }] : []),
    ...model.active.filter((m) => m.id !== me).sort((x, y) => collator.compare(x.name, y.name)).map((m) => ({ value: m.id, label: m.name })),
  ];
  const rangeSelect = <GlassSelect value={rangeOk} options={model.rangeOptions} onChange={(v) => { setRange(v); setAllPairs(false); setOpenPair(null); }} ariaLabel="Thời gian" />;
  // Tổng quan and Đối đầu have only the time field: on phones it sits beside the first block's title.
  const headRange = <div className="st-head-range">{rangeSelect}</div>;
  const memberSelect = section === "cap-doi" ? <GlassSelect value={memberId ?? ""} options={memberOptions(true)} onChange={(v) => { setMember(v || null); setAllPairs(false); setOpenPair(null); }} ariaLabel="Thành viên" />
    : section === "ca-nhan" && personId ? <GlassSelect value={personId} options={memberOptions(false)} onChange={setPerson} ariaLabel="Thành viên" /> : null;
  // On phones the bar keeps only the section switch; the filters sit in the first block (st-card-filters).
  const cardFilters = <div className="st-card-filters">{rangeSelect}{memberSelect}</div>;
  const tools = <div className="st-tools-right">{rangeSelect}{memberSelect}</div>;

  let body: ReactNode;
  if (!matches.length) body = <section className="panel st-panel"><div className="st-body st-top"><Empty>Chưa có trận nào có tỉ số trong khoảng thời gian này. Chọn “Từ đầu” hoặc một tháng khác.</Empty></div></section>;
  else if (section === "tong-quan") {
    const hl = highlights(st, model.nameOf, pairName, collator);
    const shown = eloIds ?? model.eloRank.slice(0, 5).map((m) => m.id);
    const maxB = Math.max(...st.buckets, 1), labels = ["1–2", "3–5", "6–9", "10–14", "15+"];
    const openPerson = (id: string) => { setPerson(id); setSection("ca-nhan"); };
    body = <>
      <section className="panel st-panel"><Head inline title="Toàn CLB" sub={`${rangeLabel} · ${nf.format(st.n)} trận có tỉ số trong ${sessions.length} buổi`}>{headRange}</Head>
        <div className="st-body"><div className="st-grid-4">
          <Stat label="Trận đã tính" foot={`trong ${sessions.length} buổi`}><Count value={st.n} /></Stat>
          <Stat label="Cách biệt trung bình" foot="chênh lệch điểm mỗi trận"><Count value={st.marginAvg} format="dec" /><small>điểm</small></Stat>
          <Stat label="Trận sát nút" foot={`cách nhau ${CLOSE_MARGIN} điểm trở xuống`}><Count value={st.closeRate * 100} format="pct" /></Stat>
          <Stat label="ELO đoán đúng" foot={`đội ELO cao hơn thắng, ${st.predicted} trận`}>{st.eloRight === null ? "–" : <Count value={st.eloRight * 100} format="pct" />}</Stat>
        </div></div>
      </section>
      <section className="panel st-panel"><Head title="Điểm nhấn" sub="Bấm vào một thẻ để xem chi tiết." />
        <div className="st-body"><div className="st-grid-4 st-hl-grid">
          {hl.topPair ? <HlCard label="Cặp thắng nhiều nhất" who={<><span className="st-pair">{hl.topPair.ids.map((pid: string) => <span key={pid}>{avatarOf(pid)}</span>)}</span><b>{pairName(hl.topPair)}</b></>} sub={<><b className="st-num">{wl(hl.topPair)}</b> · thắng {pct(winRate(hl.topPair))}</>} go={() => setSection("cap-doi")} /> : <HlMissing label="Cặp thắng nhiều nhất" text="Chưa có cặp nào thắng." />}
          {hl.streak ? <HlCard label="Chuỗi thắng dài nhất" who={<>{avatarOf(hl.streak.id)}<b>{model.nameOf(hl.streak.id)}</b></>} sub={<><b className="st-num">{hl.streak.bestStreak}</b> trận thắng liên tiếp</>} go={() => openPerson(hl.streak.id)} /> : <HlMissing label="Chuỗi thắng dài nhất" text="Chưa có trận thắng." />}
          {hl.clutch ? <HlCard label="Bản lĩnh trận sát nút" who={<>{avatarOf(hl.clutch.id)}<b>{model.nameOf(hl.clutch.id)}</b></>} sub={<>Thắng <b className="st-num">{hl.clutch.closeW}/{hl.clutch.closeW + hl.clutch.closeL}</b> trận cách {CLOSE_MARGIN} điểm trở xuống</>} go={() => openPerson(hl.clutch.id)} /> : <HlMissing label="Bản lĩnh trận sát nút" text={`Chưa ai có từ ${MIN_MATCHES} trận sát nút.`} />}
          {hl.darkHorse ? <HlCard label="Ngựa ô" who={<>{avatarOf(hl.darkHorse.id)}<b>{model.nameOf(hl.darkHorse.id)}</b></>} sub={<><b className="st-num">{hl.darkHorse.upsetW}</b> trận thắng khi ELO đội mình thấp hơn</>} go={() => openPerson(hl.darkHorse.id)} /> : <HlMissing label="Ngựa ô" text="Chưa có trận thắng bất ngờ." />}
        </div></div>
      </section>
      <div className="st-cols">
        <section className="panel st-panel"><Head title="ELO theo thời gian" sub="ELO sau mỗi buổi. Bấm tên để thêm hoặc bớt người, tối đa 5." />
          <div className="st-body">
            <div className="st-legend">{model.eloRank.map((m) => { const n = shown.indexOf(m.id); return <button key={m.id} type="button" aria-pressed={n >= 0} style={{ "--c": `var(${SERIES[Math.max(0, n) % 5]})` } as CSSProperties} onClick={() => {
              let next = n >= 0 ? shown.filter((x) => x !== m.id) : [...shown, m.id];
              if (next.length > 5) next = next.slice(1);
              setEloIds(next.length ? next : [m.id]);
            }}><i />{m.name}</button>; })}</div>
            <EloChart ids={shown} points={eloSeries(data.eloBySession, sessions)} nameOf={model.nameOf} />
          </div>
        </section>
        <section className="panel st-panel"><Head title="Cách biệt điểm" sub="Số trận theo chênh lệch điểm giữa hai đội." />
          <div className="st-body"><div className="st-histo">{st.buckets.map((b: number, i: number) => <div key={labels[i]}><div className={"st-bar" + (i === 0 ? " close" : "")} style={grow(grown, (b / maxB) * 100)}><span>{b}</span></div><small>{labels[i]} điểm</small></div>)}</div></div>
        </section>
      </div>
    </>;
  } else if (section === "cap-doi") {
    let pairs = Object.values(st.pair) as Pair[];
    if (memberId) pairs = pairs.filter((q) => q.ids.includes(memberId));
    if ((sort.key === "rate" || sort.key === "chem") && !showFew) pairs = pairs.filter((q) => q.m >= MIN_MATCHES);
    const val = { m: (q: Pair) => q.m, w: (q: Pair) => q.w, rate: (q: Pair) => winRate(q), diff: (q: Pair) => pointDiff(q), chem: (q: Pair) => q.chem };
    pairs.sort((x, y) => sort.dir * (val[sort.key](x) - val[sort.key](y)) || y.m - x.m || pointDiff(y) - pointDiff(x) || collator.compare(pairName(x), pairName(y)));
    const list = allPairs ? pairs : pairs.slice(0, 10);
    const th = (key: typeof sort.key, label: string, title?: string) => <span role="columnheader" aria-sort={sort.key === key ? (sort.dir < 0 ? "descending" : "ascending") : "none"}><button type="button" title={title} onClick={() => setSort(sort.key === key ? { key, dir: (sort.dir * -1) as 1 | -1 } : { key, dir: -1 })}>{label}</button></span>;
    body = <>
      <section className="panel st-panel">
        <Head title={`Cặp đôi${memberId ? ` của ${model.nameOf(memberId)}` : ""}`} sub="Hai người cùng một đội. Bấm vào một cặp để xem các trận của họ.">
          {cardFilters}
          <div className="st-tools">
            <div className="st-sort"><GlassSelect value={sort.key} options={[{ value: "w", label: "Thắng nhiều" }, { value: "m", label: "Đánh nhiều" }, { value: "rate", label: "Tỉ lệ thắng" }, { value: "diff", label: "Hiệu số" }, { value: "chem", label: "Ăn ý" }]} onChange={(v) => setSort({ key: v as typeof sort.key, dir: -1 })} ariaLabel="Xếp theo" /></div>
            <label className="st-check"><input type="checkbox" checked={showFew} onChange={(e) => setShowFew(e.target.checked)} /><span className="st-check-full">Hiện cả cặp dưới {MIN_MATCHES} trận</span><span className="st-check-short">Cặp dưới {MIN_MATCHES} trận</span></label>
          </div>
        </Head>
        <div className="st-body">
          {list.length ? <div className="st-rows">
            <div className="st-rows-head" role="row"><span role="columnheader">Cặp</span>{th("m", "Trận")}{th("w", "Thắng–thua")}{th("rate", "Tỉ lệ thắng")}{th("diff", "Hiệu số")}{th("chem", "Ăn ý", "Cặp thắng nhiều hơn (+) hay ít hơn (−) so với số trận ELO dự đoán")}</div>
            {list.map((q) => <div key={q.key} className="st-row-wrap">
              <button type="button" className={"st-row" + (openPair === q.key ? " open" : "")} aria-expanded={openPair === q.key} onClick={() => setOpenPair(openPair === q.key ? null : q.key)}>
                <span className="st-who"><span className="st-pair">{q.ids.map((pid) => <span key={pid}>{avatarOf(pid)}</span>)}</span><b>{pairName(q)}</b>{q.m < MIN_MATCHES && <span className="st-chip few">ít dữ liệu</span>}</span>
                <span className="st-num"><em className="st-lbl">Trận</em>{q.m}</span>
                <span className="st-num"><em className="st-lbl">Kết quả</em>{wl(q)}</span>
                <span><em className="st-lbl">Tỉ lệ</em><span className="st-rate"><span className="st-num">{pct(winRate(q))}</span><span className="st-track"><span className={"st-fill" + (winRate(q) < 0.5 ? " low" : "")} style={grow(grown, winRate(q) * 100)} /></span></span></span>
                <span className={"st-num " + (pointDiff(q) >= 0 ? "st-pos" : "st-neg")}><em className="st-lbl">Hiệu số</em>{signed(pointDiff(q))}</span>
                <span className={"st-num " + (q.chem >= 0 ? "st-pos" : "st-neg")}><em className="st-lbl">Ăn ý</em>{q.chem >= 0 ? "+" : "−"}{Math.round(Math.abs(q.chem) * 100)}%</span>
              </button>
              {openPair === q.key && <MatchList matches={q.list} sideOf={(m) => (m.a.includes(q.ids[0]) && m.a.includes(q.ids[1]) ? "a" : "b")} nameOf={model.nameOf} />}
            </div>)}
          </div> : <Empty>Chưa có cặp nào đủ {MIN_MATCHES} trận. Bật “Hiện cả cặp dưới {MIN_MATCHES} trận” để xem tất cả.</Empty>}
          {pairs.length > 10 && <button type="button" className="st-more" onClick={() => setAllPairs(!allPairs)}>{allPairs ? "Thu gọn" : `Xem tất cả ${pairs.length} cặp`}</button>}
        </div>
      </section>
      <section className="panel st-panel st-heat-block"><Head title="Bản đồ cặp đôi" sub={`Thành tích khi hai người đánh cùng đội. Ô nhạt là dưới ${MIN_MATCHES} trận.`} />
        <div className="st-body"><Heat ids={model.eloRank.map((m) => m.id)} get={(a, b) => (st.pair as Record<string, Pair>)[pairKey(a, b)]} none="chưa đánh cặp" nameOf={model.nameOf} /></div>
      </section>
    </>;
  } else if (section === "doi-dau") {
    const h2h = st.h2h as Record<string, Record<string, Tally & { list: StatsMatch[] }>>;
    const a = vs.a && model.byId.has(vs.a) ? vs.a : me ?? model.active[0].id;
    const opponents = Object.entries(h2h[a] || {}).sort((x, y) => y[1].m - x[1].m || collator.compare(model.nameOf(x[0]), model.nameOf(y[0])));
    const b = vs.b && vs.b !== a && model.byId.has(vs.b) ? vs.b : opponents[0]?.[0] ?? model.active.find((m) => m.id !== a)?.id ?? a;
    const h = h2h[a]?.[b];
    const list = h ? [...h.list].reverse() : [];
    const close = list.filter((m) => Math.abs(m.sa - m.sb) <= CLOSE_MARGIN).length;
    const { nemesis, prey } = rivals(st, a, model.nameOf, collator) as { nemesis: [string, Tally][]; prey: [string, Tally][] };
    body = <>
      <section className="panel st-panel"><Head inline title="Đối đầu" sub="Các trận hai người ở hai đội khác nhau.">{headRange}</Head>
        <div className="st-body">
          {/* The two people are picked right in the score card: each name is a dropdown. */}
          <div className="st-card st-score">
            <div className="st-side">{avatarOf(a, "md")}<GlassSelect className="st-side-select" value={a} options={plainOptions()} onChange={(v) => setVs({ a: v, b: v === b ? null : b })} ariaLabel="Người thứ nhất" /></div>
            <div className="st-big">{h ? <><span className="st-num st-pos">{h.w}</span><em>–</em><span className="st-num st-neg">{h.m - h.w}</span></> : <em>VS</em>}</div>
            <div className="st-side r">{avatarOf(b, "md")}<GlassSelect className="st-side-select" value={b} options={plainOptions().filter((o) => o.value !== a)} onChange={(v) => setVs({ a, b: v })} ariaLabel="Đối thủ" /></div>
          </div>
          {h ? <>
            <div className="st-split" aria-hidden="true"><span style={grow(grown, winRate(h) * 100)} /></div>
            <div className="st-grid-3 st-mini3">
              <Stat label="Lần gặp" small><span className="st-num">{h.m}</span></Stat>
              <Stat label="Điểm ghi–thua" small><span className="st-num">{h.pf}–{h.pa}</span></Stat>
              <Stat label="Sát nút" small><span className="st-num">{close}</span></Stat>
            </div>
            <MatchList matches={list} sideOf={(m) => (m.a.includes(a) ? "a" : "b")} nameOf={model.nameOf} />
          </> : <Empty>{model.nameOf(a)} và {model.nameOf(b)} chưa gặp nhau{rangeOk === "all" ? "" : " trong khoảng thời gian này"}.</Empty>}
        </div>
      </section>
      <section className="panel st-panel"><Head title={`Khắc tinh và con mồi của ${model.nameOf(a)}`} sub={`Chỉ tính đối thủ đã gặp từ ${MIN_MATCHES} lần.`} />
        <div className="st-body"><div className="st-grid-2">
          <PeopleCard title="Khắc tinh" sub={`Đối thủ ${model.nameOf(a)} thua nhiều hơn thắng`} rows={nemesis} none={`Không đối thủ nào thắng ${model.nameOf(a)} quá nửa số lần gặp.`} avatarOf={avatarOf} nameOf={model.nameOf} />
          <PeopleCard title="Con mồi" sub={`Đối thủ ${model.nameOf(a)} thắng nhiều hơn thua`} rows={prey} none={`${model.nameOf(a)} chưa thắng đối thủ nào quá nửa số lần gặp.`} avatarOf={avatarOf} nameOf={model.nameOf} />
        </div></div>
      </section>
      <section className="panel st-panel st-heat-block"><Head title="Bảng đối đầu" sub={`Hàng là người chơi, cột là đối thủ. Ô nhạt là dưới ${MIN_MATCHES} lần gặp.`} />
        <div className="st-body"><Heat ids={model.eloRank.map((m) => m.id)} get={(x, y) => h2h[x]?.[y]} none="chưa gặp" nameOf={model.nameOf} /></div>
      </section>
    </>;
  } else body = personId ? <Personal st={st} data={data} id={personId} compact={false} rangeLabel={rangeLabel} model={model} avatarOf={avatarOf} sessions={sessions} meId={me} onOpenMember={onOpenMember} filters={cardFilters} /> : null;

  return <>
    <PageHero eyebrow="THỐNG KÊ" title="Số liệu thi đấu của CLB" description="Ai đánh cặp hợp nhau, ai là khắc tinh của ai, phong độ ELO đi lên hay đi xuống. Số liệu tính từ các trận đã có tỉ số." statsLabel="Tóm tắt" stats={[{ label: "Trận đã tính", value: nf.format(st.n) }, { label: "Buổi", value: nf.format(sessions.length) }]} />
    <div className="st-toolbar">
      <Switch value={section} options={SECTIONS} onChange={(next) => { setSection(next); window.scrollTo({ top: 0 }); }} label="Mục thống kê" className="st-sections" />
      {tools}
    </div>
    {body}
  </>;
}

// ---------- One member's page (from Thành viên) ----------
export function MemberStatsPage({ data, error, meId, avatar, onOpenMember, memberId, backLabel, onBack }: Common & { memberId: string; backLabel: string; onBack: () => void }) {
  const model = useModel(data);
  const prefs = useMemo(() => (typeof window === "undefined" ? {} : readPrefs()), []);
  const [range, setRange] = useState(prefs.range ?? "3m");
  const [allMates, setAllMates] = useState(false);
  const [allOpps, setAllOpps] = useState(false);
  const grown = useGrown();
  const back = <button type="button" className="st-back" onClick={onBack}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>{backLabel}</button>;
  if (error) return <>{back}<Empty>{error}</Empty></>;
  if (!data || !model) return <>{back}<div className="st-loading" aria-busy="true">Đang tải số liệu…</div></>;
  const member = model.byId.get(memberId);
  if (!member) return <>{back}<Empty>Không tìm thấy thành viên này.</Empty></>;
  const rangeOk = model.rangeOptions.some((o) => o.value === range) ? range : "3m";
  const rangeLabel = model.rangeOptions.find((o) => o.value === rangeOk)?.label ?? "";
  const { matches, sessions } = inRange(data, rangeOk);
  const st = analyze(matches) as Stats;
  const avatarOf = (id: string, size: AvatarSize = "sm") => { const m = model.byId.get(id); return m ? avatar(m, size) : null; };
  const rank = model.eloRank.findIndex((m) => m.id === memberId) + 1;
  const delta = Math.round(eloChange(data.eloBySession, memberId, member.elo));
  const p = (st.person as Record<string, Tally>)[memberId];
  const partners = (Object.values(st.pair) as Pair[]).filter((q) => q.ids.includes(memberId)).map((q) => [q.ids.find((x) => x !== memberId) as string, q] as const).sort((x, y) => y[1].m - x[1].m || winRate(y[1]) - winRate(x[1]) || collator.compare(model.nameOf(x[0]), model.nameOf(y[0])));
  const opponents = Object.entries((st.h2h as Record<string, Record<string, Tally>>)[memberId] || {}).sort((x, y) => y[1].m - x[1].m || winRate(y[1]) - winRate(x[1]) || collator.compare(model.nameOf(x[0]), model.nameOf(y[0])));
  const recent = [...matches].filter((m) => m.a.includes(memberId) || m.b.includes(memberId)).sort((x, y) => (x.date === y.date ? y.no - x.no : x.date < y.date ? 1 : -1)).slice(0, 8);
  const rowsHead = (first: string) => <div className="st-rows-head four"><span>{first}</span><span>Trận</span><span>Thắng–thua</span><span>Tỉ lệ thắng</span><span>Hiệu số</span></div>;
  const personRow = ([pid, x]: readonly [string, Tally], key: string) => <button key={pid} type="button" className={"st-row" + (x.m < MIN_MATCHES ? " thin" : "")} onClick={() => onOpenMember(pid)}>
    <span className="st-who">{avatarOf(pid)}<b>{model.nameOf(pid)}</b></span>
    <span className="st-num"><em className="st-lbl">Trận</em>{x.m}</span>
    <span className="st-num"><em className="st-lbl">Kết quả</em>{wl(x)}</span>
    <span><em className="st-lbl">Tỉ lệ</em><span className="st-rate"><span className="st-num">{pct(winRate(x))}</span><span className="st-track"><span className={"st-fill" + (winRate(x) < 0.5 ? " low" : "")} style={grow(grown, winRate(x) * 100)} data-key={key} /></span></span></span>
    <span className={"st-num " + (pointDiff(x) >= 0 ? "st-pos" : "st-neg")}><em className="st-lbl">Hiệu số</em>{signed(pointDiff(x))}</span>
  </button>;
  return <>
    <div className="st-page-bar">{back}<div className="st-page-select"><GlassSelect value={rangeOk} options={model.rangeOptions} onChange={setRange} ariaLabel="Thời gian" /></div></div>
    <section className="panel page-hero st-member-hero">
      <div className="st-mh-who">{avatarOf(memberId, "xl")}<div>
        <p className="page-hero-eyebrow">THÀNH VIÊN</p>
        <h2>{member.name}</h2>
        <p className="st-mh-chips"><span className={`st-chip l${member.level}`}>Level {member.level}</span>{memberId === meId && <span className="st-chip me">Tôi</span>}</p>
      </div></div>
      <div className="page-hero-stats" style={{ "--hero-stat-count": 3 } as CSSProperties}>
        <div><span>ELO</span><b>{nf.format(Math.round(member.elo))}</b></div>
        <div><span>Hạng ELO</span><b>{rank ? `#${rank}` : "–"}</b></div>
        <div><span>4 tuần qua</span><b className={delta >= 0 ? "st-pos" : "st-neg"}>{signed(delta)}</b></div>
      </div>
    </section>
    <Personal st={st} data={data} id={memberId} compact rangeLabel={rangeLabel} model={model} avatarOf={avatarOf} sessions={sessions} meId={meId} onOpenMember={onOpenMember} />
    {p && <>
      <div className="st-cols even">
        <section className="panel st-panel"><Head title="Với từng đồng đội" sub="Mọi người đã đánh cùng đội. Bấm để mở trang của người đó." />
          <div className="st-body"><div className="st-rows four">{rowsHead("Đồng đội")}{(allMates ? partners : partners.slice(0, 5)).map((r) => personRow(r, "mate"))}</div>{partners.length > 5 && <button type="button" className="st-more" onClick={() => setAllMates(!allMates)}>{allMates ? "Thu gọn" : `Xem tất cả ${partners.length} đồng đội`}</button>}</div>
        </section>
        <section className="panel st-panel"><Head title="Với từng đối thủ" sub="Mọi người đã gặp ở đội bên kia." />
          <div className="st-body"><div className="st-rows four">{rowsHead("Đối thủ")}{(allOpps ? opponents : opponents.slice(0, 5)).map((r) => personRow(r, "opp"))}</div>{opponents.length > 5 && <button type="button" className="st-more" onClick={() => setAllOpps(!allOpps)}>{allOpps ? "Thu gọn" : `Xem tất cả ${opponents.length} đối thủ`}</button>}</div>
        </section>
      </div>
      <section className="panel st-panel"><Head title="Trận gần đây" sub={`${recent.length} trận gần nhất trong khoảng thời gian đã chọn.`} />
        <div className="st-body"><MatchList matches={recent} sideOf={(m) => (m.a.includes(memberId) ? "a" : "b")} nameOf={model.nameOf} /></div>
      </section>
    </>}
  </>;
}
