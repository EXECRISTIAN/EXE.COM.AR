-- Envíos con Andreani: datos de peso/medidas en productos, datos de envío en pedidos y permiso para despachar.

alter table public.products
  add column weight_kg numeric(8,3) not null default 1 check (weight_kg > 0),  -- peso por unidad (con caja)
  add column length_cm numeric(8,1),
  add column width_cm  numeric(8,1),
  add column height_cm numeric(8,1);

alter table public.orders
  add column shipping        jsonb,   -- { method: 'domicilio'|'sucursal'|'retiro', cp, calle, numero, piso, depto, localidad, provincia, sucursal_id, dni, telefono, nombre }
  add column shipping_cost   numeric(12,2),  -- lo escribe solo la Edge Function (tarifa real de Andreani)
  add column andreani_number text,           -- número de envío de Andreani
  add column andreani_group  text;           -- agrupador de bultos (para etiquetas)

insert into public.permissions (key, description) values
  ('shipping.manage', 'Crear envíos en Andreani e imprimir etiquetas');
insert into public.role_permissions (role_id, permission_key)
  select id, 'shipping.manage' from public.roles where name in ('administrador', 'moderador');

-- El cliente carga su dirección de envío mientras el pedido está pendiente. El costo NO lo puede tocar.
create or replace function public.set_order_shipping(p_order bigint, p_shipping jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_shipping->>'method' not in ('domicilio', 'sucursal', 'retiro') then raise exception 'Método de envío inválido'; end if;
  update orders set shipping = p_shipping
   where id = p_order and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Pedido inexistente o ya procesado'; end if;
end $$;
