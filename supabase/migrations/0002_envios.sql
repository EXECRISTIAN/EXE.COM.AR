-- Envíos con Envia.com: peso/medidas en productos, datos de envío en pedidos y permiso para despachar.

alter table public.products
  add column weight_kg numeric(8,3) not null default 1 check (weight_kg > 0),  -- peso por unidad (con caja)
  add column length_cm numeric(8,1),
  add column width_cm  numeric(8,1),
  add column height_cm numeric(8,1);

alter table public.orders
  add column shipping        jsonb,          -- { carrier, service, nombre, telefono, calle, numero, piso, depto, localidad, provincia, cp }
  add column shipping_cost   numeric(12,2),  -- lo escribe solo la Edge Function (tarifa real)
  add column carrier         text,           -- transportista usado (andreani, correo-argentino, oca…)
  add column tracking_number text,
  add column label_url       text;

insert into public.permissions (key, description) values
  ('shipping.manage', 'Crear envíos e imprimir etiquetas');
insert into public.role_permissions (role_id, permission_key)
  select id, 'shipping.manage' from public.roles where name in ('administrador', 'moderador');

-- El cliente carga su dirección de envío mientras el pedido está pendiente. El costo NO lo puede tocar.
create or replace function public.set_order_shipping(p_order bigint, p_shipping jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_shipping->>'carrier', '') = '' or coalesce(p_shipping->>'cp', '') = '' then raise exception 'Envío incompleto'; end if;
  update orders set shipping = p_shipping
   where id = p_order and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Pedido inexistente o ya procesado'; end if;
end $$;
