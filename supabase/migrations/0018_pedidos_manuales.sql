-- Pedidos armados desde el panel (ej. los que llegan por WhatsApp), datos de envío para la etiqueta
-- y lista de armado (qué productos ya se juntaron).
-- Seguridad: todo pasa por funciones SECURITY DEFINER que verifican permisos; las columnas nuevas
-- no se pueden escribir directo desde el navegador (orders no tiene políticas de insert/update).

alter table public.orders
  add column if not exists customer_name  text,
  add column if not exists customer_phone text,
  add column if not exists customer_email text,
  add column if not exists ship_address   text,
  add column if not exists ship_city      text,
  add column if not exists ship_province  text,
  add column if not exists ship_zip       text,
  add column if not exists packages       int  not null default 1 check (packages between 1 and 50),
  add column if not exists packed_items   jsonb not null default '[]'::jsonb,   -- ["product_id|variant", ...] ya juntados
  add column if not exists packed_at      timestamptz,
  add column if not exists source         text not null default 'web' check (source in ('web', 'manual')),
  add column if not exists created_by     uuid;

-- Ubicación en el depósito (sale en la lista de armado). Se edita como el resto del producto (products.write).
alter table public.products add column if not exists location text;

insert into public.permissions (key, description) values
  ('orders.create', 'Armar pedidos desde el panel (ej. pedidos por WhatsApp)')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
  select r.id, 'orders.create' from public.roles r where r.name in ('administrador', 'moderador')
on conflict do nothing;

-- Datos de cliente y envío (limpia y recorta el texto).
create or replace function public._order_info(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'customer_name',  left(nullif(btrim(p->>'customer_name'), ''), 120),
    'customer_phone', left(nullif(btrim(p->>'customer_phone'), ''), 40),
    'customer_email', left(nullif(btrim(p->>'customer_email'), ''), 160),
    'ship_address',   left(nullif(btrim(p->>'ship_address'), ''), 200),
    'ship_city',      left(nullif(btrim(p->>'ship_city'), ''), 80),
    'ship_province',  left(nullif(btrim(p->>'ship_province'), ''), 80),
    'ship_zip',       left(nullif(btrim(p->>'ship_zip'), ''), 12),
    'carrier',        left(nullif(btrim(p->>'carrier'), ''), 60))
$$;

-- Armar un pedido desde el panel.
-- items = [{"product_id": "...", "variant": "", "qty": 1, "unit_price": 359100}]
-- unit_price solo se respeta con products.write (precio negociado); si no, se usa el precio del producto.
create or replace function public.admin_create_order(p_info jsonb, p_items jsonb, p_shipping_cost numeric default 0,
  p_packages int default 1, p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_order bigint; v_total numeric := 0; it jsonb; p products%rowtype; v_qty int; v_price numeric;
  inf jsonb := public._order_info(coalesce(p_info, '{}'::jsonb));
begin
  if not has_perm('orders.create') then raise exception 'Sin permiso'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Pedido vacío'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'Demasiados productos'; end if;
  if inf->>'customer_name' is null then raise exception 'Falta el nombre del cliente'; end if;
  if coalesce(p_shipping_cost, 0) < 0 then raise exception 'Costo de envío inválido'; end if;

  insert into orders (user_id, total, note, source, created_by, shipping_cost, packages,
      customer_name, customer_phone, customer_email, ship_address, ship_city, ship_province, ship_zip, carrier)
    values (null, 0, left(p_note, 1000), 'manual', auth.uid(), nullif(p_shipping_cost, 0), greatest(1, least(coalesce(p_packages, 1), 50)),
      inf->>'customer_name', inf->>'customer_phone', inf->>'customer_email', inf->>'ship_address',
      inf->>'ship_city', inf->>'ship_province', inf->>'ship_zip', inf->>'carrier')
    returning id into v_order;

  for it in select * from jsonb_array_elements(p_items) loop
    v_qty := (it->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 999 then raise exception 'Cantidad inválida'; end if;
    select * into p from products where id = it->>'product_id' for update;
    if not found then raise exception 'Producto inexistente: %', it->>'product_id'; end if;
    if v_qty > p.stock and not p.cart_ok then raise exception 'Sin stock suficiente de %', p.name; end if;
    v_price := case when has_perm('products.write') and (it->>'unit_price') is not null
                    then greatest(0, (it->>'unit_price')::numeric) else p.price end;
    update products set stock = greatest(0, stock - v_qty), updated_at = now() where id = p.id;
    insert into order_items (order_id, product_id, variant, qty, unit_price)
      values (v_order, p.id, coalesce(left(it->>'variant', 80), ''), v_qty, v_price)
      on conflict (order_id, product_id, variant) do update set qty = order_items.qty + excluded.qty;
    v_total := v_total + v_price * v_qty;
  end loop;

  update orders set total = v_total + coalesce(p_shipping_cost, 0) where id = v_order;
  insert into order_events (order_id, to_status, actor) values (v_order, 'pending', auth.uid()::text);
  return v_order;
end $$;

-- Editar datos de cliente / envío / bultos (sirve también para pedidos de la web).
create or replace function public.admin_update_order_info(p_order bigint, p_info jsonb, p_packages int default null)
returns void language plpgsql security definer set search_path = public as $$
declare inf jsonb := public._order_info(coalesce(p_info, '{}'::jsonb));
begin
  if not has_perm('orders.update_status') then raise exception 'Sin permiso'; end if;
  update orders set
    customer_name = inf->>'customer_name', customer_phone = inf->>'customer_phone', customer_email = inf->>'customer_email',
    ship_address = inf->>'ship_address', ship_city = inf->>'ship_city', ship_province = inf->>'ship_province',
    ship_zip = inf->>'ship_zip', carrier = coalesce(inf->>'carrier', carrier),
    packages = coalesce(greatest(1, least(p_packages, 50)), packages)
  where id = p_order;
  if not found then raise exception 'Pedido inexistente'; end if;
end $$;

-- Lista de armado: guarda qué renglones ya se juntaron; si están todos, marca el pedido como embalado.
create or replace function public.admin_set_packed(p_order bigint, p_packed jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_all int; v_done int; v_at timestamptz;
begin
  if not has_perm('orders.update_status') then raise exception 'Sin permiso'; end if;
  if jsonb_typeof(p_packed) <> 'array' then raise exception 'Formato inválido'; end if;
  select count(*) into v_all from order_items where order_id = p_order;
  select count(*) into v_done from order_items oi
    where oi.order_id = p_order and p_packed ? (oi.product_id || '|' || oi.variant);
  v_at := case when v_all > 0 and v_done = v_all then now() else null end;
  update orders set packed_items = p_packed, packed_at = case when v_at is null then null else coalesce(packed_at, v_at) end
    where id = p_order returning packed_at into v_at;
  if not found then raise exception 'Pedido inexistente'; end if;
  return v_at;
end $$;

revoke all on function public._order_info(jsonb) from public, anon, authenticated;
revoke all on function public.admin_create_order(jsonb, jsonb, numeric, int, text) from public, anon;
revoke all on function public.admin_update_order_info(bigint, jsonb, int) from public, anon;
revoke all on function public.admin_set_packed(bigint, jsonb) from public, anon;
grant execute on function public.admin_create_order(jsonb, jsonb, numeric, int, text) to authenticated;
grant execute on function public.admin_update_order_info(bigint, jsonb, int) to authenticated;
grant execute on function public.admin_set_packed(bigint, jsonb) to authenticated;
