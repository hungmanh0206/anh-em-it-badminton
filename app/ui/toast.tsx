"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// One warning toast at a time: a new message replaces the current one and restarts its timer.
export function useToast(durationMs = 3500) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const dismiss = useCallback(() => {
    clearTimer();
    setMessage(null);
  }, []);
  const showToast = useCallback((next: string) => {
    clearTimer();
    setMessage(next);
    timer.current = window.setTimeout(() => setMessage(null), durationMs);
  }, [durationMs]);
  useEffect(() => clearTimer, []);
  return { toastMessage: message, showToast, dismissToast: dismiss };
}

// Rendered on <body> so panels with overflow or transforms cannot clip or shift it.
export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return createPortal(<div className="app-toast" role="alert">
    <span className="app-toast-icon" aria-hidden="true">!</span>
    <p>{message}</p>
    <button type="button" onClick={onClose} aria-label="Đóng thông báo">×</button>
  </div>, document.body);
}
