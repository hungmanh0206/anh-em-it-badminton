-- ELO ranking system for doubles matches.
-- Review/apply manually. Do not auto-apply this migration to production without approval.

create table if not exists public.elo_ratings (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  elo_rating numeric(10,4) not null default 1000,
  updated_at timestamptz not null default now()
);

create table if not exists public.elo_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  elo_before numeric(10,4) not null,
  elo_change numeric(10,4) not null,
  elo_after numeric(10,4) not null,
  created_at timestamptz not null default now(),
  unique(match_id, member_id)
);

create table if not exists public.elo_monthly_snapshots (
  period date not null,
  member_id uuid not null references public.profiles(id) on delete cascade,
  elo_rating numeric(10,4) not null,
  rank integer not null,
  level public.member_level not null,
  created_at timestamptz not null default now(),
  primary key(period, member_id)
);

create index if not exists elo_ratings_rating_idx on public.elo_ratings (elo_rating desc, member_id asc);
create index if not exists elo_history_member_created_idx on public.elo_history (member_id, created_at desc);
create index if not exists elo_history_match_idx on public.elo_history (match_id);
create index if not exists elo_monthly_snapshots_period_rank_idx on public.elo_monthly_snapshots (period, rank);

alter table public.elo_ratings enable row level security;
alter table public.elo_history enable row level security;
alter table public.elo_monthly_snapshots enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'elo_ratings' and policyname = 'elo ratings are readable') then
    create policy "elo ratings are readable" on public.elo_ratings for select to authenticated using (true);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'elo_history' and policyname = 'elo history is readable') then
    create policy "elo history is readable" on public.elo_history for select to authenticated using (true);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'elo_monthly_snapshots' and policyname = 'elo monthly snapshots are readable') then
    create policy "elo monthly snapshots are readable" on public.elo_monthly_snapshots for select to authenticated using (true);
  end if;
end $$;

create or replace function public.recalculate_elo_from_matches()
returns table(processed_matches integer, player_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_member_id uuid;
  v_unique_count integer;
  v_rating_count integer;
  v_avg_a numeric;
  v_avg_b numeric;
  v_expected_a numeric;
  v_expected_b numeric;
  v_delta_a numeric;
  v_delta_b numeric;
  v_before numeric;
  v_after numeric;
  v_winner_a boolean;
  v_processed integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('aemit_elo_rebuild'));

  insert into public.elo_ratings(member_id, elo_rating, updated_at)
  select id, 1000, now()
    from public.profiles
  on conflict (member_id)
  do update set elo_rating = excluded.elo_rating, updated_at = excluded.updated_at;

  delete from public.elo_ratings r
   where not exists (select 1 from public.profiles p where p.id = r.member_id);

  delete from public.elo_history;

  for v_match in
    select m.id, ps.session_date, m.match_no, m.team_a, m.team_b, m.score_a, m.score_b
      from public.matches m
      join public.play_sessions ps on ps.id = m.session_id
     where m.score_a is not null
       and m.score_b is not null
       and m.score_a <> m.score_b
       and ps.status in ('scheduled', 'completed')
     order by ps.session_date asc, m.match_no asc, m.id asc
  loop
    if coalesce(array_length(v_match.team_a, 1), 0) <> 2 or coalesce(array_length(v_match.team_b, 1), 0) <> 2 then
      raise exception 'Invalid ELO teams for match %', v_match.id;
    end if;

    select count(distinct member_id)
      into v_unique_count
      from unnest(v_match.team_a || v_match.team_b) as ids(member_id);
    if v_unique_count <> 4 then
      raise exception 'Duplicate player in ELO match %', v_match.id;
    end if;

    insert into public.elo_ratings(member_id, elo_rating, updated_at)
    select ids.member_id, 1000, now()
      from unnest(v_match.team_a || v_match.team_b) as ids(member_id)
      join public.profiles p on p.id = ids.member_id
    on conflict (member_id) do nothing;

    select count(*)
      into v_rating_count
      from public.elo_ratings
     where member_id = any(v_match.team_a || v_match.team_b);
    if v_rating_count <> 4 then
      raise exception 'Unknown player in ELO match %', v_match.id;
    end if;

    select avg(elo_rating) into v_avg_a from public.elo_ratings where member_id = any(v_match.team_a);
    select avg(elo_rating) into v_avg_b from public.elo_ratings where member_id = any(v_match.team_b);

    v_expected_a := 1 / (1 + power(10, ((v_avg_b - v_avg_a) / 400.0)));
    v_expected_b := 1 - v_expected_a;
    v_winner_a := v_match.score_a > v_match.score_b;
    v_delta_a := 32.0 * ((case when v_winner_a then 1.0 else 0.0 end) - v_expected_a);
    v_delta_b := 32.0 * ((case when v_winner_a then 0.0 else 1.0 end) - v_expected_b);

    foreach v_member_id in array v_match.team_a loop
      select elo_rating into v_before from public.elo_ratings where member_id = v_member_id for update;
      v_after := v_before + v_delta_a;
      update public.elo_ratings set elo_rating = v_after, updated_at = now() where member_id = v_member_id;
      insert into public.elo_history(member_id, match_id, elo_before, elo_change, elo_after)
      values (v_member_id, v_match.id, v_before, v_delta_a, v_after);
    end loop;

    foreach v_member_id in array v_match.team_b loop
      select elo_rating into v_before from public.elo_ratings where member_id = v_member_id for update;
      v_after := v_before + v_delta_b;
      update public.elo_ratings set elo_rating = v_after, updated_at = now() where member_id = v_member_id;
      insert into public.elo_history(member_id, match_id, elo_before, elo_change, elo_after)
      values (v_member_id, v_match.id, v_before, v_delta_b, v_after);
    end loop;

    v_processed := v_processed + 1;
  end loop;

  with ranked_levels as (
    select p.id as member_id,
           row_number() over (order by r.elo_rating desc, r.member_id asc) as position
      from public.profiles p
      join public.elo_ratings r on r.member_id = p.id
     where p.is_active
  )
  update public.profiles p
     set level = case when ranked_levels.position <= 4 then '1'::public.member_level else '2'::public.member_level end,
         updated_at = now()
    from ranked_levels
   where p.id = ranked_levels.member_id;
  processed_matches := v_processed;
  select count(*) into player_count from public.elo_ratings;
  return next;
