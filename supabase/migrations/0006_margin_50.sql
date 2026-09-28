-- Margen por defecto 50 % (antes 30 %). Aplicada el 28/09/2026.
alter table public.product_sources alter column margin set default 0.50;
update public.product_sources set margin = 0.50;
