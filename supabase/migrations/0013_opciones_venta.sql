-- Opciones de venta por producto (solo administradores; products_guard ya lo impide al resto).
alter table public.products
  add column if not exists ask_price boolean not null default false,
  add column if not exists ask_stock boolean not null default false,
  add column if not exists cart_ok boolean not null default true,
  add column if not exists hide_no_stock boolean not null default false;
