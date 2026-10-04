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
import "./result-entry-responsive.css";
import "./flow-responsive.css";
import "./mobile-landscape.css";
import "./draw-wheel-polish.css";
import "./profile-popover-spacing.css";
import "./member-role.css";
import "./brand-logo.css";
import "./app-icons.css";
import "./attendance-mark-classic.css";
import "./sidebar-profile-compact.css";
import "./ranking-table-fix.css";
import "./ranking-spacing-16.css";
import "./elo-ranking.css";
import "./welcome-chip-polish.css";
import "./checkin-modal-clean.css";
import "./ranking-medal-icons.css";
import "./ranking-single-card.css";
import "./ranking-table-header.css";
import "./history-polish.css";
import "./elo-guide.css";
import "./modal-close.css";
import "./photos.css";
import "./motion.css";

export const metadata: Metadata = {
  title: "Anh Em IT — Quản lý CLB Cầu lông",
  description: "Quản lý buổi chơi, lịch đấu và bảng xếp hạng CLB Anh Em IT.",
  manifest: "/site.webmanifest?v=club-glass-logo-v2",
  icons: {
    icon: [
      { url: "/favicon.ico?v=club-glass-logo-v2", sizes: "any" },
      { url: "/icon-32.png?v=club-glass-logo-v2", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png?v=club-glass-logo-v2", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=club-glass-logo-v2",
    apple: [
      { url: "/apple-touch-icon.png?v=club-glass-logo-v2", sizes: "180x180", type: "image/png" },
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




