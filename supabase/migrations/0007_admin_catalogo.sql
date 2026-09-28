-- Catálogo administrable desde el panel (aplicada el 28/09/2026): fotos, especificaciones, outlet/estado, orden,
-- costos privados (solo products.write) y bucket de fotos "productos" (lectura pública, escritura products.write).
alter table public.products
  add column if not exists images text[] not null default '{}',
  add column if not exists specs jsonb not null default '[]'::jsonb,
  add column if not exists outlet boolean not null default false,
  add column if not exists condition text,
  add column if not exists sort integer not null default 0,
  add column if not exists created_at timestamptz not null default now();
create table if not exists public.product_costs (
  product_id text primary key references public.products(id) on delete cascade on update cascade,
  cost numeric check (cost is null or cost >= 0), supplier text, notes text,
  updated_at timestamptz not null default now()
);
alter table public.product_costs enable row level security;
revoke all on public.product_costs from anon;
create policy "product_costs_admin" on public.product_costs for all to authenticated
  using (public.has_perm('products.write')) with check (public.has_perm('products.write'));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productos', 'productos', true, 3145728, array['image/webp','image/jpeg','image/png']) on conflict (id) do nothing;
create policy "productos_fotos_subir" on storage.objects for insert to authenticated with check (bucket_id = 'productos' and public.has_perm('products.write'));
create policy "productos_fotos_editar" on storage.objects for update to authenticated using (bucket_id = 'productos' and public.has_perm('products.write'));
create policy "productos_fotos_borrar" on storage.objects for delete to authenticated using (bucket_id = 'productos' and public.has_perm('products.write'));
