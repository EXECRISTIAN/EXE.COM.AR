-- Códigos de descuento (pedido de Cristian, 13/10).
-- · Solo con cuenta: para usar un código hay que iniciar sesión.
-- · Dos tipos: "personal" (cada cliente tiene uno para compartir con amigos; reglas comunes en promo_settings)
--   y "embajador" (los crea un administrador para quien elija, con sus propias reglas).
-- · Cada código: % o monto fijo, vencimiento, máximo de usos y compra mínima.
-- · El descuento lo calcula la base con los precios reales de los productos (no se puede inventar desde el navegador).
--   Al enviar el pedido por WhatsApp se registra el uso y el mensaje lleva un número de verificación.
-- · Nadie puede usar su propio código; cada persona usa un mismo código una sola vez.
-- · Contra adivinar códigos: máximo 15 intentos fallidos por hora por cuenta.

insert into public.permissions (key, description) values
  ('promos.manage', 'Códigos de descuento: crear y editar códigos de embajador, reglas de los personales y ver usos')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
  select r.id, 'promos.manage' from public.roles r where r.name = 'administrador'
on conflict do nothing;

-- Reglas de los códigos personales (una sola fila). Arranca apagado: Cristian lo activa desde el panel.
create table if not exists public.promo_settings (
  id int primary key default 1 check (id = 1),
  personal_enabled boolean not null default false,
  personal_type text not null default 'percent' check (personal_type in ('percent', 'fixed')),
  personal_value numeric not null default 5 check (personal_value > 0),
  personal_min numeric not null default 0 check (personal_min >= 0),
  personal_max_uses int check (personal_max_uses is null or personal_max_uses > 0),
  personal_days int check (personal_days is null or personal_days > 0),   -- validez del código desde que se crea
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.promo_settings (id, personal_max_uses) values (1, 10) on conflict (id) do nothing;

create table if not exists public.promo_codes (
  code text primary key check (code ~ '^[A-Z0-9]{4,20}$'),
  kind text not null check (kind in ('personal', 'embajador')),
  owner uuid references public.profiles(id) on delete cascade,
  -- Solo embajador: reglas propias (los personales usan promo_settings)
  discount_type text check (discount_type in ('percent', 'fixed')),
  discount_value numeric check (discount_value is null or discount_value > 0),
  min_purchase numeric not null default 0 check (min_purchase >= 0),
  max_uses int check (max_uses is null or max_uses > 0),
  expires_at timestamptz,
  active boolean not null default true,
  uses int not null default 0,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (kind = 'personal' or (discount_type is not null and discount_value is not null)),
  check (discount_type is distinct from 'percent' or discount_value <= 90)
);
create unique index if not exists promo_codes_one_personal on public.promo_codes (owner) where kind = 'personal';

create table if not exists public.promo_redemptions (
  id bigserial primary key,
  code text not null references public.promo_codes(code) on update cascade on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  subtotal numeric not null,
  discount numeric not null,
  items jsonb not null,
  created_at timestamptz not null default now(),
  unique (code, user_id)
);

create table if not exists public.promo_attempts (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists promo_attempts_user_at on public.promo_attempts (user_id, at);

alter table public.promo_settings enable row level security;
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.promo_attempts enable row level security;
revoke all on public.promo_settings, public.promo_codes, public.promo_redemptions, public.promo_attempts from anon;
revoke all on public.promo_redemptions, public.promo_attempts from authenticated;
grant select on public.promo_redemptions to authenticated;   -- (filtrado por las políticas de abajo)

-- Administradores (promos.manage) ven y editan todo; cada cliente ve su propio código y sus usos.
create policy "promo_settings_admin" on public.promo_settings for all to authenticated
  using (public.has_perm('promos.manage')) with check (public.has_perm('promos.manage'));
create policy "promo_codes_admin" on public.promo_codes for all to authenticated
  using (public.has_perm('promos.manage')) with check (public.has_perm('promos.manage'));
create policy "promo_codes_owner_read" on public.promo_codes for select to authenticated using (owner = auth.uid());
create policy "promo_redemptions_admin" on public.promo_redemptions for select to authenticated using (public.has_perm('promos.manage'));
create policy "promo_redemptions_own" on public.promo_redemptions for select to authenticated using (user_id = auth.uid());

-- Reglas efectivas de un código (personal → promo_settings)
create or replace function public._promo_rules(c public.promo_codes)
returns table (dtype text, dvalue numeric, minp numeric, maxu int, expires timestamptz, enabled boolean)
language sql stable security definer set search_path = public as $$
  select case when c.kind = 'personal' then s.personal_type else c.discount_type end,
         case when c.kind = 'personal' then s.personal_value else c.discount_value end,
         case when c.kind = 'personal' then s.personal_min else c.min_purchase end,
         case when c.kind = 'personal' then coalesce(c.max_uses, s.personal_max_uses) else c.max_uses end,
         case when c.kind = 'personal' then coalesce(c.expires_at, case when s.personal_days is null then null else c.created_at + make_interval(days => s.personal_days) end) else c.expires_at end,
         case when c.kind = 'personal' then s.personal_enabled else true end
  from promo_settings s where s.id = 1
$$;

-- Calcula el descuento para el carrito. items = [{"id": "...", "qty": 2}, ...]. No registra nada.
create or replace function public._promo_eval(p_code text, p_items jsonb, p_record boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c promo_codes; r record; sub numeric := 0; disc numeric; prev promo_redemptions;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  fail text;
begin
  if uid is null then raise exception 'Ingresá a tu cuenta para usar un código de descuento'; end if;
  if (select count(*) from promo_attempts where user_id = uid and at > now() - interval '1 hour') >= 15 then
    raise exception 'Demasiados intentos. Probá de nuevo en una hora';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'El carrito está vacío';
  end if;

  select * into c from promo_codes where code = v_code;
  if c.code is null then fail := 'Ese código no existe. Revisá que esté bien escrito';
  else
    select * into r from public._promo_rules(c);
    if not c.active or not r.enabled then fail := 'Ese código no está activo';
    elsif r.expires is not null and r.expires < now() then fail := 'Ese código venció';
    elsif c.owner = uid then fail := 'No podés usar tu propio código: compartilo con tus amigos';
    end if;
  end if;
  if fail is not null then
    insert into promo_attempts (user_id) values (uid);
    return jsonb_build_object('ok', false, 'error', fail);
  end if;

  -- Subtotal con los precios reales (en pesos) de productos activos con precio
  select coalesce(sum(p.price * least(greatest((i->>'qty')::int, 1), 99)), 0) into sub
  from jsonb_array_elements(p_items) i join products p on p.id = i->>'id' and p.active and p.price > 0;

  select * into prev from promo_redemptions where code = c.code and user_id = uid;
  if prev.id is not null and prev.created_at < now() - interval '24 hours' then
    return jsonb_build_object('ok', false, 'error', 'Ya usaste este código en otra compra');
  end if;
  if prev.id is null and r.maxu is not null and c.uses >= r.maxu then
    return jsonb_build_object('ok', false, 'error', 'Ese código ya alcanzó su máximo de usos');
  end if;
  if sub <= 0 then return jsonb_build_object('ok', false, 'error', 'El código se aplica sobre productos con precio'); end if;
  if sub < r.minp then
    return jsonb_build_object('ok', false, 'error', 'La compra mínima para este código es de $' || replace(to_char(r.minp, 'FM999,999,999'), ',', '.'), 'min', r.minp);
  end if;

  disc := case when r.dtype = 'percent' then round(sub * r.dvalue / 100) else least(r.dvalue, sub) end;

  if p_record then
    if prev.id is null then
      insert into promo_redemptions (code, user_id, subtotal, discount, items) values (c.code, uid, sub, disc, p_items) returning * into prev;
      update promo_codes set uses = uses + 1 where code = c.code;
    else   -- reenvío del mismo pedido dentro de las 24 h: se actualiza, no suma otro uso
      update promo_redemptions set subtotal = sub, discount = disc, items = p_items, created_at = now() where id = prev.id returning * into prev;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', c.code, 'kind', c.kind, 'type', r.dtype, 'value', r.dvalue,
    'subtotal', sub, 'discount', disc, 'total', sub - disc, 'check', case when p_record then prev.id end,
    'label', case when r.dtype = 'percent' then trim_scale(r.dvalue)::text || '% de descuento' else '$' || replace(to_char(r.dvalue, 'FM999,999,999'), ',', '.') || ' de descuento' end);
end $$;

create or replace function public.promo_check(p_code text, p_items jsonb) returns jsonb
language sql security definer set search_path = public as $$ select public._promo_eval(p_code, p_items, false) $$;
create or replace function public.promo_redeem(p_code text, p_items jsonb) returns jsonb
language sql security definer set search_path = public as $$ select public._promo_eval(p_code, p_items, true) $$;

-- Mi código personal: lo crea la primera vez (6 letras/números sin 0/O/1/I para que no se confundan).
create or replace function public.my_promo_code() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c promo_codes; r record; v text; n int := 0;
  abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if uid is null then raise exception 'Ingresá a tu cuenta'; end if;
  select * into c from promo_codes where owner = uid and kind = 'embajador' and active order by created_at desc limit 1;
  if c.code is null then
    if not (select personal_enabled from promo_settings where id = 1) then return null; end if;
    select * into c from promo_codes where owner = uid and kind = 'personal';
    if c.code is null then
      loop
        v := ''; for i in 1..6 loop v := v || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
        begin insert into promo_codes (code, kind, owner) values (v, 'personal', uid) returning * into c; exit;
        exception when unique_violation then n := n + 1; if n > 5 then raise; end if; end;
      end loop;
    end if;
  end if;
  select * into r from public._promo_rules(c);
  return jsonb_build_object('code', c.code, 'kind', c.kind, 'type', r.dtype, 'value', r.dvalue, 'min', r.minp,
    'max_uses', r.maxu, 'uses', c.uses, 'expires', r.expires, 'active', c.active and r.enabled);
end $$;

revoke execute on function public._promo_rules(public.promo_codes), public._promo_eval(text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.promo_check(text, jsonb), public.promo_redeem(text, jsonb), public.my_promo_code() from public, anon;
grant execute on function public.promo_check(text, jsonb), public.promo_redeem(text, jsonb), public.my_promo_code() to authenticated;
