-- Integraciones (Panel → 🔌 Integraciones): Envia.com (envíos), Mercado Pago (cobro online) y ARCA (facturación).
--
-- REGLA ÚNICA: cada integración tiene un interruptor en public.integrations. APAGADA (la opción por defecto) = la web
-- funciona exactamente como si esa integración no existiera. Las funciones del servidor también miran el interruptor,
-- así que aunque alguien llame directo a la función, si está apagada no hace nada.
-- Las claves secretas NUNCA van en esta tabla: van en Supabase → Edge Functions → Secrets (ver docs/INTEGRACIONES.md).

insert into public.permissions (key, description) values
  ('integrations.manage', 'Prender y apagar integraciones (envíos, Mercado Pago, ARCA) y editar su configuración')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
  select id, 'integrations.manage' from public.roles where name = 'administrador'
on conflict do nothing;

create table if not exists public.integrations (
  key        text primary key check (key in ('envios', 'mercadopago', 'arca')),
  enabled    boolean not null default false,
  config     jsonb not null default '{}'::jsonb,   -- solo datos NO secretos (ej. punto de venta, transportistas)
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.integrations (key, config) values
  ('envios',      '{"carriers": "andreani,correo-argentino,oca", "env": "test"}'),
  ('mercadopago', '{"env": "test", "pending_hours": 72}'),
  ('arca',        '{"env": "homo", "cuit": "", "punto_venta": 1, "cbte_tipo": 11, "auto_invoice": false}')
on conflict (key) do nothing;

alter table public.integrations enable row level security;
-- La tienda solo necesita saber si cada una está prendida: lectura directa SOLO de key y enabled.
-- La configuración completa la lee el panel con integrations_admin() (exige integrations.manage).
revoke all on public.integrations from anon, authenticated;
grant select (key, enabled) on public.integrations to anon, authenticated;
grant update (enabled, config) on public.integrations to authenticated;
create policy "integrations_read" on public.integrations for select using (true);
create policy "integrations_write" on public.integrations for update to authenticated
  using (public.has_perm('integrations.manage')) with check (public.has_perm('integrations.manage'));

create or replace function public.integrations_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.key := old.key; new.updated_at := now(); new.updated_by := coalesce(auth.uid(), old.updated_by);
  -- Desde el panel se puede APAGAR siempre, pero PRENDER solo lo hace la función "integraciones" (servidor),
  -- después de comprobar que estén cargadas todas las claves: así nunca se muestra al público algo incompleto.
  if new.enabled and not old.enabled and auth.uid() is not null then
    raise exception 'Para prender una integración usá el botón del panel (verifica que esté completa)';
  end if;
  return new;
end $$;
revoke execute on function public.integrations_touch() from public, anon, authenticated;
drop trigger if exists integrations_touch on public.integrations;
create trigger integrations_touch before update on public.integrations for each row execute function public.integrations_touch();

create or replace function public.integrations_admin() returns setof public.integrations
language sql stable security definer set search_path = public as $$
  select * from integrations where has_perm('integrations.manage') order by key $$;
revoke execute on function public.integrations_admin() from public, anon;
grant execute on function public.integrations_admin() to authenticated;

-- Helper para las funciones del servidor (service_role): ¿está prendida?
create or replace function public.integration_on(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from integrations where key = p_key), false) $$;
revoke execute on function public.integration_on(text) from public, anon, authenticated;

-- Caché interno de las integraciones (ej. el ticket de acceso de ARCA, que dura 12 h). Sin acceso desde afuera.
create table if not exists public.integration_cache (
  key     text primary key,
  value   jsonb not null,
  expires timestamptz not null
);
alter table public.integration_cache enable row level security;
revoke all on public.integration_cache from anon, authenticated;

-- ---------- Mercado Pago ----------
-- Pedido web pagado online. Se crea SIN descontar stock (stock_taken = 0): el stock se descuenta recién al
-- acreditarse el pago. Si no se paga en `pending_hours`, se cancela solo (no hay stock que devolver).
alter table public.orders
  add column if not exists payment_provider text,
  add column if not exists payment_url      text,
  add column if not exists invoice_type     int,
  add column if not exists invoice_number   bigint,
  add column if not exists invoice_pos      int,
  add column if not exists invoice_cae      text,
  add column if not exists invoice_cae_due  date,
  add column if not exists invoice_at       timestamptz,
  add column if not exists invoice_doc      text;   -- CUIT/DNI del comprador (opcional)

