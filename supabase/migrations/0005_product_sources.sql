-- Precio de referencia de cada producto y dónde comprarlo. Solo administradores (permiso products.write): no es público.
-- Aplicada el 28/09/2026.
create table if not exists public.product_sources (
  id bigint generated always as identity primary key,
  product_id text not null references public.products(id) on delete cascade,
  store text not null,
  url text not null check (url ~ '^https://'),
  ref_price numeric not null check (ref_price > 0),
  margin numeric not null default 0.30,
  sale_price numeric generated always as (round(ref_price * (1 + margin), -2)) stored,
  delivery_note text,
  checked_at timestamptz not null default now(),
  unique (product_id, store)
);
alter table public.product_sources enable row level security;
revoke all on public.product_sources from anon;
create policy "product_sources_admin_select" on public.product_sources for select to authenticated using (public.has_perm('products.write'));
create policy "product_sources_admin_write" on public.product_sources for all to authenticated using (public.has_perm('products.write')) with check (public.has_perm('products.write'));
