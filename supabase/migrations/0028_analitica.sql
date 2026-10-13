-- Analítica propia de EXE (pedido de Cristian, 13/10). Sin servicios pagos ni de terceros.
-- Anónima: un número al azar por navegador (no se relaciona con la cuenta), tipo de dispositivo, sistema,
-- navegador, de qué link vino y provincia (solo si la persona la elige en el carrito). Sin IP, nombre ni GPS.
-- Los visitantes solo pueden agregar eventos con la función track() (validada y con tope);
-- leer el resumen requiere el permiso analytics.read (administradores).

insert into public.permissions (key, description) values
  ('analytics.read', 'Ver la analítica de la tienda (visitas, dispositivos, origen, provincias)')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
  select r.id, 'analytics.read' from public.roles r where r.name = 'administrador'
on conflict do nothing;

create table if not exists public.analytics_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  visitor text not null check (visitor ~ '^[a-z0-9]{8,32}$'),
  type text not null check (type in ('view', 'product', 'add', 'cart', 'wa')),
  product_id text check (length(product_id) <= 120),
  device text check (device in ('mobile', 'desktop', 'tablet')),
  os text check (length(os) <= 20),
  browser text check (length(browser) <= 20),
  source text check (length(source) <= 40),
  campaign text check (length(campaign) <= 60),
  province text check (length(province) <= 40),
  amount numeric check (amount is null or amount >= 0)
);
create index if not exists analytics_events_at on public.analytics_events (at);
create index if not exists analytics_events_visitor_at on public.analytics_events (visitor, at);
alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;

-- Registrar eventos (hasta 20 por llamada y 300 por visitante por hora; lo que no cumple se ignora).
create or replace function public.track(p_events jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0; v text;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then return 0; end if;
  for e in select * from jsonb_array_elements(p_events) limit 20 loop
    v := lower(e->>'visitor');
    continue when v is null or v !~ '^[a-z0-9]{8,32}$';
    continue when e->>'type' not in ('view', 'product', 'add', 'cart', 'wa');
    if n = 0 and (select count(*) from analytics_events where visitor = v and at > now() - interval '1 hour') >= 300 then return 0; end if;
    insert into analytics_events (visitor, type, product_id, device, os, browser, source, campaign, province, amount)
    values (v, e->>'type', left(e->>'product_id', 120),
      case when e->>'device' in ('mobile', 'desktop', 'tablet') then e->>'device' end,
      left(e->>'os', 20), left(e->>'browser', 20), left(e->>'source', 40), left(e->>'campaign', 60), left(e->>'province', 40),
      case when (e->>'amount') ~ '^\d{1,12}(\.\d+)?$' then (e->>'amount')::numeric end);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.track(jsonb) from public;
grant execute on function public.track(jsonb) to anon, authenticated;

-- Resumen para el panel (fechas en hora de Argentina, ambos días incluidos).
create or replace function public.analytics_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := 'America/Argentina/Buenos_Aires';
  a timestamptz := (p_from::timestamp at time zone tz);
  b timestamptz := ((p_to + 1)::timestamp at time zone tz);
  len int := (p_to - p_from) + 1;
  pa timestamptz := ((p_from - len)::timestamp at time zone tz);
  res jsonb;
begin
  if not public.has_perm('analytics.read') then raise exception 'Sin permiso'; end if;
  with ev as (select * from analytics_events where at >= a and at < b),
       pv as (select * from analytics_events where at >= pa and at < a),
       k as (
         select (select count(*) from ev where type = 'view') visits,
                (select count(distinct visitor) from ev) people,
                (select count(*) from ev where type = 'wa') wa,
                (select count(distinct visitor) from ev where device = 'mobile') mobile,
                (select count(*) from pv where type = 'view') p_visits,
                (select count(distinct visitor) from pv) p_people,
                (select count(*) from pv where type = 'wa') p_wa)
  select jsonb_build_object(
    'kpis', (select to_jsonb(k) from k),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d) from (
        select (at at time zone tz)::date d, count(*) n from ev where type = 'view' group by 1) x), '[]'),
    'funnel', jsonb_build_object(
        'product', (select count(distinct visitor) from ev where type in ('product', 'add', 'cart', 'wa')),
        'add', (select count(distinct visitor) from ev where type = 'add'),
        'cart', (select count(distinct visitor) from ev where type = 'cart'),
        'wa', (select count(distinct visitor) from ev where type = 'wa')),
    'devices', coalesce((select jsonb_object_agg(device, n) from (select device, count(distinct visitor) n from ev where device is not null group by 1) x), '{}'),
    'os', coalesce((select jsonb_object_agg(os, n) from (select os, count(distinct visitor) n from ev where os is not null group by 1) x), '{}'),
    'browsers', coalesce((select jsonb_object_agg(browser, n) from (select browser, count(distinct visitor) n from ev where browser is not null group by 1) x), '{}'),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('s', source, 'n', n) order by n desc) from (
        select coalesce(source, 'Directo') source, count(distinct visitor) n from ev where type = 'view' group by 1) x), '[]'),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('c', campaign, 'n', n) order by n desc) from (
        select campaign, count(distinct visitor) n from ev where type = 'view' and campaign is not null group by 1 order by 2 desc limit 10) x), '[]'),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', x.product_id, 'name', p.name, 'image', coalesce(p.images[1], p.image), 'views', x.views, 'adds', x.adds) order by x.views desc) from (
        select product_id, count(*) filter (where type = 'product') views, count(*) filter (where type = 'add') adds
        from ev where product_id is not null group by 1 order by 2 desc limit 8) x left join products p on p.id = x.product_id), '[]'),
    'provinces', coalesce((select jsonb_object_agg(prov, n) from (
        select prov, count(*) n from (
          select province prov from ev where type = 'wa' and province is not null
          union all
          select ship_province from orders where created_at >= a and created_at < b and ship_province is not null and status <> 'cancelled'
        ) y group by 1) x), '{}')
  ) into res;
  return res;
end $$;
revoke execute on function public.analytics_summary(date, date) from public, anon;
grant execute on function public.analytics_summary(date, date) to authenticated;
