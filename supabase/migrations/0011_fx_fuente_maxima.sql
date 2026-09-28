-- Fuente "max" (la cotización más alta de todas) y máximo del día por cada fuente (day_max_by_source).
-- fx_refresh lee https://dolarapi.com/v1/dolares una sola vez y actualiza todo; fx_save reinicia solo el máximo en uso al cambiar de fuente.
-- (Aplicado en Supabase como migraciones fx_fuente_maxima y fx_save_reinicio_fuente.)
alter table public.fx_settings add column if not exists day_max_by_source jsonb not null default '{}'::jsonb;
alter table public.fx_settings drop constraint if exists fx_settings_source_check;
alter table public.fx_settings add constraint fx_settings_source_check check (source = any (array['max','oficial','blue','bolsa','contadoconliqui','mayorista','cripto','tarjeta']));

-- Cotizaciones que usa "Automático (el más alto)" (se activan/desactivan en el panel). fx_save recibe p_max_sources.
-- (Aplicado en Supabase como migración fx_fuentes_del_maximo.)
alter table public.fx_settings add column if not exists max_sources text[] not null default array['oficial','blue','bolsa','contadoconliqui','mayorista','cripto','tarjeta'];

-- Modos automáticos "min" (el más bajo) y "mid" (punto medio entre el más alto y el más bajo), sobre las mismas cotizaciones activadas.
-- (Aplicado en Supabase como migración fx_min_y_medio.)
alter table public.fx_settings drop constraint if exists fx_settings_source_check;
alter table public.fx_settings add constraint fx_settings_source_check check (source = any (array['max','min','mid','oficial','blue','bolsa','contadoconliqui','mayorista','cripto','tarjeta']));
