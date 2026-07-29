import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const browserSessionStorage = {
  getItem: (key: string) => typeof window === "undefined" ? null : window.sessionStorage.getItem(key),
  setItem: (key: string, value: string) => { if (typeof window !== "undefined") window.sessionStorage.setItem(key, value); },
  removeItem: (key: string) => { if (typeof window !== "undefined") window.sessionStorage.removeItem(key); },
};

export const supabase = url && anonKey ? createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storage: browserSessionStorage },
}) : null;

export function requireSupabase() {
  if (!supabase) throw new Error("Supabase chưa được cấu hình. Kiểm tra biến môi trường.");
  return supabase;
}
