-- DNI / CUIL / CUIT del cliente con verificación automática (pedido de Cristian, 13/11).
-- Sin servicios externos ni IA: reglas fijas.
--   * DNI: 7 u 8 números.
--   * CUIL/CUIT: 11 números, prefijo válido y dígito verificador correcto (módulo 11 de AFIP/ARCA).
--   * Al pagar con Mercado Pago se compara el documento de la cuenta con el del pagador y el titular
--     de la tarjeta; el pedido queda marcado (coincide / no coincide / sin datos) para revisarlo antes de despachar.

alter table public.profiles add column if not exists doc_number text;
alter table public.profiles add column if not exists doc_type text check (doc_type in ('DNI','CUIL','CUIT'));

-- Devuelve 'DNI', 'CUIL', 'CUIT' o null si el número no es válido. Acepta puntos, guiones y espacios.
create or replace function public.doc_tipo(t text) returns text
language plpgsql immutable set search_path = public as $$
declare d text := regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g');
        w int[] := array[5,4,3,2,7,6,5,4,3,2]; s int := 0; v int; i int;
begin
  if d ~ '^[0-9]{7,8}$' then
    return case when d::int >= 1000000 then 'DNI' end;
  end if;
  if d !~ '^[0-9]{11}$' or left(d, 2) not in ('20','23','24','25','26','27','30','33','34') then return null; end if;
  for i in 1..10 loop s := s + substr(d, i, 1)::int * w[i]; end loop;
  v := 11 - s % 11;
  if v = 11 then v := 0; end if;
  if v = 10 or v <> substr(d, 11, 1)::int then return null; end if;
  return case when left(d, 2) in ('30','33','34') then 'CUIT' else 'CUIL' end;
end $$;

-- "Núcleo" para comparar documentos: el DNI de una persona (también el que va dentro de su CUIL/CUIT)
-- o el CUIT completo de una empresa.
create or replace function public.doc_nucleo(t text) returns text
language sql immutable set search_path = public as $$
  select case public.doc_tipo(t)
    when 'DNI'  then ltrim(regexp_replace(t, '[^0-9]', '', 'g'), '0')
    when 'CUIL' then ltrim(substr(regexp_replace(t, '[^0-9]', '', 'g'), 3, 8), '0')
    when 'CUIT' then regexp_replace(t, '[^0-9]', '', 'g')
  end
$$;
grant execute on function public.doc_tipo(text), public.doc_nucleo(text) to anon, authenticated;

-- Al guardar el perfil: se guarda solo con números y se rechaza un documento inválido.
create or replace function public.profiles_doc_ok() returns trigger
language plpgsql set search_path = public as $$
begin
  new.doc_number := nullif(regexp_replace(coalesce(new.doc_number, ''), '[^0-9]', '', 'g'), '');
  if new.doc_number is null then new.doc_type := null; return new; end if;
  new.doc_type := public.doc_tipo(new.doc_number);
  if new.doc_type is null then
    raise exception 'El DNI, CUIL o CUIT no es válido. Revisá los números.';
  end if;
  return new;
end $$;
revoke execute on function public.profiles_doc_ok() from public, anon, authenticated;
drop trigger if exists profiles_doc_ok on public.profiles;
create trigger profiles_doc_ok before insert or update of doc_number on public.profiles
  for each row execute function public.profiles_doc_ok();

-- Cada persona puede cargar o corregir el suyo (el tipo lo calcula la base).
grant update (doc_number) on public.profiles to authenticated;

-- Alta de cuenta: guarda el documento si es válido (si no, queda vacío; nunca hace fallar el registro).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare b date := public._safe_birthdate(new.raw_user_meta_data->>'birthdate');
        doc text := new.raw_user_meta_data->>'doc_number';
begin
  if b is not null and (b < date '1900-01-01' or b > (current_date - interval '18 years')::date) then b := null; end if;
  if public.doc_tipo(doc) is null then doc := null; end if;
  insert into profiles (id, email, full_name, phone, birthdate, doc_number)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone', b, doc);
  insert into user_roles (user_id, role_id) select new.id, id from roles where name = 'suscriptor';
  return new;
end $$;

-- Resultado de la verificación en cada pedido pagado online.
alter table public.orders add column if not exists id_check text check (id_check in ('coincide','no_coincide','sin_datos'));
alter table public.orders add column if not exists id_check_detail text;
