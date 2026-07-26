-- A member can revise attendance at any time. Once drawing/scheduling has begun,
-- the revision is queued for the admin to acknowledge and reset that workflow.
create table if not exists public.attendance_change_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.play_sessions(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  previous_choice public.attendance_choice not null,
  requested_choice public.attendance_choice not null,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.attendance_change_requests enable row level security;
create policy "attendance change requests are readable" on public.attendance_change_requests for select to authenticated using (true);

create or replace function public.change_my_attendance(p_session_id uuid, p_choice public.attendance_choice)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_previous public.attendance_choice; v_status public.session_status;
begin
  select choice into v_previous from public.attendances where session_id = p_session_id and member_id = auth.uid() for update;
  if v_previous is null then raise exception 'Attendance record not found'; end if;
  select status into v_status from public.play_sessions where id = p_session_id for update;
  update public.attendances set choice = p_choice, responded_at = now() where session_id = p_session_id and member_id = auth.uid();
  if v_status in ('drawn', 'scheduled') and v_previous <> p_choice then
    insert into public.attendance_change_requests(session_id, member_id, previous_choice, requested_choice)
    values (p_session_id, auth.uid(), v_previous, p_choice);
    return true;
  end if;
  return false;
end; $$;

create or replace function public.reset_session_after_attendance_change(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then raise exception 'Admin only'; end if;
  delete from public.matches where session_id = p_session_id;
  update public.attendances set drawn_number = null where session_id = p_session_id;
  update public.play_sessions set status = 'draft', attendance_confirmed_at = null, draw_open_at = null where id = p_session_id;
  update public.attendance_change_requests set status = 'resolved', resolved_at = now() where session_id = p_session_id and status = 'pending';
end; $$;

alter publication supabase_realtime add table public.attendance_change_requests;
