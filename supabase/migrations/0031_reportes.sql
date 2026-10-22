-- Reportes (pedido de Cristian, 21/10). Módulo "reportes" de finance_modules (activable por partes).
-- Dos reportes, cada uno manual (panel → Generar) y/o automático (semanal o mensual), con envío por email:
-- · "resumen": ventas, ganancia bruta, gastos, resultado, lo más vendido, stock bajo y visitas.
-- · "arca": ventas para declarar ante ARCA (por mes y día, medio de pago). Monotributo: facturación de los
--   últimos 12 meses contra el tope anual de la categoría (cargado a mano). Responsable inscripto: neto e IVA
--   débito estimados al 21 %. Es una ayuda para el contador: no reemplaza facturas ni declaraciones juradas.
-- Seguridad: todo con finance.manage + verificación en dos pasos. La tarea automática corre en la base (pg_cron)
-- y avisa a la función "reportes" con una clave generada en Vault (no está en el repo).

create table if not exists public.report_settings (
  kind text primary key check (kind in ('resumen', 'arca')),
  enabled boolean not null default false,
  frequency text not null default 'mensual' check (frequency in ('semanal', 'mensual')),
  recipients text[] not null default '{}' check (cardinality(recipients) <= 5),
  arca_regime text not null default 'monotributo' check (arca_regime in ('monotributo', 'responsable_inscripto')),
  monotributo_limit numeric check (monotributo_limit is null or monotributo_limit > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
insert into public.report_settings (kind) values ('resumen'), ('arca') on conflict (kind) do nothing;

-- Emails válidos en los destinatarios
create or replace function public._report_settings_check() returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from unnest(new.recipients) e where e !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or length(e) > 120) then
    raise exception 'Hay un email que no es válido en los destinatarios';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists report_settings_check on public.report_settings;
create trigger report_settings_check before insert or update on public.report_settings for each row execute function public._report_settings_check();

create table if not exists public.reports (
  id bigserial primary key,
  kind text not null check (kind in ('resumen', 'arca')),
  period_from date not null,
  period_to date not null check (period_to >= period_from),
  data jsonb not null,
  auto boolean not null default false,
  emailed_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists reports_created on public.reports (created_at desc);

alter table public.report_settings enable row level security;
alter table public.reports enable row level security;
revoke all on public.report_settings, public.reports from anon;
revoke insert, delete on public.report_settings from authenticated;
revoke insert, update on public.reports from authenticated;      -- se crean solo con report_generate()
drop policy if exists "report_settings_admin" on public.report_settings;
create policy "report_settings_admin" on public.report_settings for all to authenticated
  using (public.has_perm('finance.manage')) with check (public.has_perm('finance.manage'));
drop policy if exists "reports_admin" on public.reports;
create policy "reports_admin" on public.reports for all to authenticated
  using (public.has_perm('finance.manage')) with check (public.has_perm('finance.manage'));

-- Arma los datos de un reporte (internas, sin chequeo de permiso: las usan report_generate y la tarea automática).
-- _rp_base deja en la tabla temporal _rp_orders los pedidos pagados del período (fecha de pago, hora argentina).
create or replace function public._rp_base(p_from date, p_to date) returns void
language plpgsql security definer set search_path = public as $$
declare tz text := 'America/Argentina/Buenos_Aires';
begin
  drop table if exists _rp_orders;
  create temp table _rp_orders as
    select o.id, o.total, (coalesce(o.paid_at, o.created_at) at time zone tz)::date d,
           coalesce(o.paid_by = 'mercadopago' or o.payment_ref is not null, false) mp, coalesce(nullif(o.customer_name, ''), p.full_name, '') customer
    from orders o left join profiles p on p.id = o.user_id
    where o.status in ('paid', 'preparing', 'shipped', 'delivered')
      and coalesce(o.paid_at, o.created_at) >= (p_from::timestamp at time zone tz) and coalesce(o.paid_at, o.created_at) < ((p_to + 1)::timestamp at time zone tz);
end $$;

-- Resumen del negocio: ventas, ganancia bruta (costo actual), gastos, lo más vendido, stock bajo y visitas.
create or replace function public._report_resumen(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tz text := 'America/Argentina/Buenos_Aires'; a timestamptz := (p_from::timestamp at time zone tz); b timestamptz := ((p_to + 1)::timestamp at time zone tz);
  fx numeric := coalesce((select effective_rate from fx_settings where id = 1), 0); res jsonb;
begin
  perform public._rp_base(p_from, p_to);
  with it as (select oi.product_id, oi.qty, oi.unit_price * oi.qty sale, coalesce(pc.cost, pc.cost_usd * nullif(fx, 0)) uc
    from order_items oi join _rp_orders r on r.id = oi.order_id left join product_costs pc on pc.product_id = oi.product_id)
  select jsonb_build_object(
    'income', coalesce((select sum(total) from _rp_orders), 0), 'orders', (select count(*) from _rp_orders),
    'cogs', coalesce((select sum(uc * qty) from it where uc is not null), 0), 'no_cost_units', coalesce((select sum(qty) from it where uc is null), 0),
    'top', coalesce((select jsonb_agg(x order by x.sale desc) from (select p.name, sum(it.qty) qty, sum(it.sale) sale from it left join products p on p.id = it.product_id group by p.name order by 3 desc limit 5) x), '[]'::jsonb)
  ) into res;
  drop table if exists _rp_orders;
  return res || jsonb_build_object(
    'expenses', coalesce((select sum(amount) from expenses where month >= date_trunc('month', p_from) and month <= p_to), 0),
    'expenses_by_cat', coalesce((select jsonb_object_agg(category, t) from (select category, sum(amount) t from expenses where month >= date_trunc('month', p_from) and month <= p_to group by 1) x), '{}'::jsonb),
    'low_stock', coalesce((select jsonb_agg(x) from (select name, stock from products where active and stock <= 2 order by stock, name limit 8) x), '[]'::jsonb),
    'visits', (select count(*) from analytics_events where type = 'view' and at >= a and at < b),
    'people', (select count(distinct visitor) from analytics_events where at >= a and at < b));
end $$;

-- Para ARCA: ventas por mes y por día, medio de pago y (monotributo) lo cobrado en los 12 meses que terminan con el período.
create or replace function public._report_arca(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tz text := 'America/Argentina/Buenos_Aires'; s report_settings; res jsonb;
begin
  select * into s from report_settings where kind = 'arca';
  perform public._rp_base(p_from, p_to);
  select jsonb_build_object('regime', coalesce(s.arca_regime, 'monotributo'), 'limit', s.monotributo_limit,
    'income', coalesce((select sum(total) from _rp_orders), 0), 'orders', (select count(*) from _rp_orders),
    'mp', coalesce((select sum(total) from _rp_orders where mp), 0), 'manual', coalesce((select sum(total) from _rp_orders where not mp), 0),
    'by_month', coalesce((select jsonb_agg(x order by x.m) from (select to_char(d, 'YYYY-MM') m, count(*) n, sum(total) t from _rp_orders group by 1) x), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(x order by x.d, x.id) from (select id, d, customer, total, mp from _rp_orders) x), '[]'::jsonb)) into res;
  perform public._rp_base((p_to + 1 - interval '12 months')::date, p_to);
  res := res || jsonb_build_object('last12', coalesce((select sum(total) from _rp_orders), 0));
  drop table if exists _rp_orders;
  return res;
end $$;

create or replace function public._report_data(p_kind text, p_from date, p_to date) returns jsonb
language sql security definer set search_path = public as $$
  select case p_kind when 'resumen' then public._report_resumen(p_from, p_to) else public._report_arca(p_from, p_to) end
$$;
revoke execute on function public._rp_base(date, date), public._report_resumen(date, date), public._report_arca(date, date),
  public._report_data(text, date, date) from public, anon, authenticated;

-- Generar a mano desde el panel (queda en el historial).
create or replace function public.report_generate(p_kind text, p_from date, p_to date) returns bigint
language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  if not public.has_perm('finance.manage') then raise exception 'Sin permiso'; end if;
  if p_kind not in ('resumen', 'arca') or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Período no válido (máximo 13 meses)';
  end if;
  insert into reports (kind, period_from, period_to, data, auto, created_by)
    values (p_kind, p_from, p_to, public._report_data(p_kind, p_from, p_to), false, auth.uid()) returning id into rid;
  return rid;
end $$;
revoke execute on function public.report_generate(text, date, date) from public, anon;
grant execute on function public.report_generate(text, date, date) to authenticated;

-- Tarea automática (todos los días 9:05 de Argentina): los lunes arma los semanales (semana anterior) y el día 1
-- los mensuales (mes anterior), si el módulo y el reporte están prendidos. Después avisa a la función "reportes"
-- para que mande los emails pendientes (si la clave no está cargada en Vault, solo quedan en el historial).
create or replace function public._reports_run() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  r report_settings; f date; t date; n int := 0; k text;
begin
  if not coalesce((select enabled from finance_modules where key = 'reportes'), false) then return 0; end if;
  for r in select * from report_settings where enabled loop
    if r.frequency = 'semanal' and extract(isodow from today) = 1 then f := today - 7; t := today - 1;
    elsif r.frequency = 'mensual' and extract(day from today) = 1 then f := (today - interval '1 month')::date; t := today - 1;
    else continue; end if;
    if exists (select 1 from reports where kind = r.kind and auto and period_from = f and period_to = t) then continue; end if;
    insert into reports (kind, period_from, period_to, data, auto, created_by) values (r.kind, f, t, public._report_data(r.kind, f, t), true, null);
    n := n + 1;
  end loop;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'reports_cron_key';
  if k is not null and exists (select 1 from reports where emailed_at is null and email_error is null and auto) then
    perform net.http_post(url := 'https://sbayacwjvnxwktrhkgnk.supabase.co/functions/v1/reportes',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', k), body := '{"action":"send_pending"}'::jsonb);
  end if;
  return n;
end $$;
revoke execute on function public._reports_run() from public, anon, authenticated;

-- Clave de la tarea automática: la genera la base en Vault y la función "reportes" la valida acá (no sale de la base).
select vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'reports_cron_key', 'Clave para que la tarea automatica llame a la funcion reportes')
  where not exists (select 1 from vault.secrets where name = 'reports_cron_key');
create or replace function public._reports_cron_key_ok(k text) returns boolean language sql stable security definer set search_path = public as $$
  select k is not null and k = (select decrypted_secret from vault.decrypted_secrets where name = 'reports_cron_key') $$;
revoke execute on function public._reports_cron_key_ok(text) from public, anon, authenticated;
grant execute on function public._reports_cron_key_ok(text) to service_role;

select cron.unschedule('reportes-automaticos') where exists (select 1 from cron.job where jobname = 'reportes-automaticos');
select cron.schedule('reportes-automaticos', '5 12 * * *', 'select public._reports_run()');
