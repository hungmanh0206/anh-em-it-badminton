-- Members change attendance and draw numbers only through the app's server (/api/checkin, /api/draw-slot), which checks
-- the check-in window, the session, the headcount and saved scores. Until now a member could skip those checks with the
-- public key and their own sign-in: update their attendance row directly (drawn_number, level_at_time, choice) or call
-- the old attendance functions, which every signed-in user may execute by default.
-- The app itself never does either from the browser (all those writes go through the server's service role), so this
-- changes nothing for normal use. Safe to run more than once, and functions that do not exist are skipped.

drop policy if exists "members update only their attendance" on public.attendances;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.respond_attendance(uuid, public.attendance_choice)',
    'public.claim_draw_slot(uuid)',
    'public.change_my_attendance(uuid, public.attendance_choice)',
    'public.ensure_weekly_session(date)'
  ] loop
    begin
      if to_regprocedure(fn) is not null then
        execute format('revoke execute on function %s from public, anon, authenticated', fn);
        execute format('grant execute on function %s to service_role', fn);
        raise notice 'locked %', fn;
      else
        raise notice 'skipped % (not in this database)', fn;
      end if;
    exception when others then
      -- An argument type missing from this database means the function is not here either.
      raise notice 'skipped % (%)', fn, sqlerrm;
    end;
  end loop;
end $$;
