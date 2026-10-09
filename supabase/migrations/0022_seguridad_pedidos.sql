-- Revisión de seguridad (09/10/2026)
--
-- 1) create_order: la tienda hoy toma los pedidos por WhatsApp y no usa esta función, pero estaba
--    habilitada para cualquier cuenta registrada. Con eso alguien podía crear pedidos pendientes sin
--    límite y dejar el stock de la tienda en 0 (los productos aparecían "sin stock").
--    Se agregan validaciones (cantidades, productos con precio, nota, máximo de pedidos pendientes)
--    y se deshabilita para el público hasta que se active la compra online.
create or replace function public.create_order(items jsonb, p_note text default null)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order bigint;
  v_total numeric := 0;
  it jsonb;
  p products%rowtype;
  v_qty int;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesión'; end if;
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then raise exception 'Pedido vacío'; end if;
  if jsonb_array_length(items) > 50 then raise exception 'Demasiados productos'; end if;
  if (select count(*) from orders where user_id = auth.uid() and status = 'pending' and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Tenés pedidos pendientes: esperá a que los confirmemos antes de hacer otro';
  end if;

  insert into orders (user_id, total, note) values (auth.uid(), 0, left(p_note, 1000)) returning id into v_order;

  for it in select * from jsonb_array_elements(items) loop
    v_qty := (it->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 999 then raise exception 'Cantidad inválida'; end if;
    select * into p from products where id = it->>'product_id' and active and price > 0 for update;  -- bloquea la fila
    if not found then raise exception 'Producto inexistente: %', it->>'product_id'; end if;
    if v_qty > p.stock then raise exception 'Sin stock suficiente de %', p.name; end if;

    update products set stock = stock - v_qty, updated_at = now() where id = p.id;
    insert into order_items (order_id, product_id, variant, qty, unit_price)
      values (v_order, p.id, coalesce(left(it->>'variant', 80), ''), v_qty, p.price)
      on conflict (order_id, product_id, variant) do update set qty = order_items.qty + excluded.qty;
    v_total := v_total + p.price * v_qty;
  end loop;

  update orders set total = v_total where id = v_order;
  insert into order_events (order_id, to_status, actor) values (v_order, 'pending', auth.uid()::text);
  return v_order;
end $function$;

-- Sin uso hasta que haya compra online: nadie puede llamarlas desde la web (el panel no las usa).
revoke execute on function public.create_order(jsonb, text) from public, anon, authenticated;
revoke execute on function public.set_order_shipping(bigint, jsonb) from public, anon, authenticated;

-- 2) set_order_status: al cancelar se devolvía el stock, pero si después el pedido se reactivaba
--    no se volvía a descontar (cancelar → reactivar → cancelar sumaba stock de más). Además, si un
--    pedido tenía el mismo producto en dos variantes, solo se devolvía una de las líneas.
create or replace function public.set_order_status(p_order bigint, p_status order_status)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_old public.order_status;
begin
  if not has_perm('orders.update_status') then raise exception 'Sin permiso'; end if;
  if p_status = 'paid' and not has_perm('orders.mark_paid') then raise exception 'Sin permiso para marcar pagado'; end if;

  select status into v_old from orders where id = p_order for update;
  if v_old is null then raise exception 'Pedido inexistente'; end if;

  update orders set status = p_status,
    paid_at = case when p_status = 'paid' then now() else paid_at end,
    paid_by = case when p_status = 'paid' then auth.uid()::text else paid_by end
  where id = p_order;

  -- cancelar devuelve el stock; reactivar un pedido cancelado lo vuelve a descontar
  if p_status = 'cancelled' and v_old <> 'cancelled' then
    update products pr set stock = pr.stock + oi.q
      from (select product_id, sum(qty) q from order_items where order_id = p_order group by product_id) oi
      where oi.product_id = pr.id;
  elsif v_old = 'cancelled' and p_status <> 'cancelled' then
    update products pr set stock = greatest(0, pr.stock - oi.q)
      from (select product_id, sum(qty) q from order_items where order_id = p_order group by product_id) oi
      where oi.product_id = pr.id;
  end if;

  insert into order_events (order_id, from_status, to_status, actor) values (p_order, v_old, p_status, auth.uid()::text);
end $function$;
