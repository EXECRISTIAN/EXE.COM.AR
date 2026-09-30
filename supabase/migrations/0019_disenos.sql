-- Editor de imágenes por capas: cada diseño guarda sus capas (doc), la imagen WebP publicada y las zonas
-- tocables (hotspots) que la tienda dibuja encima de esa imagen. Edición solo con site.edit (RLS).
-- El público solo puede leer image_url y hotspots (lo que necesita la tienda); las capas no se exponen.
create table if not exists public.designs (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Diseño' check (char_length(name) <= 120),
  width int not null check (width between 50 and 4000),
  height int not null check (height between 50 and 4000),
  kind text not null default 'banner' check (kind in ('banner','producto','otro')),
  doc jsonb not null default '{}'::jsonb check (pg_column_size(doc) < 1500000),
  image_url text check (image_url is null or image_url ~ '^https://'),
  hotspots jsonb not null default '[]'::jsonb check (jsonb_typeof(hotspots) = 'array' and jsonb_array_length(hotspots) <= 40),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.designs enable row level security;
create policy "disenos_lectura" on public.designs for select using (true);
create policy "disenos_editar" on public.designs for all to authenticated using (public.has_perm('site.edit')) with check (public.has_perm('site.edit'));
revoke all on public.designs from anon;
grant select (id, image_url, hotspots) on public.designs to anon;
create index if not exists designs_image_url on public.designs (image_url);
