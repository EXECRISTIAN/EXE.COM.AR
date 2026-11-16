-- Auditoría AUD-02: tope al asignar roles. Quien no administra roles (roles.manage) solo puede asignar o quitar
-- roles cuyos permisos ya tiene todos. Evita que un rol delegado con users.assign_roles se haga administrador.
create or replace function public.user_roles_guard() returns trigger
language plpgsql security definer set search_path = public as $f$
declare uid uuid := auth.uid(); rids int[] := '{}'; rid int; falta text;
begin
  if uid is null then return coalesce(new, old); end if;   -- servidor / alta de cuenta
  if exists (select 1 from user_roles ur join role_permissions rp on rp.role_id = ur.role_id
             where ur.user_id = uid and rp.permission_key = 'roles.manage') then return coalesce(new, old); end if;
  if tg_op in ('INSERT','UPDATE') then rids := rids || new.role_id; end if;
  if tg_op in ('UPDATE','DELETE') then rids := rids || old.role_id; end if;
  foreach rid in array rids loop
    select rp.permission_key into falta from role_permissions rp
     where rp.role_id = rid and not exists (
       select 1 from user_roles ur join role_permissions m on m.role_id = ur.role_id
        where ur.user_id = uid and m.permission_key = rp.permission_key)
     limit 1;
    if falta is not null then raise exception 'No podés asignar ni quitar un rol con permisos que vos no tenés (%)', falta; end if;
  end loop;
  return coalesce(new, old);
end $f$;
revoke execute on function public.user_roles_guard() from public, anon, authenticated;
drop trigger if exists user_roles_guard on public.user_roles;
create trigger user_roles_guard before insert or update or delete on public.user_roles
  for each row execute function public.user_roles_guard();
