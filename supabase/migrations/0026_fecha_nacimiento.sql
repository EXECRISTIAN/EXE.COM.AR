-- Fecha de nacimiento (pedido de Cristian, 13/10): obligatoria, se pide al registrarse y se edita en Mi cuenta.
-- Se valida también en la base: fecha real, desde 1900 y al menos 13 años de edad.
-- Cada persona solo puede cambiar la suya (permiso de columna, igual que nombre y teléfono).

alter table public.profiles add column if not exists birthdate date check (birthdate is null or birthdate >= date '1900-01-01');

-- Edad mínima: no se puede poner en un CHECK (depende de la fecha de hoy), va en un trigger.
create or replace function public.profiles_birthdate_ok() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.birthdate is not null and new.birthdate > (current_date - interval '13 years')::date then
    raise exception 'Para tener una cuenta en EXE tenés que tener al menos 13 años';
  end if;
  return new;
end $$;
revoke execute on function public.profiles_birthdate_ok() from public, anon, authenticated;
drop trigger if exists profiles_birthdate_ok on public.profiles;
create trigger profiles_birthdate_ok before insert or update of birthdate on public.profiles
  for each row execute function public.profiles_birthdate_ok();

grant update (birthdate) on public.profiles to authenticated;

-- Texto "AAAA-MM-DD" del registro → fecha válida o null (nunca hace fallar la creación de la cuenta).
create or replace function public._safe_birthdate(t text) returns date
language plpgsql immutable set search_path = public as $$
declare d date;
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  begin d := t::date; exception when others then return null; end;
  return d;
end $$;
revoke execute on function public._safe_birthdate(text) from public, anon, authenticated;

-- Alta de cuenta: además de nombre y teléfono, guarda la fecha de nacimiento si es válida.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare b date := public._safe_birthdate(new.raw_user_meta_data->>'birthdate');
begin
  if b is not null and (b < date '1900-01-01' or b > (current_date - interval '13 years')::date) then b := null; end if;
  insert into profiles (id, email, full_name, phone, birthdate)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone', b);
  insert into user_roles (user_id, role_id) select new.id, id from roles where name = 'suscriptor';
  return new;
end $$;
