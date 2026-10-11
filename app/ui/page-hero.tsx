import type { CSSProperties, ReactNode } from "react";

export type PageHeroStat = { label: string; value: ReactNode };

// Shared hero for every screen except the home page: eyebrow, title, one line of context and
// optional stat cards. Styles live in app/page-hero.css.
export function PageHero({ eyebrow, title, description, stats = [], statsLabel }: { eyebrow: string; title: string; description?: ReactNode; stats?: PageHeroStat[]; statsLabel?: string }) {
  return <section className="panel page-hero">
    <div className="page-hero-copy">
      <p className="page-hero-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {description && <p className="page-hero-text">{description}</p>}
    </div>
    {stats.length > 0 && <div className="page-hero-stats" aria-label={statsLabel} style={{ "--hero-stat-count": stats.length } as CSSProperties}>
      {stats.map((stat) => <div key={stat.label}><span>{stat.label}</span><b>{stat.value}</b></div>)}
    </div>}
  </section>;
}