-- Solo la llama la función "pagos" (service_role). Precios y stock salen de la base, nunca del navegador.
create or replace function public.web_create_order(p_uid uuid, p_items jsonb, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order bigint; v_total numeric := 0; it jsonb; p products%rowtype; v_qty int; v_lines jsonb := '[]'::jsonb;
begin
  if not public.integration_on('mercadopago') then raise exception 'Mercado Pago está desactivado'; end if;
  if p_uid is null then raise exception 'Ingresá a tu cuenta para pagar online'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El carrito está vacío'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'Demasiados productos'; end if;
  if (select count(*) from orders where user_id = p_uid and source = 'web' and status = 'pending'
        and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Tenés varios pagos sin terminar. Probá de nuevo en un rato';
  end if;

  insert into orders (user_id, total, source, payment_provider, customer_name)
    values (p_uid, 0, 'web', 'mercadopago', coalesce(nullif(left(trim(p_name), 120), ''), (select full_name from profiles where id = p_uid)))
    returning id into v_order;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 99 then raise exception 'Cantidad inválida'; end if;
    select * into p from products where id = it->>'id' and active;
    if not found then raise exception 'Hay un producto que ya no está disponible'; end if;
    if coalesce(p.price, 0) <= 0 then raise exception '% no tiene precio: consultalo por WhatsApp', p.name; end if;
    if v_qty > p.stock and not p.cart_ok then raise exception 'No hay stock suficiente de %', p.name; end if;
    insert into order_items (order_id, product_id, variant, qty, unit_price, stock_taken)
      values (v_order, p.id, coalesce(left(it->>'variant', 80), ''), v_qty, p.price, 0)
      on conflict (order_id, product_id, variant) do update set qty = order_items.qty + excluded.qty;
    v_total := v_total + p.price * v_qty;
    v_lines := v_lines || jsonb_build_object('id', p.id, 'title', left(p.name, 250), 'quantity', v_qty, 'unit_price', p.price);
  end loop;

  update orders set total = v_total where id = v_order;
  insert into order_events (order_id, to_status, actor) values (v_order, 'pending', 'web');
  return jsonb_build_object('order_id', v_order, 'total', v_total, 'items', v_lines);
end $$;
revoke execute on function public.web_create_order(uuid, jsonb, text) from public, anon, authenticated;

-- Pago acreditado (solo la llama mp-webhook): marca pagado y AHORA descuenta el stock (lo disponible).
create or replace function public.web_order_paid(p_order bigint, p_ref text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_old order_status; oi record; v_take int;
begin
  select status into v_old from orders where id = p_order for update;
  if v_old is null or v_old <> 'pending' then return false; end if;
  update orders set status = 'paid', paid_at = now(), paid_by = 'mercadopago', payment_ref = left(p_ref, 80) where id = p_order;
  for oi in select * from order_items where order_id = p_order order by product_id, variant loop
    select least(oi.qty, greatest(stock, 0)) into v_take from products where id = oi.product_id for update;
    update products set stock = stock - coalesce(v_take, 0), updated_at = now() where id = oi.product_id;
    update order_items set stock_taken = coalesce(v_take, 0)
      where order_id = p_order and product_id = oi.product_id and variant = oi.variant;
  end loop;
  insert into order_events (order_id, from_status, to_status, actor) values (p_order, 'pending', 'paid', 'mercadopago');
  return true;
end $$;
revoke execute on function public.web_order_paid(bigint, text) from public, anon, authenticated;

-- Limpieza: pedidos web de Mercado Pago sin pagar después de `pending_hours` se cancelan (no descontaron stock).
create or replace function public.web_orders_expire() returns int
language plpgsql security definer set search_path = public as $$
declare n int; h int := coalesce((select (config->>'pending_hours')::int from integrations where key = 'mercadopago'), 72);
begin
  with c as (
    update orders set status = 'cancelled'
     where source = 'web' and payment_provider = 'mercadopago' and status = 'pending'
       and created_at < now() - make_interval(hours => greatest(h, 1))
       and not exists (select 1 from order_items oi where oi.order_id = orders.id and coalesce(oi.stock_taken, oi.qty) > 0)
    returning id)
  insert into order_events (order_id, from_status, to_status, actor) select id, 'pending', 'cancelled', 'vencido' from c;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.web_orders_expire() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'mp_pedidos_vencidos';
select cron.schedule('mp_pedidos_vencidos', '23 * * * *', $$select public.web_orders_expire()$$);

-- Mis pedidos: el cliente ve su link de pago pendiente (la tabla orders ya tiene RLS por user_id).
