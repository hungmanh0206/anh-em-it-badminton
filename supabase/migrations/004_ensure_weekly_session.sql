-- Creates the active Saturday session only when the attendance window is open.
-- All active members receive a pending attendance row immediately.
create or replace function public.ensure_weekly_session(p_session_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_session_id uuid;
  v_status public.session_status;
  v_today date := timezone('Asia/Ho_Chi_Minh', now())::date;
  v_next_saturday date;
  v_dow integer := extract(dow from timezone('Asia/Ho_Chi_Minh', now()))::integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select id, status into v_session_id, v_status
  from public.play_sessions where session_date = p_session_date;
  if found then return v_session_id; end if;

  v_next_saturday := v_today + ((6 - v_dow + 7) % 7);
  if v_dow not between 3 and 6 or p_session_date <> v_next_saturday then
    raise exception 'A new weekly session can only be opened from Wednesday through Saturday';
  end if;

  insert into public.play_sessions(session_date, created_by)
  values (p_session_date, auth.uid())
  on conflict (session_date) do update set session_date = excluded.session_date
  returning id into v_session_id;

  insert into public.attendances(session_id, member_id, choice, level_at_time)
  select v_session_id, id, 'pending', level
  from public.profiles where is_active
  on conflict (session_id, member_id) do nothing;

  return v_session_id;
end; $$;
