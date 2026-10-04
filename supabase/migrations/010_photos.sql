-- Photo gallery metadata. Cloudinary is the source of truth for the images themselves;
-- this table is only an index/cache the app can filter, sort and paginate.
-- No image binary is stored in Supabase.
-- Review manually before applying (Supabase SQL editor); do not auto-apply to production.
--
-- Rollback:
--   drop view if exists public.photo_folders;
--   drop table if exists public.photos;

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  -- Stable Cloudinary identifier: survives renames/moves, so it is the dedupe key.
  cloudinary_asset_id text not null unique,
  public_id text not null,
  version bigint,
  -- Asset folder relative to CLOUDINARY_ROOT_FOLDER ('' = the root itself), used for categories.
  folder text not null default '',
  format text,
  width integer,
  height integer,
  bytes bigint,
  display_name text,
  -- When the asset was created on Cloudinary (gallery sort key).
  taken_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles(id) on delete set null,
  -- Soft delete: rows for assets removed from Cloudinary are kept, so webhook replays and
  -- sync runs stay idempotent and an accidental re-sync cannot resurrect duplicates.
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Gallery: newest first, keyset pagination on (taken_at, id), optionally within one folder.
create index if not exists photos_active_taken_idx on public.photos (taken_at desc, id desc) where not is_deleted;
create index if not exists photos_active_folder_taken_idx on public.photos (folder, taken_at desc, id desc) where not is_deleted;
create index if not exists photos_public_id_idx on public.photos (public_id);

alter table public.photos enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photos' and policyname = 'photos are readable') then
    create policy "photos are readable" on public.photos for select to authenticated using (not is_deleted);
  end if;
end;
$$;
-- Writes go through server routes with the service role only (no insert/update/delete policies).

-- Categories for the gallery filter, derived from the data (never hard-coded).
create or replace view public.photo_folders
with (security_invoker = true)
as
select folder, count(*)::integer as photo_count, max(taken_at) as latest_taken_at
  from public.photos
 where not is_deleted
 group by folder;
