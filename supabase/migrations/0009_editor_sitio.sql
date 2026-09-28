-- Editor de la página web (aplicada el 28/09/2026): permiso site.edit (administrador), tabla site_blocks
-- (lectura pública, edición site.edit), bucket "sitio" para imágenes, y las 7 secciones originales del inicio
-- (el banner ancho de motherboards ASUS X570/B550 queda desactivado).
insert into public.permissions (key, description) values ('site.edit', 'Editar la página web (secciones, textos, imágenes)') on conflict do nothing;
insert into public.role_permissions (role_id, permission_key) select id, 'site.edit' from public.roles where name = 'administrador' on conflict do nothing;
create table if not exists public.site_blocks (
  id text primary key, page text not null default 'inicio',
  type text not null check (type in ('hero','tarjetas','catalogo','banner','beneficios','logos','contacto','texto','imagen','imagen_texto','aviso')),
  title text, position int not null default 0, active boolean not null default true, builtin boolean not null default false,
  data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
alter table public.site_blocks enable row level security;
create policy "site_lectura" on public.site_blocks for select using (true);
create policy "site_editar" on public.site_blocks for all to authenticated using (public.has_perm('site.edit')) with check (public.has_perm('site.edit'));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('sitio', 'sitio', true, 5242880, array['image/webp','image/jpeg','image/png']) on conflict (id) do nothing;
create policy "sitio_subir" on storage.objects for insert to authenticated with check (bucket_id = 'sitio' and public.has_perm('site.edit'));
create policy "sitio_editar" on storage.objects for update to authenticated using (bucket_id = 'sitio' and public.has_perm('site.edit'));
create policy "sitio_borrar" on storage.objects for delete to authenticated using (bucket_id = 'sitio' and public.has_perm('site.edit'));
-- (las 7 filas iniciales se cargaron con el contenido que tenía index.html)
