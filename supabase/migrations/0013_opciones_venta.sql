-- Opciones de venta por producto (solo administradores; products_guard ya lo impide al resto).
alter table public.products
  add column if not exists ask_price boolean not null default false,
  add column if not exists ask_stock boolean not null default false,
  add column if not exists cart_ok boolean not null default true,
  add column if not exists hide_no_stock boolean not null default false;

-- Referencias de compra: moneda del precio, costo de envío y su moneda; el link pasa a ser opcional.
-- (Aplicado en Supabase como migración referencias_moneda_envio.)
alter table public.product_sources
  alter column url drop not null,
  add column if not exists currency text not null default 'ARS' check (currency in ('ARS','USD')),
  add column if not exists ship_cost numeric check (ship_cost is null or ship_cost >= 0),
  add column if not exists ship_currency text not null default 'ARS' check (ship_currency in ('ARS','USD'));
