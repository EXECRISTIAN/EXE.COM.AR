-- "Mis compras": las ventas que se cargan en el panel (pedidos manuales) aparecen en la cuenta del cliente.
-- Se vinculan por el email del cliente, solo si esa cuenta tiene el email VERIFICADO (así nadie ve compras ajenas
-- registrándose con un email que no es suyo).
-- 1) Al crear o editar un pedido sin cuenta asignada, si el email coincide con una cuenta verificada, se asigna.
-- 2) claim_my_orders(): el cliente que se registra después reclama sus compras anteriores (mismo email verificado).
-- 3) my_orders(): lista de compras del cliente con nombre y foto de cada producto, aunque el producto ya no se publique.

create or replace function public._link_order_user() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.user_id is null and nullif(btrim(new.customer_email), '') is not null then
    select u.id into new.user_id from auth.users u
     where lower(u.email) = lower(btrim(new.customer_email)) and u.email_confirmed_at is not null
     limit 1;
  end if;
  return new;
end $$;
revoke all on function public._link_order_user() from public, anon, authenticated;

drop trigger if exists orders_link_user on public.orders;
create trigger orders_link_user before insert or update of customer_email on public.orders
  for each row execute function public._link_order_user();

create or replace function public.claim_my_orders() returns int
language plpgsql security definer set search_path = public, auth as $$
declare v_email text; n int;
begin
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  update orders set user_id = auth.uid()
   where user_id is null and lower(btrim(customer_email)) = v_email;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.claim_my_orders() from public, anon;
grant execute on function public.claim_my_orders() to authenticated;

create or replace function public.my_orders() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'created_at', o.created_at, 'status', o.status, 'total', o.total, 'shipping_cost', o.shipping_cost,
      'carrier', o.carrier, 'tracking_number', o.tracking_number, 'payment_url', o.payment_url,
      'invoice_cae', o.invoice_cae, 'invoice_pos', o.invoice_pos, 'invoice_number', o.invoice_number,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'variant', i.variant, 'qty', i.qty,
                  'unit_price', i.unit_price, 'name', p.name, 'image', coalesce(p.images[1], p.image), 'active', p.active)), '[]')
                from order_items i left join products p on p.id = i.product_id where i.order_id = o.id)
    ) order by o.created_at desc), '[]')
  from orders o where o.user_id = auth.uid() and auth.uid() is not null;
$$;
revoke all on function public.my_orders() from public, anon;
grant execute on function public.my_orders() to authenticated;
