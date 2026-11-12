import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// The sign-in lasts for this tab. With site data blocked, reading sessionStorage throws; the session then lives in
// memory for the visit instead of breaking sign-in.
const memorySession = new Map<string, string>();
const browserSessionStorage = {
  getItem: (key: string) => { try { return typeof window === "undefined" ? null : window.sessionStorage.getItem(key); } catch { return memorySession.get(key) ?? null; } },
  setItem: (key: string, value: string) => { memorySession.set(key, value); try { if (typeof window !== "undefined") window.sessionStorage.setItem(key, value); } catch {} },
  removeItem: (key: string) => { memorySession.delete(key); try { if (typeof window !== "undefined") window.sessionStorage.removeItem(key); } catch {} },
};

export const supabase = url && anonKey ? createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storage: browserSessionStorage },
}) : null;

export function requireSupabase() {
  if (!supabase) throw new Error("Supabase chưa được cấu hình. Kiểm tra biến môi trường.");
  return supabase;
}
