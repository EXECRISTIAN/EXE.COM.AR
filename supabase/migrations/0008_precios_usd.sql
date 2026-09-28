-- Precios en dólares con cotización manual o automática (aplicada el 28/09/2026).
-- products.price_usd: si tiene valor, products.price (ARS) = price_usd × cotización, redondeado.
-- fx_settings (1 fila): modo manual/auto, fuente dolarapi.com, máximo del día (nunca baja en el día, hora Argentina).
-- fx_refresh() corre cada 30 min con pg_cron; fx_save() lo usa el panel (solo products.write).
-- Ver el SQL completo aplicado en Supabase (migración "precios_usd"); resumen:
create extension if not exists pg_cron;
create extension if not exists http with schema extensions;
alter table public.products add column if not exists price_usd numeric check (price_usd is null or price_usd >= 0);
alter table public.product_costs add column if not exists cost_usd numeric check (cost_usd is null or cost_usd >= 0);
-- tabla public.fx_settings, funciones public.fx_apply(), public.fx_refresh(), public.fx_save(text, numeric, text, int),
-- trigger products_fx_price y cron.schedule('fx-refresh', '*/30 * * * *', 'select public.fx_refresh()').
