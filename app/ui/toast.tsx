"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ToastKind = "error" | "success";
type ToastState = { message: string; kind: ToastKind };

// One toast at a time: a new message replaces the current one and restarts its timer.
export function useToast(durationMs = 3500) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | null>(null);
  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const dismissToast = useCallback(() => {
    clearTimer();
    setToast(null);
  }, []);
  const showToast = useCallback((message: string, kind: ToastKind = "error") => {
    clearTimer();
    setToast({ message, kind });
    timer.current = window.setTimeout(() => setToast(null), durationMs);
  }, [durationMs]);
  useEffect(() => clearTimer, []);
  return { toast, showToast, dismissToast };
}

// Rendered on <body> so panels with overflow or transforms cannot clip or shift it.
export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null;
  return createPortal(<div className={`app-toast app-toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
    <span className="app-toast-icon" aria-hidden="true">{toast.kind === "error" ? "!" : "✓"}</span>
    <p>{toast.message}</p>
    <button type="button" onClick={onClose} aria-label="Đóng thông báo">×</button>
  </div>, document.body);
}
