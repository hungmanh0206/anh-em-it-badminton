-- Chốt BXH tháng: 4 người dẫn đầu lên Level 1, các thành viên còn lại Level 2.
-- Gọi hàm này sau khi nhập/chốt đủ monthly_results của một tháng.
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
    select member_id,
           row_number() over (
             order by points desc, point_diff desc, points_won desc, matches_played desc
           ) as position
      from public.monthly_results
     where month = date_trunc('month', p_month)::date
  ), assigned as (
    update public.monthly_results r
       set level_next_month = case when ranked.position <= 4 then '1'::public.member_level else '2'::public.member_level end
      from ranked
     where r.month = date_trunc('month', p_month)::date
       and r.member_id = ranked.member_id
    returning r.member_id, r.level_next_month
  )
  update public.profiles p
     set level = assigned.level_next_month
    from assigned
   where p.id = assigned.member_id;
end;
$$;

revoke all on function public.apply_next_month_levels(date) from public;
grant execute on function public.apply_next_month_levels(date) to authenticated;
