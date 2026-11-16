-- Auditoría AUD-04: al cancelar un pedido se devuelve solo el stock que realmente se descontó.
-- order_items.stock_taken guarda cuánto se descontó (null en pedidos viejos = se descontó la cantidad completa).
alter table public.order_items add column if not exists stock_taken int check (stock_taken is null or stock_taken >= 0);

create or replace function public.admin_create_order(p_info jsonb, p_items jsonb, p_shipping_cost numeric default 0, p_packages integer default 1, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $function$
declare
  v_order bigint; v_total numeric := 0; it jsonb; p products%rowtype; v_qty int; v_price numeric; v_take int;
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
    v_take := least(v_qty, greatest(p.stock, 0));
    update products set stock = stock - v_take, updated_at = now() where id = p.id;
    insert into order_items (order_id, product_id, variant, qty, unit_price, stock_taken)
      values (v_order, p.id, coalesce(left(it->>'variant', 80), ''), v_qty, v_price, v_take)
      on conflict (order_id, product_id, variant) do update
        set qty = order_items.qty + excluded.qty, stock_taken = coalesce(order_items.stock_taken, order_items.qty) + excluded.stock_taken;
    v_total := v_total + v_price * v_qty;
  end loop;

  update orders set total = v_total + coalesce(p_shipping_cost, 0) where id = v_order;
  insert into order_events (order_id, to_status, actor) values (v_order, 'pending', auth.uid()::text);
  return v_order;
end $function$;

create or replace function public.set_order_status(p_order bigint, p_status order_status)
returns void language plpgsql security definer set search_path = public as $function$
declare v_old public.order_status; oi record; v_take int;
begin
  if not has_perm('orders.update_status') then raise exception 'Sin permiso'; end if;
  if p_status = 'paid' and not has_perm('orders.mark_paid') then raise exception 'Sin permiso para marcar pagado'; end if;

  select status into v_old from orders where id = p_order for update;
  if v_old is null then raise exception 'Pedido inexistente'; end if;

  update orders set status = p_status,
    paid_at = case when p_status = 'paid' then now() else paid_at end,
    paid_by = case when p_status = 'paid' then auth.uid()::text else paid_by end
  where id = p_order;

  if p_status = 'cancelled' and v_old <> 'cancelled' then
    -- devuelve solo lo descontado
    for oi in select * from order_items where order_id = p_order order by product_id, variant loop
      update products set stock = stock + coalesce(oi.stock_taken, oi.qty), updated_at = now() where id = oi.product_id;
      update order_items set stock_taken = 0 where order_id = p_order and product_id = oi.product_id and variant = oi.variant;
    end loop;
  elsif v_old = 'cancelled' and p_status <> 'cancelled' then
    -- vuelve a descontar lo que haya disponible y lo anota
    for oi in select * from order_items where order_id = p_order order by product_id, variant loop
      select least(oi.qty, greatest(stock, 0)) into v_take from products where id = oi.product_id for update;
      update products set stock = stock - coalesce(v_take, 0), updated_at = now() where id = oi.product_id;
      update order_items set stock_taken = coalesce(v_take, 0) where order_id = p_order and product_id = oi.product_id and variant = oi.variant;
    end loop;
  end if;

  insert into order_events (order_id, from_status, to_status, actor) values (p_order, v_old, p_status, auth.uid()::text);
end $function$;
