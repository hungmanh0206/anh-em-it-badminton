import type { Metadata } from "next";
import "./globals.css";
import "./overrides.css";
import "./member-actions.css";
import "./responsive-overlays.css";
import "./welcome-banner.css";
import "./club-design-system.css";
import "./schedule-library.css";
import "./sidebar-polish.css";

export const metadata: Metadata = {
  title: "Anh Em IT — Quản lý CLB Cầu lông",
  description: "Quản lý buổi chơi, lịch đấu và bảng xếp hạng CLB Anh Em IT.",
  icons: {
    icon: "/favicon.svg?v=team-logo",
    shortcut: "/favicon.svg?v=team-logo",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