end;
$$;

create or replace function public.snapshot_elo_month(p_month date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.elo_monthly_snapshots(period, member_id, elo_rating, rank, level, created_at)
  select date_trunc('month', p_month)::date,
         ranked.member_id,
         ranked.elo_rating,
         ranked.position,
         case when ranked.position <= 4 then '1'::public.member_level else '2'::public.member_level end,
         now()
    from (
      select r.member_id,
             r.elo_rating,
             row_number() over (order by r.elo_rating desc, r.member_id asc) as position
        from public.elo_ratings r
        join public.profiles p on p.id = r.member_id
       where p.is_active
    ) ranked
  on conflict (period, member_id)
  do update set elo_rating = excluded.elo_rating,
                rank = excluded.rank,
                level = excluded.level,
                created_at = excluded.created_at;
end;
$$;


create or replace function public.apply_next_month_levels(p_month date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only an administrator can finalize monthly levels';
  end if;

  with ranked as (
    select p.id as member_id,
           row_number() over (
             order by coalesce(r.elo_rating, 1000) desc, p.id asc
           ) as position
      from public.profiles p
      left join public.elo_ratings r on r.member_id = p.id
     where p.is_active
  ), assigned as (
    update public.monthly_results mr
       set level_next_month = case when ranked.position <= 4 then '1'::public.member_level else '2'::public.member_level end
      from ranked
     where mr.month = date_trunc('month', p_month)::date
       and mr.member_id = ranked.member_id
    returning mr.member_id, mr.level_next_month
  )
  update public.profiles p
     set level = assigned.level_next_month
    from assigned
   where p.id = assigned.member_id;
end;
$$;
revoke all on function public.recalculate_elo_from_matches() from public;
revoke all on function public.snapshot_elo_month(date) from public;
revoke all on function public.apply_next_month_levels(date) from public;
grant execute on function public.recalculate_elo_from_matches() to service_role;
grant execute on function public.snapshot_elo_month(date) to service_role;
grant execute on function public.apply_next_month_levels(date) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'elo_ratings') then
    alter publication supabase_realtime add table public.elo_ratings;
  end if;
end $$;

/*
Manual rollback plan:

drop function if exists public.snapshot_elo_month(date);
drop function if exists public.recalculate_elo_from_matches();
-- Re-apply supabase/migrations/002_apply_monthly_levels.sql if the old BXH-based level function is required.
drop table if exists public.elo_monthly_snapshots;
drop table if exists public.elo_history;
drop table if exists public.elo_ratings;
*/
