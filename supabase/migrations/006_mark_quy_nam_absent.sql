-- Current session correction requested by the club admin.
with latest_session as (
  select id from public.play_sessions order by session_date desc limit 1
)
insert into public.attendances(session_id, member_id, choice, level_at_time, responded_at)
select latest_session.id, profiles.id, 'absent', profiles.level, now()
from latest_session
join public.profiles on profiles.username in ('quy', 'nam')
on conflict (session_id, member_id) do update
set choice = 'absent', level_at_time = excluded.level_at_time, responded_at = now();
