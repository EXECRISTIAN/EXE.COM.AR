-- Búsquedas del buscador de la tienda + productos más llamativos para "Destacados".
-- 1) analytics_events guarda también lo que la gente escribe en el buscador (tipo 'search', columna query).
-- 2) search_summary: lista para el panel, de lo más buscado a lo menos (solo con permiso analytics.read).
-- 3) popular_products: los 10 productos con más interés (clics en la ficha, agregados al carrito y búsquedas
--    que los encuentran) en los últimos 60 días. Pública: solo devuelve ids de productos activos, nada de visitantes.

alter table public.analytics_events add column if not exists query text check (query is null or length(query) <= 80);
alter table public.analytics_events drop constraint if exists analytics_events_type_check;
alter table public.analytics_events add constraint analytics_events_type_check
  check (type in ('view', 'product', 'add', 'cart', 'wa', 'search'));
create index if not exists analytics_events_search_at on public.analytics_events (at) where type = 'search';

create or replace function public.track(p_events jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0; v text; q text;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then return 0; end if;
  for e in select * from jsonb_array_elements(p_events) limit 20 loop
    v := lower(e->>'visitor');
    continue when v is null or v !~ '^[a-z0-9]{8,32}$';
    continue when e->>'type' not in ('view', 'product', 'add', 'cart', 'wa', 'search');
    -- búsqueda: minúsculas, espacios simples, entre 2 y 80 letras
    q := case when e->>'type' = 'search' then left(lower(btrim(regexp_replace(coalesce(e->>'query', ''), '\s+', ' ', 'g'))), 80) end;
    continue when e->>'type' = 'search' and length(q) < 2;
    if n = 0 and (select count(*) from analytics_events where visitor = v and at > now() - interval '1 hour') >= 300 then return 0; end if;
    -- tope general: cambiar de identificador no permite saltear el límite
    if n = 0 and (select count(*) from analytics_events where at > now() - interval '1 hour') >= 5000 then return 0; end if;
    insert into analytics_events (visitor, type, product_id, device, os, browser, source, campaign, province, amount, query)
    values (v, e->>'type', left(e->>'product_id', 120),
      case when e->>'device' in ('mobile', 'desktop', 'tablet') then e->>'device' end,
      left(e->>'os', 20), left(e->>'browser', 20), left(e->>'source', 40), left(e->>'campaign', 60), left(e->>'province', 40),
      case when (e->>'amount') ~ '^\d{1,12}(\.\d+)?$' then (e->>'amount')::numeric end, q);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.track(jsonb) from public;
grant execute on function public.track(jsonb) to anon, authenticated;

-- Lo más buscado en el período (fechas en hora de Argentina, ambos días incluidos).
-- found = hay algún producto activo cuyo nombre, marca o categoría contiene lo buscado.
create or replace function public.search_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz text := 'America/Argentina/Buenos_Aires';
  a timestamptz := (p_from::timestamp at time zone tz);
  b timestamptz := ((p_to + 1)::timestamp at time zone tz);
begin
  if not public.has_perm('analytics.read') then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('q', x.query, 'n', x.n, 'people', x.people, 'last', x.last,
      'found', exists (select 1 from products p where p.active and (p.name || ' ' || coalesce(p.brand, '') || ' ' || coalesce(p.category, '')) ilike '%' || x.query || '%'))
      order by x.n desc, x.last desc)
    from (select query, count(*) n, count(distinct visitor) people, max(at) last
          from analytics_events where type = 'search' and at >= a and at < b and query is not null
          group by 1 order by 2 desc, 4 desc limit 300) x), '[]');
end $$;
revoke execute on function public.search_summary(date, date) from public, anon;
grant execute on function public.search_summary(date, date) to authenticated;

create or replace function public.popular_products() returns setof text
language sql stable security definer set search_path = public as $$
  with ev as (select type, product_id, query from analytics_events where at > now() - interval '60 days' and type in ('product', 'add', 'search')),
  score as (
    select product_id id, sum(case type when 'add' then 3 else 1 end) s from ev where product_id is not null and type in ('product', 'add') group by 1
    union all
    select p.id, count(*) from ev join products p on p.active and length(ev.query) >= 3
      and (p.name || ' ' || coalesce(p.brand, '')) ilike '%' || ev.query || '%'
    where ev.type = 'search' group by 1)
  select s.id from score s join products p on p.id = s.id and p.active and p.price > 0
  group by s.id order by sum(s.s) desc, s.id limit 10;
$$;
revoke execute on function public.popular_products() from public;
grant execute on function public.popular_products() to anon, authenticated;
