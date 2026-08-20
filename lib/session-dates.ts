export type RescheduledSession = {
  originalDate: string;
  sessionDate: string;
  activeFrom: string;
  activeUntil: string;
  checkinOpenFrom: string;
  checkinOpenUntil: string;
};

export const rescheduledSessions: RescheduledSession[] = [
  {
    originalDate: "2026-08-22",
    sessionDate: "2026-08-23",
    activeFrom: "2026-08-17",
    activeUntil: "2026-08-23",
    checkinOpenFrom: "2026-08-19",
    checkinOpenUntil: "2026-08-23",
  },
];

export const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const dateFromKey = (key: string) => new Date(`${key}T00:00:00`);

export const normalizeSessionDateKey = (key: string) =>
  rescheduledSessions.find((session) => session.originalDate === key)?.sessionDate ?? key;

export const rescheduledOriginalDateKey = (key: string) =>
  rescheduledSessions.find((session) => session.sessionDate === key)?.originalDate ?? null;

export const targetSessionDateKey = (now: Date) => {
  const today = dateKey(now);
  const rescheduled = rescheduledSessions.find((session) => today >= session.activeFrom && today <= session.activeUntil);
  if (rescheduled) return rescheduled.sessionDate;

  const date = new Date(now);
  date.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7));
  return normalizeSessionDateKey(dateKey(date));
};

export const isCheckinWindowOpenForDate = (now: Date) => {
  const today = dateKey(now);
  const rescheduled = rescheduledSessions.find((session) => today >= session.checkinOpenFrom && today <= session.checkinOpenUntil);
  if (rescheduled) return true;

  const day = now.getDay();
  return day >= 3 && day <= 6;
};

export const sessionStateForDate = (now: Date) => {
  const today = dateKey(now);
  const sessionDate = targetSessionDateKey(now);
  if (today === sessionDate) return "ĐANG DIỄN RA";
  return isCheckinWindowOpenForDate(now) ? "CHƯA DIỄN RA" : "CHỜ THỨ TƯ";
};

export const sessionDatesOfMonth = (date: Date) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const dates: Date[] = [];
  for (let day = new Date(year, month, 1); day.getMonth() === month; day.setDate(day.getDate() + 1)) {
    if (day.getDay() === 6) dates.push(new Date(day));
  }

  return dates
    .map((sessionDate) => dateFromKey(normalizeSessionDateKey(dateKey(sessionDate))))
    .filter((sessionDate) => sessionDate.getMonth() === month)
    .sort((a, b) => a.getTime() - b.getTime());
};

export const sessionWeekdayLabel = (date: Date) => {
  if (date.getDay() === 0) return "Chủ nhật";
  if (date.getDay() === 6) return "Thứ 7";
  return date.toLocaleDateString("vi-VN", { weekday: "long" });
};

export const sessionWeekInMonth = (date: Date) => Math.floor((date.getDate() - 1) / 7) + 1;
