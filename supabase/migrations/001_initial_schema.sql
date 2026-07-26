-- Anh Em IT Badminton Club: PostgreSQL schema for Supabase
create type public.member_role as enum ('admin', 'member');
create type public.member_level as enum ('1', '2');
create type public.session_status as enum ('draft', 'checked_in', 'drawn', 'scheduled', 'completed');
create type public.attendance_choice as enum ('pending', 'attending', 'absent');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text unique not null,
  avatar_url text,
  description text,
  level public.member_level not null default '2',
  role public.member_role not null default 'member',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.play_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date unique not null,
  status public.session_status not null default 'draft',
  attendance_confirmed_at timestamptz,
  draw_open_at timestamptz,
  schedule_mode text check (schedule_mode in ('level_based', 'generic')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.attendances (
  session_id uuid not null references public.play_sessions(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  choice public.attendance_choice not null default 'pending',
  level_at_time public.member_level,
  responded_at timestamptz,
  drawn_number integer,
  primary key (session_id, member_id),
  unique(session_id, drawn_number)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.play_sessions(id) on delete cascade,
  match_no integer not null,
  match_type text,
  team_a uuid[] not null,
  team_b uuid[] not null,
  score_a integer,
  score_b integer,
  unique(session_id, match_no)
);

create table public.monthly_results (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  member_id uuid not null references public.profiles(id),
  rank integer not null,
  total_points integer not null,
  points_for integer not null,
  points_against integer not null,
  point_diff integer not null,
  matches_played integer not null,
  level_next_month public.member_level not null,
  reward text,
  created_at timestamptz not null default now(),
  unique(month, member_id)
);

-- Called by a member when they choose attendance. No other member can be changed.
create or replace function public.respond_attendance(p_session_id uuid, p_choice public.attendance_choice)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.attendances
  set choice = p_choice,
      responded_at = now(),
      level_at_time = (select level from public.profiles where id = auth.uid())
  where session_id = p_session_id and member_id = auth.uid();
  if not found then raise exception 'Attendance record not found'; end if;
end; $$;

-- Row locking makes simultaneous draws collision-free across devices.
create or replace function public.claim_draw_slot(p_session_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_level public.member_level; v_slot integer; v_status public.session_status;
begin
  select status into v_status from public.play_sessions where id = p_session_id for update;
  if v_status <> 'checked_in' then raise exception 'Draw is not open'; end if;
  select level into v_level from public.profiles where id = auth.uid();
  select drawn_number into v_slot from public.attendances where session_id = p_session_id and member_id = auth.uid() for update;
  if v_slot is not null then return v_slot; end if;
  select candidate into v_slot from (
    select n as candidate from generate_series(case when v_level = '1' then 1 else 5 end, case when v_level = '1' then 4 else 10 end) n
    where not exists (select 1 from public.attendances a where a.session_id = p_session_id and a.drawn_number = n)
    order by random() limit 1
  ) available;
  if v_slot is null then raise exception 'No slot available'; end if;
  update public.attendances set drawn_number = v_slot where session_id = p_session_id and member_id = auth.uid();
  return v_slot;
end; $$;

-- Admin can unlock the draw only after every active member has answered.
create or replace function public.confirm_attendance(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then raise exception 'Admin only'; end if;
  if exists (
    select 1 from public.attendances a join public.profiles p on p.id = a.member_id
    where a.session_id = p_session_id and p.is_active and a.choice = 'pending'
  ) then raise exception 'All active members must respond first'; end if;
  update public.play_sessions set status = 'checked_in', attendance_confirmed_at = now(), draw_open_at = now()
  where id = p_session_id and status = 'draft';
end; $$;

alter table public.profiles enable row level security;
alter table public.play_sessions enable row level security;
alter table public.attendances enable row level security;
alter table public.matches enable row level security;
alter table public.monthly_results enable row level security;

create policy "active profiles are readable" on public.profiles for select to authenticated using (is_active);
create policy "sessions are readable" on public.play_sessions for select to authenticated using (true);
create policy "attendance is readable" on public.attendances for select to authenticated using (true);
create policy "members update only their attendance" on public.attendances for update to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy "matches are readable" on public.matches for select to authenticated using (true);
create policy "monthly results are readable" on public.monthly_results for select to authenticated using (true);

-- Enable realtime updates for the live attendance board.
alter publication supabase_realtime add table public.attendances;
alter publication supabase_realtime add table public.play_sessions;
