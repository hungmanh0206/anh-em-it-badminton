-- Soft removal preserves historic matches and monthly rankings.
create or replace function public.admin_update_member(p_username text, p_full_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Admin only';
  end if;
  if length(trim(p_full_name)) < 2 then raise exception 'Tên thành viên không hợp lệ'; end if;
  update public.profiles set full_name = trim(p_full_name), updated_at = now()
  where username = p_username and is_active;
  if not found then raise exception 'Không tìm thấy thành viên'; end if;
end; $$;

create or replace function public.admin_remove_member(p_username text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Admin only';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and username = p_username) then
    raise exception 'Không thể xóa chính tài khoản admin đang đăng nhập';
  end if;
  update public.profiles set is_active = false, updated_at = now()
  where username = p_username and is_active;
  if not found then raise exception 'Không tìm thấy thành viên'; end if;
end; $$;
