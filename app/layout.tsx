import type { Metadata } from "next";
import "./globals.css";
import "./overrides.css";
import "./member-actions.css";
import "./responsive-overlays.css";
import "./welcome-banner.css";
import "./club-design-system.css";
import "./schedule-library.css";
import "./sidebar-polish.css";
import "./mobile-ranking.css";
import "./checkin-polish.css";
import "./ranking-podium.css";
import "./tablet-header.css";
import "./home-hero.css";
import "./rules-page.css";

export const metadata: Metadata = {
  title: "Anh Em IT — Quản lý CLB Cầu lông",
  description: "Quản lý buổi chơi, lịch đấu và bảng xếp hạng CLB Anh Em IT.",
  manifest: "/site.webmanifest?v=sapp-badminton-icons",
  icons: {
    icon: [
      { url: "/favicon.ico?v=sapp-badminton-icons", sizes: "any" },
      { url: "/favicon.svg?v=sapp-badminton-icons", type: "image/svg+xml" },
      { url: "/icon-32.png?v=sapp-badminton-icons", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png?v=sapp-badminton-icons", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=sapp-badminton-icons",
    apple: [
      { url: "/apple-touch-icon.png?v=sapp-badminton-icons", sizes: "180x180", type: "image/png" },
    ],
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
