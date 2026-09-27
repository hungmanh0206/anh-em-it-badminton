-- ELO: zero-sum split inside each team, for matches from 2026-09-27 onward.
-- Requires 008_elo_ranking.sql. Review manually before applying; do not auto-apply to production.
--
-- Mirrors lib/elo/calculate-elo.js (ELO_SPLIT_GAP = 2000, ELO_SPLIT_FROM_DATE = 2026-09-27):
--   * Matches before 2026-09-27 keep the original rule (both partners get the same delta),
--     so every existing rating stays exactly as it is.
--   * From 2026-09-27: the team total is 2 * K * (1 - expected of the winning team), rounded once
--     to 0.1. The winning team gains exactly that total and the losing team loses exactly that total.
--     Inside each team the total is split with strength = min(1, partner gap / 2000):
--     winners -> lower-rated partner gets more, losers -> higher-rated partner loses more.
--     The partner with the larger fractional part rounds up, the other takes the remainder.
--
-- Rollback: re-run the recalculate_elo_from_matches() definition from 008_elo_ranking.sql.

create or replace function public.elo_split_team_tenths(
  p_rating_1 numeric,
  p_rating_2 numeric,
  p_opponent_average numeric,
  p_won boolean,
  p_total_tenths integer,
  p_split_gap numeric default 2000
)
returns integer[]
language plpgsql
immutable
as $$
declare
  v_e1 numeric := 1 / (1 + power(10::numeric, (p_opponent_average - p_rating_1) / 400.0));
  v_e2 numeric := 1 / (1 + power(10::numeric, (p_opponent_average - p_rating_2) / 400.0));
  v_w1 numeric;
  v_w2 numeric;
  v_strength numeric := least(1, abs(p_rating_1 - p_rating_2) / p_split_gap);
  v_exact_1 numeric;
  v_exact_2 numeric;
  v_first integer;
begin
  v_w1 := case when p_won then 1 - v_e1 else v_e1 end;
  v_w2 := case when p_won then 1 - v_e2 else v_e2 end;
  v_exact_1 := p_total_tenths * (v_strength * (v_w1 / (v_w1 + v_w2)) + (1 - v_strength) * 0.5);
  v_exact_2 := p_total_tenths * (v_strength * (v_w2 / (v_w1 + v_w2)) + (1 - v_strength) * 0.5);
  if v_exact_1 - floor(v_exact_1) >= v_exact_2 - floor(v_exact_2) then
    v_first := ceil(v_exact_1);
    return array[v_first, p_total_tenths - v_first];
  end if;
  v_first := ceil(v_exact_2);
  return array[p_total_tenths - v_first, v_first];
end;
$$;

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
  v_split_from date := date '2026-09-27';
  v_total_tenths integer;
  v_ratings_a numeric[];
  v_ratings_b numeric[];
  v_tenths_a integer[];
  v_tenths_b integer[];
  v_deltas_a numeric[];
  v_deltas_b numeric[];
  v_index integer;
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

    select array_agg(r.elo_rating order by t.ord) into v_ratings_a
      from unnest(v_match.team_a) with ordinality as t(member_id, ord)
      join public.elo_ratings r on r.member_id = t.member_id;
    select array_agg(r.elo_rating order by t.ord) into v_ratings_b
      from unnest(v_match.team_b) with ordinality as t(member_id, ord)
      join public.elo_ratings r on r.member_id = t.member_id;

    v_avg_a := (v_ratings_a[1] + v_ratings_a[2]) / 2;
    v_avg_b := (v_ratings_b[1] + v_ratings_b[2]) / 2;
    v_expected_a := 1 / (1 + power(10, ((v_avg_b - v_avg_a) / 400.0)));
    v_expected_b := 1 - v_expected_a;
    v_winner_a := v_match.score_a > v_match.score_b;

    if v_match.session_date < v_split_from then
      -- Original rule: both partners get the same delta.
      v_delta_a := 32.0 * ((case when v_winner_a then 1.0 else 0.0 end) - v_expected_a);
      v_delta_b := 32.0 * ((case when v_winner_a then 0.0 else 1.0 end) - v_expected_b);
      v_deltas_a := array[v_delta_a, v_delta_a];
      v_deltas_b := array[v_delta_b, v_delta_b];
    else
      v_total_tenths := round(2 * 32.0 * (1 - (case when v_winner_a then v_expected_a else v_expected_b end)) * 10);
      v_tenths_a := public.elo_split_team_tenths(v_ratings_a[1], v_ratings_a[2], v_avg_b, v_winner_a, v_total_tenths);
      v_tenths_b := public.elo_split_team_tenths(v_ratings_b[1], v_ratings_b[2], v_avg_a, not v_winner_a, v_total_tenths);
      v_deltas_a := array[
        (case when v_winner_a then 1 else -1 end) * v_tenths_a[1] / 10.0,
        (case when v_winner_a then 1 else -1 end) * v_tenths_a[2] / 10.0
      ];
      v_deltas_b := array[
        (case when v_winner_a then -1 else 1 end) * v_tenths_b[1] / 10.0,
        (case when v_winner_a then -1 else 1 end) * v_tenths_b[2] / 10.0
      ];
    end if;

    for v_index in 1..2 loop
      v_member_id := v_match.team_a[v_index];
      select elo_rating into v_before from public.elo_ratings where member_id = v_member_id for update;
      v_after := v_before + v_deltas_a[v_index];
      update public.elo_ratings set elo_rating = v_after, updated_at = now() where member_id = v_member_id;
      insert into public.elo_history(member_id, match_id, elo_before, elo_change, elo_after)
      values (v_member_id, v_match.id, v_before, v_deltas_a[v_index], v_after);
    end loop;

    for v_index in 1..2 loop
      v_member_id := v_match.team_b[v_index];
      select elo_rating into v_before from public.elo_ratings where member_id = v_member_id for update;
      v_after := v_before + v_deltas_b[v_index];
      update public.elo_ratings set elo_rating = v_after, updated_at = now() where member_id = v_member_id;
      insert into public.elo_history(member_id, match_id, elo_before, elo_change, elo_after)
      values (v_member_id, v_match.id, v_before, v_deltas_b[v_index], v_after);
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

revoke all on function public.elo_split_team_tenths(numeric, numeric, numeric, boolean, integer, numeric) from public;
revoke all on function public.recalculate_elo_from_matches() from public;
grant execute on function public.recalculate_elo_from_matches() to service_role;
