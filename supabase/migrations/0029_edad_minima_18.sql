-- Edad mínima para tener cuenta: 18 años (decisión de Cristian, 14/10). Antes era 13 (migración 0026).
create or replace function public.profiles_birthdate_ok() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.birthdate is not null and new.birthdate > (current_date - interval '18 years')::date then
    raise exception 'Para tener una cuenta en EXE tenés que ser mayor de 18 años';
  end if;
  return new;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare b date := public._safe_birthdate(new.raw_user_meta_data->>'birthdate');
begin
  if b is not null and (b < date '1900-01-01' or b > (current_date - interval '18 years')::date) then b := null; end if;
  insert into profiles (id, email, full_name, phone, birthdate)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone', b);
  insert into user_roles (user_id, role_id) select new.id, id from roles where name = 'suscriptor';
  return new;
end $$;
