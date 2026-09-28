-- Clientes reales de la tienda WordPress anterior.
-- Regla: NO se les manda ningún email ni se les crea cuenta. Sus datos quedan "en espera" y
-- se vinculan solos cuando esa persona vuelve, crea su cuenta con el mismo email y lo CONFIRMA
-- (la confirmación de email es la verificación de que la cuenta está activa y es suya).
-- Los datos personales NO van en este archivo (el repo es público): se cargan aparte.

create table public.legacy_customers (
  email          text primary key,            -- en minúsculas
  full_name      text,
  phone          text,
  city           text,
  last_order_at  timestamptz,
  source         text not null default 'wordpress',
  claimed_by     uuid references public.profiles on delete set null,
  claimed_at     timestamptz,
  imported_at    timestamptz not null default now()
);
alter table public.legacy_customers enable row level security;
create policy "ver clientes anteriores" on public.legacy_customers for select using (has_perm('users.read'));
-- sin políticas de escritura: solo el servicio / SQL Editor puede cargar o modificar

-- Verificación: el perfil guarda cuándo confirmó su email. Solo a perfiles verificados se les envían emails.
alter table public.profiles add column email_verified_at timestamptz;
-- cuentas que ya existían y ya confirmaron su email
update public.profiles p set email_verified_at = u.email_confirmed_at from auth.users u where u.id = p.id and u.email_confirmed_at is not null;

create or replace function public.handle_email_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
declare lc legacy_customers;
begin
  if new.email_confirmed_at is null or old.email_confirmed_at is not null then return new; end if;
  update profiles set email_verified_at = new.email_confirmed_at where id = new.id;
  select * into lc from legacy_customers where email = lower(new.email) and claimed_by is null;
  if found then
    update profiles set full_name = coalesce(full_name, lc.full_name), phone = coalesce(phone, lc.phone) where id = new.id;
    update legacy_customers set claimed_by = new.id, claimed_at = now() where email = lc.email;
  end if;
  return new;
end $$;
revoke execute on function public.handle_email_confirmed() from public, anon, authenticated;

create trigger on_auth_email_confirmed after update of email_confirmed_at on auth.users
  for each row execute function public.handle_email_confirmed();
