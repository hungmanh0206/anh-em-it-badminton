"use client";

import { type ReactNode, useEffect, useState } from "react";

// Dismisses on click (not pointerdown) so the tap is consumed by the backdrop instead of reaching
// whatever sits under it once the modal closes; the tap must also start on the backdrop itself.
export function backdropDismissProps(onDismiss: () => void) {
  return {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => { event.currentTarget.dataset.pointerDownOnBackdrop = String(event.target === event.currentTarget); },
    onClick: (event: React.MouseEvent<HTMLDivElement>) => {
      const startedOnBackdrop = event.currentTarget.dataset.pointerDownOnBackdrop !== "false";
      delete event.currentTarget.dataset.pointerDownOnBackdrop;
      if (startedOnBackdrop && event.target === event.currentTarget) onDismiss();
    },
  };
}

// Keeps the last visible content mounted while it plays its exit animation (see motion.css).
export function Presence({ show, children }: { show: boolean; children: ReactNode }) {
  const [lastChildren, setLastChildren] = useState(children);
  const [wasShown, setWasShown] = useState(show);
  const [leaving, setLeaving] = useState(false);
  if (show && lastChildren !== children) setLastChildren(children);
  if (show !== wasShown) {
    setWasShown(show);
    setLeaving(!show);
  }
  // Fallback in case the exit animation is disabled or never reports animationend.
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), 400);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  if (!show && !leaving) return null;
  return <div
    className={leaving ? "presence presence-leaving" : "presence"}
    onAnimationEnd={(event) => { if (leaving && event.target === event.currentTarget.firstElementChild) setLeaving(false); }}
  >{show ? children : lastChildren}</div>;
}
