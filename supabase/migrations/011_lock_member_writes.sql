-- Members change attendance and draw numbers only through the app's server (/api/checkin, /api/draw-slot), which checks
-- the check-in window, the session, the headcount and saved scores. Until now a member could skip those checks with the
-- public key and their own sign-in: update their attendance row directly (drawn_number, level_at_time, choice) or call
-- the old attendance functions, which every signed-in user may execute by default.
-- The app itself never does either from the browser (all those writes go through the server's service role), so this
-- changes nothing for normal use. Review before running it in the Supabase SQL editor.

drop policy if exists "members update only their attendance" on public.attendances;

revoke execute on function public.respond_attendance(uuid, public.attendance_choice) from public, anon, authenticated;
revoke execute on function public.claim_draw_slot(uuid) from public, anon, authenticated;
revoke execute on function public.change_my_attendance(uuid, public.attendance_choice) from public, anon, authenticated;
revoke execute on function public.ensure_weekly_session(date) from public, anon, authenticated;

grant execute on function public.respond_attendance(uuid, public.attendance_choice) to service_role;
grant execute on function public.claim_draw_slot(uuid) to service_role;
grant execute on function public.change_my_attendance(uuid, public.attendance_choice) to service_role;
grant execute on function public.ensure_weekly_session(date) to service_role;
