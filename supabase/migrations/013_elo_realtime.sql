-- ELO: every open app sees a new ELO the moment it is written.
-- The app reloads the ELO ranking and the stats page when public.elo_ratings changes. 008 added the table to
-- the realtime publication, but only if the publication existed when 008 ran; this makes sure it is there.
-- Safe to run more than once. Run in the Supabase SQL Editor; the last statement lists the tables realtime
-- sends, and elo_ratings must be among them.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'elo_ratings') then
    alter publication supabase_realtime add table public.elo_ratings;
    raise notice 'elo_ratings added to supabase_realtime';
  else
    raise notice 'elo_ratings already in supabase_realtime (or no supabase_realtime publication)';
  end if;
end $$;

select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename;
