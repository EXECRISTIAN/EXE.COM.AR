-- Nuevo tipo de sección "espaciador". Los estilos de cada sección viven en site_blocks.data.style (jsonb, validado al mostrarse).
-- (Aplicado en Supabase como migración site_blocks_espaciador.)
alter table public.site_blocks drop constraint site_blocks_type_check;
alter table public.site_blocks add constraint site_blocks_type_check check (type in ('hero','tarjetas','catalogo','banner','beneficios','logos','contacto','texto','imagen','imagen_texto','aviso','espaciador'));
